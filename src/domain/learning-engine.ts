import {
  validateDecisionJournalRecord,
  type DecisionJournalRecord,
  type DecisionStatus,
} from "./decision-journal";
import { validateShadowTradePlan, type ShadowOutcome, type ShadowTradePlan } from "./shadow-outcome-engine";

export type LearningDataQuality = "pass" | "degraded" | "fail";

export interface LearningObservation {
  /** Immutable Decision Journal event ID. */
  observationId: string;
  /** Time the outcome event was appended, in the same epoch as market timestamps. */
  recordedAt: number;
  /** Latest market-candle timestamp observed by the collector, including the horizon proof candle. */
  observedThrough: number | null;
  /** Must be supplied by the upstream market-data quality audit. */
  dataQuality: LearningDataQuality;
  decision: DecisionJournalRecord;
  plan: ShadowTradePlan;
  outcome: ShadowOutcome;
}

export type LearningExclusionReason =
  | "invalid_observation"
  | "duplicate_observation_id"
  | "data_quality_not_passed"
  | "no_candidate"
  | "identity_mismatch"
  | "recorded_before_horizon"
  | "observation_timestamp_in_future"
  | "horizon_not_reached"
  | "ambiguous_path"
  | "unresolved_position"
  | "invalid_fill_accounting"
  | "superseded_observation";

export interface LearningExclusion {
  observationId: string;
  decisionId: string;
  reason: LearningExclusionReason;
}

export interface LearningCohort {
  symbol: string;
  timeframe: string;
  decisionStatus: DecisionStatus;
  setupFamily: string;
  maturedCandidates: number;
  completedTrades: number;
  noFillCandidates: number;
  /** Mean net P&L divided by gross price risk (entry-to-stop); null with no completed trades. */
  meanNetR: number | null;
  medianNetR: number | null;
  /** Fraction of completed trades with net R > 0; null with no completed trades. */
  winRate: number | null;
  meanMfeBps: number | null;
  meanMaeBps: number | null;
}

export interface LearningReport {
  eligibleObservations: number;
  excluded: LearningExclusion[];
  cohorts: LearningCohort[];
}

interface EligibleSample {
  observation: LearningObservation;
  netR: number | null;
}

const EPSILON = 1e-9;

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(EPSILON, Math.max(Math.abs(left), Math.abs(right)) * EPSILON);
}

function exclusion(
  observation: LearningObservation,
  reason: LearningExclusionReason,
): LearningExclusion {
  return {
    observationId: typeof observation?.observationId === "string" ? observation.observationId : "unknown",
    decisionId: typeof observation?.decision?.decisionId === "string" ? observation.decision.decisionId : "unknown",
    reason,
  };
}

function validateIdentity(observation: LearningObservation): boolean {
  const { decision, plan, outcome } = observation;
  const candidate = decision.candidate;
  if (!candidate) return false;
  const candidatePlan = candidate.plan;
  return (
    decision.decisionId === plan.decisionId &&
    decision.decisionAt === plan.decisionAt &&
    decision.symbol === plan.symbol &&
    decision.timeframe === plan.timeframe &&
    candidate.id === plan.candidateId &&
    candidate.symbol === plan.symbol &&
    candidate.timeframe === plan.timeframe &&
    candidate.side === plan.side &&
    outcome.decisionId === plan.decisionId &&
    outcome.candidateId === plan.candidateId &&
    outcome.simulationVersion === plan.simulationVersion &&
    candidatePlan.targetPrices.length === 1 &&
    closeEnough(candidatePlan.entryPrice, plan.entry.referencePrice) &&
    closeEnough(candidatePlan.stopPrice, plan.stopPrice) &&
    closeEnough(candidatePlan.targetPrices[0], plan.targetPrice) &&
    closeEnough(candidatePlan.quantity, plan.quantity) &&
    (plan.entry.orderType !== "limit" ||
      closeEnough(candidatePlan.entryPrice, plan.entry.limitPrice ?? Number.NaN)) &&
    plan.entry.expiresAt <= candidate.expiresAt &&
    (candidate.triggerConfirmed || plan.entry.orderType === "limit")
  );
}

function completedNetR(plan: ShadowTradePlan, outcome: ShadowOutcome): number | null {
  if (
    outcome.status !== "completed" ||
    !Number.isFinite(outcome.entryFilledQuantity) ||
    outcome.entryFilledQuantity <= 0 ||
    !Number.isFinite(outcome.exitFilledQuantity) ||
    !closeEnough(outcome.exitFilledQuantity, outcome.entryFilledQuantity) ||
    !Number.isFinite(outcome.positionRemainingQuantity) ||
    outcome.positionRemainingQuantity > EPSILON ||
    !Number.isFinite(outcome.entryAveragePrice) ||
    (outcome.entryAveragePrice ?? 0) <= plan.stopPrice ||
    !Number.isFinite(outcome.exitAveragePrice) ||
    !Number.isFinite(outcome.netPnl) ||
    !Number.isFinite(outcome.mfeBps) ||
    !Number.isFinite(outcome.maeBps)
  ) {
    return null;
  }
  const grossPriceRisk = ((outcome.entryAveragePrice as number) - plan.stopPrice) *
    outcome.entryFilledQuantity;
  if (!Number.isFinite(grossPriceRisk) || grossPriceRisk <= 0) return null;
  return outcome.netPnl / grossPriceRisk;
}

