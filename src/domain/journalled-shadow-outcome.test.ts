import { describe, expect, it } from "vitest";
import { journalShadowOutcome, registerShadowPlan, type ShadowOutcomeJournal } from "./journalled-shadow-outcome";
import type { DecisionJournalEvent, DecisionJournalRecord } from "./decision-journal";
import type { ShadowTradePlan } from "./shadow-outcome-engine";
import type { Candle } from "./candles";

const plan: ShadowTradePlan = {
  schemaVersion: 1,
  simulationVersion: "shadow-v1",
  decisionId: "decision-shadow-1",
  candidateId: "candidate-1",
  symbol: "BTCUSDT",
  timeframe: "4h",
  instrumentCategory: "spot",
  volumeUnit: "base",
  side: "long",
  decisionAt: 1_000,
  entry: {
    orderType: "market",
    referencePrice: 100,
    earliestEligibleAt: 2_000,
    expiresAt: 5_000,
    penetrationBps: 5,
  },
  stopPrice: 95,
  targetPrice: 110,
  quantity: 1,
  horizonEnd: 10_000,
  sameBarPolicy: "adverse_stop_first",
  executionModel: {
    feeRate: 0.001,
    baseSlippageBps: 2,
    halfSpreadBps: 3,
    maxParticipationRate: 0.1,
    marketImpactBpsAtMaxParticipation: 10,
  },
};
const candle = (timestamp: number, open: number, high: number, low: number, close: number): Candle =>
  ({ timestamp, open, high, low, close, volume: 1_000 });

const parentRecord: DecisionJournalRecord = {
  schemaVersion: 1,
  decisionId: plan.decisionId,
  decisionAt: plan.decisionAt,
  clockSource: "test-clock",
  symbol: plan.symbol,
  timeframe: plan.timeframe,
  status: "REJECT",
  reasonCodes: ["RISK_GATE_BLOCKED"],
  candidate: {
    id: plan.candidateId,
    symbol: plan.symbol,
    side: "long",
    setupFamily: "structure-retest",
    timeframe: plan.timeframe,
    triggerConfirmed: true,
    expiresAt: plan.entry.expiresAt,
    plan: { entryPrice: 100, stopPrice: 95, targetPrices: [110], quantity: 1 },
  },
  marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "sha256:decision" }],
  evidence: [],
  result: {
    status: "REJECT", reasonCodes: ["RISK_GATE_BLOCKED"],
    supportingFamilies: [], contradictingFamilies: [],
    supportingEvidenceIds: [], contradictingEvidenceIds: [], invalidEvidence: [],
    supportScore: 0, contradictionScore: 0, coverageScore: 0, uncertaintyScore: 1,
    riskEligible: false,
  },
  thesis: { bullCase: ["Structure"], bearCase: ["No trigger"], alternatives: [], invalidation: ["Breakdown"] },
  versions: { engine: "ede-1", score: "score-1", strategy: "strategy-1", riskPolicy: "risk-1" },
};

