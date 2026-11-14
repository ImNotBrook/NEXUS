import {
  assessCandidateGates,
  type CandidateGateAssessment,
  type CandidateGatePolicy,
} from "./decision-gates";
import type { DecisionJournalVersions } from "./decision-journal";
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
import { buildShadowTradePlan, type ShadowPlanBuildResult } from "./shadow-plan-builder";
import { registerShadowPlan, type ShadowOutcomeJournal } from "./journalled-shadow-outcome";
import { buildNoSetupReplaySpec, registerNoSetupReplay } from "./no-setup-replay";

export interface DecisionWorkbenchJournal extends MarketDecisionJournal, DecisionJournalWriter, ShadowOutcomeJournal {}

export interface DecisionWorkbenchInput {
  snapshot: MarketIntelligenceSnapshot;
  candles: readonly Candle[];
  crossFeedStatus: CrossFeedStatus;
  strategy: ApprovedDonchianStrategy;
  evaluationTime: number;
  gatePolicy: Omit<CandidateGatePolicy, "candleVolume">;
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
  gateAssessment: CandidateGateAssessment | null;
  shadowPlan: ShadowPlanBuildResult;
  shadowPlanRegistered: boolean;
  noSetupReplayRegistered: boolean;
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
    if (input.gatePolicy.instrumentCategory !== input.snapshot.instrumentCategory) {
      throw new TypeError("Risk policy instrument category must match the market snapshot");
    }
    const latestCandle = input.candles[input.candles.length - 1];
    if (!latestCandle) throw new RangeError("A candidate cannot be gated without a latest completed candle");
    const gates = assessCandidateGates(generation.candidate, {
      ...input.gatePolicy,
      candleVolume: latestCandle.volume,
    });
    const thesis = {
      ...generation.thesis,
      alternatives: [
        ...generation.thesis.alternatives,
        "Human strategy approval by " + generation.strategyRef.approval!.approvedBy +
          " at " + generation.strategyRef.approval!.approvedAt + ": " +
          generation.strategyRef.approval!.rationale,
      ],
    };
    const assessment = await evaluateMarketCandidateAndJournal({
      snapshot: input.snapshot,
      candidate: generation.candidate,
      crossFeedStatus: input.crossFeedStatus,
      riskGate: gates.riskGate,
      economicsGate: gates.economicsGate,
      minimumSupportingFamilies: input.minimumSupportingFamilies,
      thesis,
      versions,
      clockSource: input.clockSource,
      journal: input.journal,
      decisionId: input.decisionId,
      randomUUID: input.randomUUID,
    });
    const shadowPlan = buildShadowTradePlan(assessment.record);
    let shadowPlanRegistered = false;
    if (shadowPlan.status === "ready") {
      await registerShadowPlan(shadowPlan.plan, input.journal);
      shadowPlanRegistered = true;
    }
    return { generation, assessment, gateAssessment: gates, shadowPlan, shadowPlanRegistered, noSetupReplayRegistered: false };
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
      ...(generation.strategyRef.approval
        ? ["Human strategy approval by " + generation.strategyRef.approval.approvedBy +
            " at " + generation.strategyRef.approval.approvedAt + ": " +
            generation.strategyRef.approval.rationale]
        : []),
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
      riskGate: { eligible: true, reasonCodes: [] },
      economicsGate: { eligible: true, reasonCodes: [] },
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
  const assessment = { ...journalled, marketDataStatus: dataStatus };
  const shadowPlan = buildShadowTradePlan(assessment.record);
  const replaySpec = buildNoSetupReplaySpec({
    decisionId: assessment.record.decisionId,
    decisionAt: assessment.record.decisionAt,
    symbol: assessment.record.symbol,
    timeframe: assessment.record.timeframe,
    status: assessment.record.status,
    reasonCodes: assessment.record.reasonCodes,
    candles: input.candles,
    strategy: input.strategy,
  });
  let noSetupReplayRegistered = false;
  if (replaySpec) {
    await registerNoSetupReplay(replaySpec, input.journal);
    noSetupReplayRegistered = true;
  }
  return {
    generation,
    assessment,
    gateAssessment: null,
    shadowPlan,
    shadowPlanRegistered: false,
    noSetupReplayRegistered,
  };
}
