import { describe, expect, it } from "vitest";
import {
  createDecisionJournalEventId,
  createDecisionJournalId,
  validateDecisionJournalRecord,
  type DecisionJournalRecord,
} from "./decision-journal";
import type { DecisionResult, EvidenceItem } from "./decision-engine";

const result: DecisionResult = {
  status: "WAIT",
  reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
  supportingFamilies: ["market_structure"],
  contradictingFamilies: [],
  supportingEvidenceIds: ["structure-1"],
  contradictingEvidenceIds: [],
  invalidEvidence: [],
  supportScore: 0.8,
  contradictionScore: 0,
  coverageScore: 0.125,
  uncertaintyScore: 0.5,
  riskEligible: true,
};

const evidence: EvidenceItem = {
  id: "structure-1",
  family: "market_structure",
  claim: "Confirmed higher low remains intact",
  polarity: "supports",
  strength: 0.8,
  quality: 0.9,
  symbol: "BTCUSDT",
  timeframe: "4h",
  availableAt: 1_800_000_000_000,
  observedAt: 1_800_000_000_000,
  sourceRef: "snapshot:btc-4h",
  calculationVersion: "structure-v1",
};

const record: DecisionJournalRecord = {
  schemaVersion: 1,
  decisionId: "decision-uuid-1",
  decisionAt: 1_800_000_000_000,
  clockSource: "browser-performance-and-wall-clock",
  symbol: "BTCUSDT",
  timeframe: "4h",
  status: "WAIT",
  reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
  candidate: null,
  marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "sha256:abc123" }],
  evidence: [evidence],
  result,
  thesis: {
    bullCase: ["Higher-low structure remains intact"],
    bearCase: ["Trigger is not confirmed"],
    alternatives: ["Range continuation"],
    invalidation: ["4h close below the confirmed swing low"],
  },
  versions: {
    engine: "ede-1.0.0",
    score: "diagnostic-1.0.0",
    strategy: "baseline-1.0.0",
    riskPolicy: "paper-risk-1.0.0",
  },
};

describe("Decision Journal record contract", () => {
  it("accepts a complete immutable decision snapshot", () => {
    expect(() => validateDecisionJournalRecord(record)).not.toThrow();
  });

  it("rejects invalid IDs, timestamps, and missing provenance", () => {
    expect(() => validateDecisionJournalRecord({ ...record, decisionId: " " })).toThrow();
    expect(() => validateDecisionJournalRecord({ ...record, decisionAt: -1 })).toThrow();
    expect(() => validateDecisionJournalRecord({
      ...record,
      marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "" }],
    })).toThrow();
  });

  it("rejects status/result mismatch and an ENTER record without a candidate", () => {
    expect(() => validateDecisionJournalRecord({ ...record, status: "ENTER" })).toThrow();
    expect(() => validateDecisionJournalRecord({
      ...record,
      status: "ENTER",
      candidate: null,
      result: { ...result, status: "ENTER" },
    })).toThrow();
  });

  it("retains rejected cross-symbol evidence in the immutable audit snapshot", () => {
    const mismatched = { ...evidence, symbol: "ETHUSDT" };
    const audited = {
      ...record,
      evidence: [mismatched],
      result: {
        ...result,
        invalidEvidence: [{ evidenceId: mismatched.id, reason: "SYMBOL_MISMATCH" as const }],
      },
    };
    expect(() => validateDecisionJournalRecord(audited)).not.toThrow();
  });

  it("rejects duplicate evidence IDs and missing software-policy versions", () => {
    expect(() => validateDecisionJournalRecord({
      ...record,
      evidence: [evidence, evidence],
    })).toThrow();
    expect(() => validateDecisionJournalRecord({
      ...record,
      versions: { ...record.versions, riskPolicy: "" },
    })).toThrow();
  });

  it("allows NO_SETUP without a candidate while retaining its evidence snapshot", () => {
    const noSetup = {
      ...record,
      status: "NO_SETUP" as const,
      reasonCodes: ["NO_CANDIDATE"],
      result: { ...result, status: "NO_SETUP" as const, reasonCodes: ["NO_CANDIDATE"] },
    };
    expect(() => validateDecisionJournalRecord(noSetup)).not.toThrow();
  });
  it("generates decision and event IDs from secure UUIDs, not wall-clock timestamps", () => {
    expect(createDecisionJournalId(() => "uuid-1")).toBe("decision:uuid-1");
    expect(createDecisionJournalEventId(() => "uuid-2")).toBe("event:uuid-2");
    expect(() => createDecisionJournalId(() => "")).toThrow();
  });

});