class MemoryJournal implements ShadowOutcomeJournal {
  events: DecisionJournalEvent[] = [];
  constructor(
    private readonly decisionIds = new Set([plan.decisionId]),
    private readonly parent: DecisionJournalRecord | null = parentRecord,
    preRegistered = true,
  ) {
    if (preRegistered) this.events.push({
      schemaVersion: 1,
      eventId: "shadow-plan:registered",
      decisionId: plan.decisionId,
      eventType: "shadow_plan_registered",
      occurredAt: plan.decisionAt,
      payload: { candidateId: plan.candidateId, simulationVersion: plan.simulationVersion, plan },
    });
  }
  async get(decisionId: string): Promise<DecisionJournalRecord | null> {
    return this.decisionIds.has(decisionId) && this.parent?.decisionId === decisionId
      ? structuredClone(this.parent)
      : null;
  }
  async appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent> {
    if (!this.decisionIds.has(event.decisionId)) throw new Error("missing decision");
    if (this.events.some((item) => item.eventId === event.eventId)) throw new Error("duplicate event");
    this.events.push(structuredClone(event));
    return structuredClone(event);
  }
  async listEvents(decisionId: string): Promise<DecisionJournalEvent[]> {
    return this.events.filter((event) => event.decisionId === decisionId).map((event) => structuredClone(event));
  }
}
const testHasher = async (value: unknown): Promise<string> => {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (const character of text) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

describe("registerShadowPlan", () => {
  it("registers the fixed plan at decision time before any outcome candle is observed", async () => {
    const journal = new MemoryJournal(new Set([plan.decisionId]), parentRecord, false);
    const result = await registerShadowPlan(plan, journal, testHasher);
    expect(result.event.eventType).toBe("shadow_plan_registered");
    expect(result.event.occurredAt).toBe(plan.decisionAt);
    expect(result.event.payload.plan).toEqual(plan);
    expect(result.alreadyRecorded).toBe(false);
  });

  it("is idempotent for the same immutable plan and rejects altered plans", async () => {
    const journal = new MemoryJournal(new Set([plan.decisionId]), parentRecord, false);
    const first = await registerShadowPlan(plan, journal, testHasher);
    const second = await registerShadowPlan(plan, journal, testHasher);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(second.alreadyRecorded).toBe(true);
    await expect(registerShadowPlan({ ...plan, stopPrice: 94 }, journal, testHasher))
      .rejects.toThrow(/match/i);
    expect(journal.events).toHaveLength(1);
  });

  it("requires a parent decision record before registering a plan", async () => {
    const journal = new MemoryJournal(new Set());
    await expect(registerShadowPlan(plan, journal, testHasher)).rejects.toThrow(/missing decision/i);
    expect(journal.events).toHaveLength(0);
  });
});

describe("journalShadowOutcome", () => {
  it("refuses outcome simulation unless the exact plan was registered at decision time", async () => {
    const journal = new MemoryJournal(new Set([plan.decisionId]), parentRecord, false);
    await expect(journalShadowOutcome(
      plan,
      [candle(2_000, 100, 101, 99, 100)],
      4_000,
      journal,
      testHasher,
    )).rejects.toThrow(/registered at decision time/i);
    expect(journal.events).toHaveLength(0);
  });
  it("simulates and appends an immutable outcome event linked to its decision", async () => {
    const journal = new MemoryJournal();
    const result = await journalShadowOutcome(
      plan,
      [candle(2_000, 100, 101, 99, 100), candle(3_000, 100, 112, 99, 111)],
      4_000,
      journal,
      testHasher,
    );
    expect(result.outcome.status).toBe("completed");
    expect(result.event.eventType).toBe("outcome_appended");
    expect(result.event.decisionId).toBe(plan.decisionId);
    expect(result.event.payload).toMatchObject({
      simulationVersion: "shadow-v1",
      horizonReached: false,
      candleCount: 2,
    });
    expect(journal.events).toHaveLength(1);
    expect(result.alreadyRecorded).toBe(false);
  });

  it("is idempotent for the same plan and candle snapshot across polling timestamps", async () => {
    const journal = new MemoryJournal();
    const candles = [candle(2_000, 100, 101, 99, 100)];
    const first = await journalShadowOutcome(plan, candles, 4_000, journal, testHasher);
    const second = await journalShadowOutcome(plan, candles, 4_500, journal, testHasher);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(second.alreadyRecorded).toBe(true);
    expect(journal.events).toHaveLength(1);
  });

  it("appends a new event when the causal outcome candle snapshot changes", async () => {
    const journal = new MemoryJournal();
    const first = await journalShadowOutcome(
      plan, [candle(2_000, 100, 101, 99, 100)], 4_000, journal, testHasher,
    );
    const second = await journalShadowOutcome(
      plan, [candle(2_000, 100, 101, 99, 100), candle(3_000, 100, 105, 98, 102)],
      4_000, journal, testHasher,
    );
    expect(second.event.eventId).not.toBe(first.event.eventId);
    expect(journal.events).toHaveLength(2);
  });

  it("does not hash or store OHLC values beyond the declared horizon", async () => {
    const journal = new MemoryJournal();
    const base = [candle(2_000, 100, 101, 99, 100), candle(11_000, 100, 101, 99, 100)];
    const extended = [...base, candle(12_000, -1, -1, -1, -1)];
    const first = await journalShadowOutcome(plan, base, 4_000, journal, testHasher);
    const second = await journalShadowOutcome(plan, extended, 4_000, journal, testHasher);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(second.alreadyRecorded).toBe(true);
    expect(journal.events).toHaveLength(1);
  });

  it("rejects recording timestamps before the decision time", async () => {
    await expect(journalShadowOutcome(plan, [], 999, new MemoryJournal(), testHasher))
      .rejects.toThrow(/recording timestamp/i);
  });

  it("propagates missing-decision and persistence errors without fabricating an event", async () => {
    const journal = new MemoryJournal(new Set());
    await expect(journalShadowOutcome(plan, [], 4_000, journal, testHasher))
      .rejects.toThrow(/missing decision/i);
    expect(journal.events).toHaveLength(0);
  });

  it("uses an injected content hasher and produces deterministic event identifiers", async () => {
    const journal = new MemoryJournal();
    const result = await journalShadowOutcome(
      plan, [], 4_000, journal, async () => "fixed-hash",
    );
    expect(result.event.eventId).toBe("shadow-outcome:fixed-hash");
  });

  it("rejects excessive outcome windows before storing large payloads", async () => {
    const candles = Array.from({ length: 5_001 }, (_, index) =>
      candle(2_000 + index, 100, 101, 99, 100),
    );
    await expect(journalShadowOutcome(plan, candles, 8_000, new MemoryJournal(), testHasher))
      .rejects.toThrow(/5000/i);
  });
  it("rejects a shadow plan that does not match its parent decision candidate", async () => {
    await expect(journalShadowOutcome(
      { ...plan, candidateId: "different-candidate" },
      [],
      4_000,
      new MemoryJournal(),
      testHasher,
    )).rejects.toThrow(/candidate/i);
  });

  it("rejects altered entry, stop, target or quantity parameters", async () => {
    await expect(journalShadowOutcome(
      { ...plan, stopPrice: 94 },
      [],
      4_000,
      new MemoryJournal(),
      testHasher,
    )).rejects.toThrow(/match/i);
  });

  it("rejects an unconfirmed candidate without a pre-defined limit trigger", async () => {
    const waitingDecision: DecisionJournalRecord = {
      ...parentRecord,
      status: "WAIT",
      reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
      candidate: { ...parentRecord.candidate!, triggerConfirmed: false },
      result: {
        ...parentRecord.result,
        status: "WAIT",
        reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
      },
    };
    await expect(journalShadowOutcome(
      plan,
      [],
      4_000,
      new MemoryJournal(new Set([plan.decisionId]), waitingDecision),
      testHasher,
    )).rejects.toThrow(/limit-entry trigger/i);
  });

  it("records a WAIT candidate using its pre-defined limit trigger", async () => {
    const waitingDecision: DecisionJournalRecord = {
      ...parentRecord,
      status: "WAIT",
      reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
      candidate: { ...parentRecord.candidate!, triggerConfirmed: false },
      result: {
        ...parentRecord.result,
        status: "WAIT",
        reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
      },
    };
    const limitPlan: ShadowTradePlan = {
      ...plan,
      entry: {
        orderType: "limit",
        referencePrice: 100,
        limitPrice: 100,
        earliestEligibleAt: 2_000,
        expiresAt: 5_000,
        penetrationBps: 5,
      },
    };
    const result = await journalShadowOutcome(
      limitPlan,
      [candle(2_000, 100.5, 101, 99.8, 100.2)],
      4_000,
      new MemoryJournal(new Set([plan.decisionId]), waitingDecision),
      testHasher,
    );
    expect(result.event.eventType).toBe("outcome_appended");
    expect(result.outcome.status).toBe("open");
    expect(result.outcome.entryFilledQuantity).toBe(1);
  });

  it("records the timestamp proving horizon maturity without storing post-horizon OHLC", async () => {
    const journal = new MemoryJournal();
    const result = await journalShadowOutcome(
      plan,
      [
        candle(2_000, 100, 101, 99, 100),
        candle(11_000, 100, 101, 99, 100),
      ],
      12_000,
      journal,
      testHasher,
    );
    expect(result.event.payload.observedThrough).toBe(11_000);
    expect(result.event.payload.candleCount).toBe(1);
    expect(result.event.payload.candles).toHaveLength(1);
    expect(result.event.payload.horizonReached).toBe(true);
  });

  it("creates a distinct observation when the first horizon-proof timestamp changes", async () => {
    const journal = new MemoryJournal();
    const causal = candle(2_000, 100, 101, 99, 100);
    const first = await journalShadowOutcome(
      plan, [causal, candle(11_000, 100, 101, 99, 100)], 12_000, journal, testHasher,
    );
    const second = await journalShadowOutcome(
      plan, [causal, candle(12_000, 100, 101, 99, 100)], 13_000, journal, testHasher,
    );
    expect(second.event.eventId).not.toBe(first.event.eventId);
    expect(journal.events).toHaveLength(2);
    expect(second.event.payload.candles).toHaveLength(1);
  });

});