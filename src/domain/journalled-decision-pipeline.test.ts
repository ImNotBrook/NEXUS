import { describe, expect, it } from "vitest";
import { evaluateAndJournalDecision, type DecisionJournalWriter } from "./journalled-decision-pipeline";
import type { DecisionInput, EvidenceItem } from "./decision-engine";
import type { DecisionJournalRecord } from "./decision-journal";

const now = 1_800_000_000_000;
const candidate = {
  id: "candidate-1",
  symbol: "BTCUSDT",
  side: "long" as const,
  setupFamily: "structure-retest",
  timeframe: "4h",
  triggerConfirmed: true,
  expiresAt: now + 60_000,
  plan: { entryPrice: 100, stopPrice: 98, targetPrices: [104], quantity: 0.5 },
};
const evidence = (id: string, family: EvidenceItem["family"]): EvidenceItem => ({
  id, family, claim: id + " supports the thesis", polarity: "supports",
  strength: 0.8, quality: 0.9, symbol: "BTCUSDT", timeframe: "4h",
  availableAt: now - 10_000, observedAt: now - 5_000,
  sourceRef: "snapshot:" + id, calculationVersion: "v1",
});
const input = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  evaluationTime: now,
  candidate,
  marketDataStatus: "pass",
  riskGate: { eligible: true, reasonCodes: [] },
  economicsGate: { eligible: true, reasonCodes: [] },
  minimumSupportingFamilies: 2,
  evidence: [evidence("structure", "market_structure"), evidence("momentum", "momentum_volume")],
  ...overrides,
});
const context = {
  decisionId: "decision-pipeline-1",
  clockSource: "test-clock",
  symbol: "BTCUSDT",
  timeframe: "4h",
  marketSnapshotRefs: [{ snapshotId: "market-1", contentHash: "sha256:abc" }],
  thesis: {
    bullCase: ["Confirmed structure supports the setup"],
    bearCase: ["No material contradiction"],
    alternatives: ["Range continuation"],
    invalidation: ["Close below the confirmed swing low"],
  },
  versions: { engine: "ede-1", score: "diagnostic-1", strategy: "baseline-1", riskPolicy: "paper-risk-1" },
};
function writer(records: DecisionJournalRecord[] = []): DecisionJournalWriter {
  return {
    append: async (record) => {
      records.push(structuredClone(record));
      return structuredClone(record);
    },
  };
}

describe("evaluateAndJournalDecision", () => {
  it("persists an ENTER decision before returning the result", async () => {
    const records: DecisionJournalRecord[] = [];
    const result = await evaluateAndJournalDecision(input(), context, writer(records));
    expect(result.result.status).toBe("ENTER");
    expect(result.record.status).toBe("ENTER");
    expect(records).toHaveLength(1);
    expect(records[0].result).toEqual(result.result);
  });

  it("journals NO_SETUP with no candidate and the decision-time evidence snapshot", async () => {
    const records: DecisionJournalRecord[] = [];
    const result = await evaluateAndJournalDecision(
      input({ candidate: null }),
      context,
      writer(records),
    );
    expect(result.result.status).toBe("NO_SETUP");
    expect(result.record.candidate).toBeNull();
    expect(result.record.evidence).toHaveLength(2);
  });

  it("journals WAIT when a causal trigger is not confirmed", async () => {
    const result = await evaluateAndJournalDecision(
      input({ candidate: { ...candidate, triggerConfirmed: false } }),
      context,
      writer(),
    );
    expect(result.result.status).toBe("WAIT");
    expect(result.record.reasonCodes).toContain("TRIGGER_NOT_CONFIRMED");
  });

  it("journals REJECT when a hard risk gate fails", async () => {
    const result = await evaluateAndJournalDecision(
      input({ riskGate: { eligible: false, reasonCodes: ["DRAWDOWN_LIMIT"] } }),
      context,
      writer(),
    );
    expect(result.result.status).toBe("REJECT");
    expect(result.record.reasonCodes).toContain("DRAWDOWN_LIMIT");
  });

  it("does not return a successful decision if durable journal persistence fails", async () => {
    const failingWriter: DecisionJournalWriter = {
      append: async () => { throw new Error("IndexedDB quota exceeded"); },
    };
    await expect(evaluateAndJournalDecision(input(), context, failingWriter))
      .rejects.toThrow("IndexedDB quota exceeded");
  });

  it("uses a secure UUID generator when the caller does not provide a decision ID", async () => {
    const result = await evaluateAndJournalDecision(
      input(),
      { ...context, decisionId: undefined },
      writer(),
      () => "generated-uuid",
    );
    expect(result.record.decisionId).toBe("decision:generated-uuid");
  });

  it("rejects mismatched candidate and journal context instead of misattributing the decision", async () => {
    await expect(evaluateAndJournalDecision(
      input(),
      { ...context, symbol: "ETHUSDT" },
      writer(),
    )).rejects.toThrow();
  });
});