function cohortKey(sample: LearningObservation): string {
  const candidate = sample.decision.candidate!;
  return JSON.stringify([
    sample.plan.symbol,
    sample.plan.timeframe,
    sample.decision.status,
    candidate.setupFamily,
  ]);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Produces descriptive, maturity-gated cohort metrics only.
 * It does not tune parameters, alter weights, or approve strategy changes.
 */
export function evaluateLearningCohorts(
  observations: readonly LearningObservation[],
): LearningReport {
  if (!Array.isArray(observations)) throw new TypeError("Learning observations must be an array");

  const excluded: LearningExclusion[] = [];
  const seenObservationIds = new Set<string>();
  const eligible: EligibleSample[] = [];

  for (const observation of observations) {
    if (
      !observation ||
      typeof observation !== "object" ||
      typeof observation.observationId !== "string" ||
      !observation.observationId.trim()
    ) {
      excluded.push(exclusion(observation, "invalid_observation"));
      continue;
    }
    if (seenObservationIds.has(observation.observationId)) {
      excluded.push(exclusion(observation, "duplicate_observation_id"));
      continue;
    }
    seenObservationIds.add(observation.observationId);

    try {
      validateDecisionJournalRecord(observation.decision);
      validateShadowTradePlan(observation.plan);
    } catch {
      excluded.push(exclusion(observation, "invalid_observation"));
      continue;
    }

    if (!["pass", "degraded", "fail"].includes(observation.dataQuality) ||
        observation.dataQuality !== "pass") {
      excluded.push(exclusion(observation, "data_quality_not_passed"));
      continue;
    }
    if (!observation.decision.candidate) {
      excluded.push(exclusion(observation, "no_candidate"));
      continue;
    }
    if (!validateIdentity(observation)) {
      excluded.push(exclusion(observation, "identity_mismatch"));
      continue;
    }
    if (!validTimestamp(observation.recordedAt) ||
        observation.recordedAt < observation.plan.horizonEnd) {
      excluded.push(exclusion(observation, "recorded_before_horizon"));
      continue;
    }
    if (!validTimestamp(observation.observedThrough) ||
        observation.observedThrough > observation.recordedAt) {
      excluded.push(exclusion(observation, "observation_timestamp_in_future"));
      continue;
    }
    if (!observation.outcome.horizonReached ||
        observation.observedThrough < observation.plan.horizonEnd) {
      excluded.push(exclusion(observation, "horizon_not_reached"));
      continue;
    }
    if (observation.outcome.status === "ambiguous") {
      excluded.push(exclusion(observation, "ambiguous_path"));
      continue;
    }
    if (observation.outcome.status === "open" || observation.outcome.status === "pending") {
      excluded.push(exclusion(observation, "unresolved_position"));
      continue;
    }

    if (observation.outcome.status === "completed") {
      const netR = completedNetR(observation.plan, observation.outcome);
      if (netR === null) {
        excluded.push(exclusion(observation, "invalid_fill_accounting"));
        continue;
      }
      eligible.push({ observation, netR });
      continue;
    }

    if (
      (observation.outcome.status === "expired" || observation.outcome.status === "invalidated") &&
      observation.outcome.entryFilledQuantity === 0 &&
      observation.outcome.exitFilledQuantity === 0 &&
      observation.outcome.positionRemainingQuantity === 0 &&
      observation.outcome.netPnl === 0
    ) {
      eligible.push({ observation, netR: null });
      continue;
    }

    excluded.push(exclusion(observation, "invalid_fill_accounting"));
  }

  // Outcome snapshots evolve as more candles arrive. Only the latest mature
  // snapshot for a decision/candidate/simulation version enters a cohort.
  const latestByPlan = new Map<string, EligibleSample>();
  for (const sample of eligible) {
    const key = [
      sample.observation.plan.decisionId,
      sample.observation.plan.candidateId,
      sample.observation.plan.simulationVersion,
    ].join("|");
    const current = latestByPlan.get(key);
    if (!current ||
        sample.observation.recordedAt > current.observation.recordedAt ||
        (sample.observation.recordedAt === current.observation.recordedAt &&
          sample.observation.observationId.localeCompare(current.observation.observationId) > 0)) {
      if (current) excluded.push(exclusion(current.observation, "superseded_observation"));
      latestByPlan.set(key, sample);
    } else {
      excluded.push(exclusion(sample.observation, "superseded_observation"));
    }
  }

  const cohortsMap = new Map<string, EligibleSample[]>();
  for (const sample of latestByPlan.values()) {
    const key = cohortKey(sample.observation);
    const cohort = cohortsMap.get(key) ?? [];
    cohort.push(sample);
    cohortsMap.set(key, cohort);
  }

  const cohorts: LearningCohort[] = [...cohortsMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, samples]) => {
      const completed = samples.filter((sample) => sample.netR !== null);
      const netRs = completed.map((sample) => sample.netR as number);
      const outcomes = completed.map((sample) => sample.observation.outcome);
      return {
        symbol: samples[0].observation.plan.symbol,
        timeframe: samples[0].observation.plan.timeframe,
        decisionStatus: samples[0].observation.decision.status,
        setupFamily: samples[0].observation.decision.candidate!.setupFamily,
        maturedCandidates: samples.length,
        completedTrades: completed.length,
        noFillCandidates: samples.length - completed.length,
        meanNetR: mean(netRs),
        medianNetR: median(netRs),
        winRate: netRs.length ? netRs.filter((value) => value > 0).length / netRs.length : null,
        meanMfeBps: mean(outcomes.map((outcome) => outcome.mfeBps)),
        meanMaeBps: mean(outcomes.map((outcome) => outcome.maeBps)),
      };
    });

  return {
    eligibleObservations: latestByPlan.size,
    excluded,
    cohorts,
  };
}
