import { describe, expect, it } from "vitest";
import { evaluateNoSetupReplays, type NoSetupReplayServiceJournal } from "./no-setup-replay-service";
import type { DecisionJournalEvent, DecisionJournalRecord } from "./decision-journal";
import type { Candle } from "./candles";

const hour = 3_600_000;
const decisionAt = 1_800_000_000_000;
const spec = {
  schemaVersion: 1 as const, detectorVersion: "donchian-no-setup-v1" as const,
  decisionId: "decision-replay", symbol: "BTCUSDT" as const, timeframe: "1h" as const,
  decisionAt, lookback: 3,
  initialWindow: [
    { timestamp: decisionAt - 3 * hour, open: 98, high: 101, low: 97, close: 100, volume: 10 },
    { timestamp: decisionAt - 2 * hour, open: 100, high: 102, low: 99, close: 101, volume: 10 },
    { timestamp: decisionAt - hour, open: 101, high: 103, low: 100, close: 102, volume: 10 },
  ],
  strategyId: "donchian-breakout", strategyVersion: "1.0.0",
  atrStopMultiple: 2, rewardRiskMultiple: 2, riskBudget: 20, maxNotional: 2_000, expiryBars: 2,
};
const record = {
  schemaVersion: 1, decisionId: spec.decisionId, decisionAt, clockSource: "test",
  symbol: "BTCUSDT", timeframe: "1h", status: "NO_SETUP", reasonCodes: ["DONCHIAN_TRIGGER_ABSENT"],
  candidate: null, marketSnapshotRefs: [{ snapshotId: "snap", contentHash: "a".repeat(64) }],
  evidence: [], result: {
    status: "NO_SETUP", reasonCodes: ["DONCHIAN_TRIGGER_ABSENT"],
    supportingEvidenceIds: [], contradictingEvidenceIds: [], invalidEvidence: [],
    score: 0, scoreBreakdown: [], explanation: "No setup",
  },
  thesis: { bullCase: [], bearCase: [], alternatives: [], invalidation: [] },
  versions: { engine: "e1", score: "s1", strategy: "donchian-breakout@1.0.0", riskPolicy: "r1" },
} as unknown as DecisionJournalRecord;

class MemoryJournal implements NoSetupReplayServiceJournal {
  records = [record];
  events: DecisionJournalEvent[] = [{
    schemaVersion: 1, eventId: "registration", decisionId: spec.decisionId,
    eventType: "no_setup_replay_registered", occurredAt: decisionAt,
    payload: { spec },
  }];
  async list() { return structuredClone(this.records); }
  async listEvents(id: string) { return structuredClone(this.events.filter((event) => event.decisionId === id)); }
  async appendEvent(event: DecisionJournalEvent) {
    if (this.events.some((item) => item.eventId === event.eventId)) throw new Error("duplicate");
    this.events.push(structuredClone(event));
    return structuredClone(event);
  }
}

function candle(timestamp: number, close: number): Candle {
  return { timestamp, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 };
}

describe("evaluateNoSetupReplays", () => {
  it("records the first causal Donchian trigger as a diagnostic event", async () => {
    const journal = new MemoryJournal();
    const report = await evaluateNoSetupReplays({
      journal, now: decisionAt + 3 * hour,
      fetchHistory: async () => [candle(decisionAt + hour, 104)],
    });
    expect(report.triggersDetected).toBe(1);
    expect(journal.events.at(-1)).toMatchObject({
      eventType: "missed_opportunity_detected",
      occurredAt: decisionAt + 3 * hour,
      payload: { trigger: { timestamp: decisionAt + hour, entryReferencePrice: 104 } },
    });
  });

  it("does not treat a future hourly candle as closed before its close time", async () => {
    const journal = new MemoryJournal();
    const report = await evaluateNoSetupReplays({
      journal, now: decisionAt + hour + 1,
      fetchHistory: async () => [candle(decisionAt + hour, 104)],
    });
    expect(report.triggersDetected).toBe(0);
    expect(report.noTrigger).toBe(1);
    expect(journal.events).toHaveLength(1);
  });

  it("is idempotent after a trigger has already been journalled", async () => {
    const journal = new MemoryJournal();
    const input = {
      journal, now: decisionAt + 3 * hour,
      fetchHistory: async () => [candle(decisionAt + hour, 104)],
    };
    await evaluateNoSetupReplays(input);
    const second = await evaluateNoSetupReplays(input);
    expect(second.alreadyDetected).toBe(1);
    expect(journal.events.filter((event) => event.eventType === "missed_opportunity_detected")).toHaveLength(1);
  });
});
