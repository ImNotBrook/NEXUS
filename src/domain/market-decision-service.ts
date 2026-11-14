import type { DecisionCandidate, DecisionGate } from "./decision-engine";
import type {
  DecisionJournalThesis,
  DecisionJournalVersions,
} from "./decision-journal";
import {
  evaluateAndJournalDecision,
  type DecisionJournalWriter,
  type JournalledDecisionResult,
} from "./journalled-decision-pipeline";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { CrossFeedStatus } from "./market-intelligence-service";
import { buildDecisionEvidenceFromMarketSnapshot } from "./market-decision-evidence";

export interface MarketDecisionJournal extends DecisionJournalWriter {}

export interface EvaluateMarketCandidateInput {
  snapshot: MarketIntelligenceSnapshot;
  candidate: DecisionCandidate;
  crossFeedStatus: CrossFeedStatus;
  riskGate: DecisionGate;
  economicsGate: DecisionGate;
  minimumSupportingFamilies: number;
  thesis: DecisionJournalThesis;
  versions: DecisionJournalVersions;
  clockSource: string;
  journal: MarketDecisionJournal;
  decisionId?: string;
  randomUUID?: () => string;
}

export interface MarketDecisionAssessment extends JournalledDecisionResult {
  marketDataStatus: "pass" | "degraded" | "fail";
}

/**
 * Explicit application service joining market intelligence, candidate-relative
 * evidence, the deterministic decision kernel and append-only journal storage.
 * It never creates a candidate or bypasses the risk/economics gates.
 */
export async function evaluateMarketCandidateAndJournal(
  input: EvaluateMarketCandidateInput,
): Promise<MarketDecisionAssessment> {
  if (!input || typeof input !== "object") throw new TypeError("Market decision input is required");
  if (!input.candidate || typeof input.candidate !== "object") {
    throw new TypeError("An explicit strategy candidate is required; this service does not invent setups");
  }

  const mapped = buildDecisionEvidenceFromMarketSnapshot(
    input.snapshot,
    input.candidate,
    input.crossFeedStatus,
  );

  const assessment = await evaluateAndJournalDecision(
    {
      evaluationTime: input.snapshot.evaluationTime,
      candidate: structuredClone(input.candidate),
      marketDataStatus: mapped.marketDataStatus,
      riskGate: structuredClone(input.riskGate),
      economicsGate: structuredClone(input.economicsGate),
      minimumSupportingFamilies: input.minimumSupportingFamilies,
      evidence: mapped.evidence,
    },
    {
      decisionId: input.decisionId,
      clockSource: input.clockSource,
      symbol: input.candidate.symbol,
      timeframe: input.candidate.timeframe,
      marketSnapshotRefs: [mapped.snapshotRef],
      thesis: structuredClone(input.thesis),
      versions: structuredClone(input.versions),
    },
    input.journal,
    input.randomUUID,
  );

  return { ...assessment, marketDataStatus: mapped.marketDataStatus };
}
