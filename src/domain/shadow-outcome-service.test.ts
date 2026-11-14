import { describe, expect, it } from "vitest";
import { evaluateShadowOutcomes, auditShadowHistory, type ShadowOutcomeServiceJournal } from "./shadow-outcome-service";
import type { DecisionJournalRecord, DecisionJournalEvent } from "./decision-journal";
import type { ShadowTradePlan, ShadowOutcome } from "./shadow-outcome-engine";
import type { Candle } from "./candles";

const decisionAt = 1_800_000_000_000;
const hour = 3_600_000;
const plan: ShadowTradePlan = {
  schemaVersion: 1, simulationVersion: "spot-shadow-v1",
  decisionId: "decision-1", candidateId: "candidate-1", symbol: "BTCUSDT",
  timeframe: "1h", instrumentCategory: "spot", volumeUnit: "base", side: "long",
  decisionAt, entry: {
    orderType: "market", referencePrice: 100, earliestEligibleAt: decisionAt + hour,
    expiresAt: decisionAt + 2 * hour, penetrationBps: 5,
  },
  stopPrice: 95, targetPrice: 110, quantity: 1,
  horizonEnd: decisionAt + 24 * hour - 1,
  sameBarPolicy: "adverse_stop_first",
  executionModel: {
    feeRate: 0.001, baseSlippageBps: 2, halfSpreadBps: 3,
    maxParticipationRate: 0.1, marketImpactBpsAtMaxParticipation: 10,
  },
};
const record: DecisionJournalRecord = {
  schemaVersion: 1, decisionId: plan.decisionId, decisionAt,
  clockSource: "test-clock", symbol: plan.symbol, timeframe: plan.timeframe,
  status: "ENTER", reasonCodes: [], candidate: {
    id: plan.candidateId, symbol: plan.symbol, side: "long",
    setupFamily: "donchian-breakout", timeframe: "1h", triggerConfirmed: true,
    expiresAt: plan.entry.expiresAt,
    plan: { entryPrice: 100, stopPrice: 95, targetPrices: [110], quantity: 1 },
  },
  marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "a".repeat(64) }],
  evidence: [],
  result: {
    status: "ENTER", reasonCodes: [], supportingFamilies: [], contradictingFamilies: [],
    supportingEvidenceIds: [], contradictingEvidenceIds: [], invalidEvidence: [],
    supportScore: 0, contradictionScore: 0, coverageScore: 0, uncertaintyScore: 0, riskEligible: true,
  },
  thesis: { bullCase: ["breakout"], bearCase: ["failure"], alternatives: [], invalidation: ["stop"] },
  versions: { engine: "1", score: "1", strategy: "1", riskPolicy: "1" },
};
const candle = (timestamp: number, open = 100, high = 101, low = 99, close = 100): Candle =>
  ({ timestamp, open, high, low, close, volume: 1_000 });
class MemoryJournal implements ShadowOutcomeServiceJournal {
  records = [record];
  events: DecisionJournalEvent[] = [{
    schemaVersion: 1, eventId: "shadow-plan:registered", decisionId: plan.decisionId,
    eventType: "shadow_plan_registered", occurredAt: decisionAt,
    payload: { candidateId: plan.candidateId, simulationVersion: plan.simulationVersion, plan },
  }];
  async list(): Promise<DecisionJournalRecord[]> { return structuredClone(this.records); }
  async get(id: string): Promise<DecisionJournalRecord | null> {
    return structuredClone(this.records.find((item) => item.decisionId === id) ?? null);
  }
  async appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent> {
    if (this.events.some((item) => item.eventId === event.eventId)) throw new Error("duplicate event");
    this.events.push(structuredClone(event));
    return structuredClone(event);
  }
  async listEvents(id: string): Promise<DecisionJournalEvent[]> {
    return structuredClone(this.events.filter((item) => item.decisionId === id));
  }
}
const matureCandles = (): Candle[] => {
  const rows: Candle[] = [];
  for (let i = 1; i <= 24; i++) rows.push(candle(decisionAt + i * hour, 100, i === 2 ? 111 : 101, 99, 100));
  // The 24th candle proves maturity and is excluded from the 23-candle outcome path.
  return rows;
};
const hasher = async () => "fixed-shadow-hash";

describe("auditShadowHistory", () => {
  it("passes only a continuous hourly history beginning at the first eligible bar", () => {
    expect(auditShadowHistory(plan, matureCandles()).quality).toBe("pass");
  });
  it("fails closed on a missing hourly candle", () => {
    const candles = matureCandles().filter((item) => item.timestamp !== decisionAt + 3 * hour);
    expect(auditShadowHistory(plan, candles)).toMatchObject({ quality: "fail", reasonCode: "HISTORICAL_GAP" });
  });
  it("does not claim a mature observation before a horizon-proof candle exists", () => {
    expect(auditShadowHistory(plan, [candle(decisionAt + hour)]))
      .toMatchObject({ quality: "pass", horizonReached: false });
  });
});

describe("evaluateShadowOutcomes integration", () => {
  it("loads registered plans, simulates only causal candles, appends outcomes and builds learning cohorts", async () => {
    const journal = new MemoryJournal();
    const report = await evaluateShadowOutcomes({
      journal, now: decisionAt + 26 * hour,
      fetchHistory: async () => matureCandles(),
      hasher,
    });
    expect(report.plansEvaluated).toBe(1);
    expect(report.outcomesRecorded).toBe(1);
    expect(report.failures).toHaveLength(0);
    expect(report.learning.eligibleObservations).toBe(1);
    expect(report.learning.cohorts[0].completedTrades).toBe(1);
    const outcomeEvent = journal.events.find((item) => item.eventType === "outcome_appended")!;
    expect((outcomeEvent.payload.candles as Candle[])).toHaveLength(23);
    expect((outcomeEvent.payload.candles as Candle[]).every((item) => item.timestamp <= plan.horizonEnd)).toBe(true);
    expect(outcomeEvent.payload.observedThrough).toBe(decisionAt + 24 * hour);
  });

  it("does not create a plan retrospectively for a legacy decision without a registration event", async () => {
    const journal = new MemoryJournal();
    journal.events = [];
    const report = await evaluateShadowOutcomes({
      journal, now: decisionAt + 26 * hour, fetchHistory: async () => matureCandles(), hasher,
    });
    expect(report.plansEvaluated).toBe(0);
    expect(report.legacyDecisionsSkipped).toBe(1);
    expect(report.learning.eligibleObservations).toBe(0);
  });

  it("keeps incomplete and ambiguous outcomes out of mature learning cohorts", async () => {
    const journal = new MemoryJournal();
    const report = await evaluateShadowOutcomes({
      journal, now: decisionAt + 3 * hour,
      fetchHistory: async () => [candle(decisionAt + hour)], hasher,
    });
    expect(report.outcomesRecorded).toBe(1);
    expect(report.learning.eligibleObservations).toBe(0);
  });
});
