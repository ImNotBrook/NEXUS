import { describe, expect, it } from "vitest";
import { buildDecisionJournalListItem, serializeDecisionJournalExport } from "./decision-journal-view";
import type { DecisionJournalRecord } from "./decision-journal";

const record = {
  schemaVersion: 1,
  decisionId: "decision:one",
  decisionAt: 1_800_000_000_000,
  clockSource: "test-clock",
  symbol: "BTCUSDT",
  timeframe: "4h",
  status: "WAIT",
  reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
  candidate: null,
  marketSnapshotRefs: [{ snapshotId: "snapshot:one", contentHash: "a".repeat(64) }],
  evidence: [],
  result: {
    status: "WAIT", reasonCodes: ["TRIGGER_NOT_CONFIRMED"], supportingFamilies: [],
    contradictingFamilies: [], supportingEvidenceIds: [], contradictingEvidenceIds: [],
    invalidEvidence: [], supportScore: 0, contradictionScore: 0, coverageScore: 0,
    uncertaintyScore: 1, riskEligible: false,
  },
  thesis: { bullCase: [], bearCase: ["Trigger is not confirmed"], alternatives: [], invalidation: [] },
  versions: { engine: "ede-1", score: "diag-1", strategy: "baseline-1", riskPolicy: "paper-1" },
} satisfies DecisionJournalRecord;

describe("decision journal view", () => {
  it("creates a concise audit row without changing the source record", () => {
    const item = buildDecisionJournalListItem(record);
    expect(item).toEqual({
      decisionId: "decision:one",
      symbol: "BTCUSDT",
      timeframe: "4h",
      status: "WAIT",
      reasonSummary: "TRIGGER NOT CONFIRMED",
      thesisSummary: "Trigger is not confirmed",
      decisionAt: 1_800_000_000_000,
    });
    expect(record.status).toBe("WAIT");
  });

  it("exports complete records as valid, deterministic JSON", () => {
    const first = serializeDecisionJournalExport([record]);
    expect(JSON.parse(first)).toEqual([record]);
    expect(serializeDecisionJournalExport([record])).toBe(first);
  });
});
