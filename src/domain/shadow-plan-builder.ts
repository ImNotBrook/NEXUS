import {
  validateDecisionJournalRecord,
  type DecisionJournalRecord,
} from "./decision-journal";
import {
  validateShadowTradePlan,
  type ShadowTradePlan,
} from "./shadow-outcome-engine";

export const SHADOW_OUTCOME_INTERVAL_MS = 60 * 60 * 1000;
export const SHADOW_OUTCOME_HORIZON_MS = 24 * SHADOW_OUTCOME_INTERVAL_MS;
export const SHADOW_SIMULATION_VERSION = "spot-shadow-v1";

export type ShadowPlanBuildResult =
  | { status: "ready"; plan: ShadowTradePlan }
  | { status: "not_simulatable"; reasonCode: string; explanation: string };

function blocked(reasonCode: string, explanation: string): ShadowPlanBuildResult {
  return { status: "not_simulatable", reasonCode, explanation };
}

/**
 * Derives a fixed shadow plan exclusively from the immutable decision-time
 * candidate. It never selects an entry from subsequent candles.
 */
export function buildShadowTradePlan(
  decision: DecisionJournalRecord,
): ShadowPlanBuildResult {
  try {
    validateDecisionJournalRecord(decision);
  } catch {
    return blocked("INVALID_DECISION_RECORD", "The immutable decision record failed validation");
  }

  if (!decision.candidate) {
    return blocked("NO_CANDIDATE", "No candidate existed at decision time; NO_SETUP discovery is a separate causal process");
  }
  if (["MARKET_DATA_NOT_READY", "MARKET_EVIDENCE_NOT_CAUSAL", "MARKET_CANDLE_SNAPSHOT_MISMATCH"]
    .some((code) => decision.reasonCodes.includes(code))) {
    return blocked("DECISION_DATA_NOT_READY", "The original decision was blocked by market-data readiness");
  }

  const candidate = decision.candidate;
  if (
    candidate.symbol !== decision.symbol ||
    candidate.timeframe !== decision.timeframe ||
    !candidate.id.trim()
  ) {
    return blocked("DECISION_CANDIDATE_MISMATCH", "Candidate identity does not match its parent decision");
  }
  if (decision.status !== "ENTER" && decision.status !== "WAIT" && decision.status !== "REJECT") {
    return blocked("UNSUPPORTED_DECISION_STATUS", "Only ENTER, WAIT and candidate-bearing REJECT decisions have shadow-plan semantics");
  }
  if (!candidate.triggerConfirmed) {
    return blocked("NO_PREDECLARED_ENTRY_TRIGGER", "An untriggered candidate has no fixed limit trigger; a future entry price cannot be invented");
  }
  if (candidate.side !== "long" || !/^[A-Z0-9]{3,30}$/.test(candidate.symbol)) {
    return blocked("UNSUPPORTED_SPOT_SHORT", "Shadow simulator v1 supports spot long plans only");
  }

  const earliestEligibleAt = (Math.floor(decision.decisionAt / SHADOW_OUTCOME_INTERVAL_MS) + 1) *
    SHADOW_OUTCOME_INTERVAL_MS;
  if (!Number.isSafeInteger(earliestEligibleAt) || earliestEligibleAt >= candidate.expiresAt) {
    return blocked("ENTRY_WINDOW_CLOSED", "The candidate expires before a full post-decision hourly candle can become eligible");
  }
  const desiredHorizon = Math.max(
    decision.decisionAt + SHADOW_OUTCOME_HORIZON_MS,
    candidate.expiresAt + 1,
  );
  // The first candle opening at/after this boundary proves maturity but is
  // excluded from OHLC evaluation. horizonEnd is the final included millisecond.
  const horizonEnd = Math.ceil(desiredHorizon / SHADOW_OUTCOME_INTERVAL_MS) *
    SHADOW_OUTCOME_INTERVAL_MS - 1;
  if (!Number.isSafeInteger(horizonEnd)) {
    return blocked("INVALID_OUTCOME_HORIZON", "The fixed 24-hour outcome horizon exceeds safe timestamp bounds");
  }

  const plan: ShadowTradePlan = {
    schemaVersion: 1,
    simulationVersion: SHADOW_SIMULATION_VERSION,
    decisionId: decision.decisionId,
    candidateId: candidate.id,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    instrumentCategory: "spot",
    volumeUnit: "base",
    side: candidate.side,
    decisionAt: decision.decisionAt,
    entry: {
      orderType: "market",
      referencePrice: candidate.plan.entryPrice,
      earliestEligibleAt,
      expiresAt: candidate.expiresAt,
      penetrationBps: 5,
    },
    stopPrice: candidate.plan.stopPrice,
    targetPrice: candidate.plan.targetPrices[0],
    quantity: candidate.plan.quantity,
    horizonEnd,
    sameBarPolicy: "adverse_stop_first",
    executionModel: {
      feeRate: 0.001,
      baseSlippageBps: 10,
      halfSpreadBps: 0,
      maxParticipationRate: 0.05,
      marketImpactBpsAtMaxParticipation: 5,
    },
  };

  try {
    validateShadowTradePlan(plan);
  } catch {
    return blocked("INVALID_SHADOW_PLAN", "The original candidate cannot be represented by the spot shadow simulator");
  }
  return { status: "ready", plan };
}
