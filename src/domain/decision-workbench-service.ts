import type { DecisionGate, DecisionResult } from "./decision-engine";
import type { DecisionJournalRecord, DecisionJournalVersions } from "./decision-journal";
import {
  evaluateAndJournalDecision,
  type DecisionJournalWriter,
  type JournalledDecisionResult,
} from "./journalled-decision-pipeline";
import {
  evaluateMarketCandidateAndJournal,
  type MarketDecisionJournal,
} from "./market-decision-service";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { CrossFeedStatus } from "./market-intelligence-service";
import {
  generateDonchianStrategyCandidate,
  type ApprovedDonchianStrategy,
} from "./strategy-candidate-generator";
import type { Candle } from "./candles";

export interface DecisionWorkbenchJournal extends MarketDecisionJournal, DecisionJournalWriter {}

export interface DecisionWorkbenchInput {
  snapshot: MarketIntelligenceSnapshot;
  candles: readonly Candle[];
  crossFeedStatus: CrossFeedStatus;
  strategy: ApprovedDonchianStrategy;
  evaluationTime: number;
  riskGate: DecisionGate;
  economicsGate: DecisionGate;
  minimumSupportingFamilies: number;
  versions: DecisionJournalVersions;
  clockSource: string;
  journal: DecisionWorkbenchJournal;
  decisionId?: string;
  randomUUID?: () => string;
}

export interface DecisionWorkbenchAssessment extends JournalledDecisionResult {
  marketDataStatus: "pass" | "degraded" | "fail";
}

export interface DecisionWorkbenchResult {
  generation: ReturnType<typeof generateDonchianStrategyCandidate>;
  assessment: DecisionWorkbenchAssessment;
}

function marketDataStatus(
  snapshot: MarketIntelligenceSnapshot,
  crossFeedStatus: CrossFeedStatus,
): DecisionWorkbenchAssessment["marketDataStatus"] {
  if (snapshot.dataQuality === "fail" || crossFeedStatus === "discrepancy" ||
      snapshot.frames["1h"].status !== "available") return "fail";
  if (snapshot.dataQuality === "degraded" || crossFeedStatus !== "within_tolerance") return "degraded";
  return "pass";
}

/**
 * Stage 2 orchestration boundary:
 * approved deterministic strategy -> candidate -> market evidence -> hard gates
 * -> decision kernel -> append-only journal. No execution adapter is reachable.
 */
export async function runDecisionWorkbench(
  input: DecisionWorkbenchInput,
): Promise<DecisionWorkbenchResult> {
  if (!input || typeof input !== "object") throw new TypeError("Decision workbench input is required");
  const generation = generateDonchianStrategyCandidate({
    snapshot: input.snapshot,
    candles: input.candles,
    crossFeedStatus: input.crossFeedStatus,
    strategy: input.strategy,
    evaluationTime: input.evaluationTime,
  });
  const versions: DecisionJournalVersions = {
    ...structuredClone(input.versions),
    strategy: input.strategy.id + "@" + input.strategy.version,
  };

  if (generation.candidate) {
    const assessment = await evaluateMarketCandidateAndJournal({
      snapshot: input.snapshot,
      candidate: generation.candidate,
      crossFeedStatus: input.crossFeedStatus,
      riskGate: input.riskGate,
      economicsGate: input.economicsGate,
      minimumSupportingFamilies: input.minimumSupportingFamilies,
      thesis: generation.thesis,
      versions,
      clockSource: input.clockSource,
      journal: input.journal,
      decisionId: input.decisionId,
      randomUUID: input.randomUUID,
    });
    return { generation, assessment };
  }

  const disposition: "WAIT" | "REJECT" | "NO_SETUP" =
    generation.status === "no_setup"
      ? "NO_SETUP"
      : generation.reasonCodes.includes("STRATEGY_NOT_APPROVED")
        ? "REJECT"
        : "WAIT";
  const dataStatus = marketDataStatus(input.snapshot, input.crossFeedStatus);
  const thesis = {
    bullCase: [...generation.thesis.bullCase],
    bearCase: [...generation.thesis.bearCase],
    alternatives: [
      ...generation.thesis.alternatives,
      ...generation.reasonCodes.map((reason) => "Candidate generator: " + reason),
    ],
    invalidation: [...generation.thesis.invalidation],
  };
  const journalled = await evaluateAndJournalDecision(
    {
      evaluationTime: input.evaluationTime,
      candidate: null,
      candidateAbsenceStatus: disposition,
      candidateAbsenceReasonCodes: generation.reasonCodes,
      marketDataStatus: dataStatus,
      riskGate: structuredClone(input.riskGate),
      economicsGate: structuredClone(input.economicsGate),
      minimumSupportingFamilies: input.minimumSupportingFamilies,
      evidence: [],
    },
    {
      decisionId: input.decisionId,
      clockSource: input.clockSource,
      symbol: input.snapshot.symbol,
      timeframe: "1h",
      marketSnapshotRefs: [{
        snapshotId: input.snapshot.snapshotId,
        contentHash: input.snapshot.contentHash,
      }],
      thesis,
      versions,
    },
    input.journal,
    input.randomUUID,
  );
  return {
    generation,
    assessment: { ...journalled, marketDataStatus: dataStatus },
  };
}
