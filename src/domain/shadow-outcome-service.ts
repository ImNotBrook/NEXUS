import type { DecisionJournalEvent, DecisionJournalRecord } from "./decision-journal";
import {
  evaluateLearningCohorts,
  type LearningObservation,
  type LearningReport,
} from "./learning-engine";
import { journalShadowOutcome, type ShadowOutcomeDataQuality, type ShadowOutcomeHasher, type ShadowOutcomeJournal } from "./journalled-shadow-outcome";
import { validateCandles, type Candle } from "./candles";
import { validateShadowTradePlan, type ShadowOutcome, type ShadowTradePlan } from "./shadow-outcome-engine";
import { SHADOW_OUTCOME_INTERVAL_MS } from "./shadow-plan-builder";

export interface ShadowOutcomeServiceJournal extends ShadowOutcomeJournal {
  list(limit?: number): Promise<DecisionJournalRecord[]>;
}

export interface ShadowHistoryAudit {
  quality: ShadowOutcomeDataQuality;
  horizonReached: boolean;
  observedThrough: number | null;
  reasonCode: string;
  simulationSafe: boolean;
}

export interface ShadowOutcomeFailure {
  decisionId: string;
  reason: string;
}

export interface ShadowOutcomeRow {
  decisionId: string;
  symbol: string;
  decisionStatus: DecisionJournalRecord["status"];
  simulationVersion: string;
  outcomeStatus: ShadowOutcome["status"];
  horizonReached: boolean;
  dataQuality: ShadowOutcomeDataQuality;
  observedThrough: number | null;
}

export interface ShadowOutcomeServiceReport {
  decisionsScanned: number;
  latestOutcomes: ShadowOutcomeRow[];
  plansEvaluated: number;
  outcomesRecorded: number;
  outcomesUnchanged: number;
  legacyDecisionsSkipped: number;
  failures: ShadowOutcomeFailure[];
  learning: LearningReport;
}

export interface EvaluateShadowOutcomesInput {
  journal: ShadowOutcomeServiceJournal;
  now: number;
  fetchHistory: (plan: ShadowTradePlan) => Promise<readonly Candle[]>;
  hasher?: ShadowOutcomeHasher;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Audits chronological coverage before any outcome can enter the learning engine. */
export function auditShadowHistory(
  plan: ShadowTradePlan,
  input: readonly Candle[],
): ShadowHistoryAudit {
  let candles: Candle[];
  try {
    candles = validateCandles(input);
  } catch {
    return {
      quality: "fail", horizonReached: false, observedThrough: null,
      reasonCode: "INVALID_HISTORICAL_CANDLES", simulationSafe: false,
    };
  }
  if (candles.length === 0) {
    return {
      quality: "degraded", horizonReached: false, observedThrough: null,
      reasonCode: "NO_CLOSED_HISTORY_YET", simulationSafe: true,
    };
  }
  if (candles[0].timestamp !== plan.entry.earliestEligibleAt) {
    return {
      quality: "fail", horizonReached: false, observedThrough: null,
      reasonCode: "HISTORY_START_GAP", simulationSafe: true,
    };
  }
  if (candles.some((candle) =>
    candle.timestamp <= plan.decisionAt ||
    candle.timestamp > plan.horizonEnd + SHADOW_OUTCOME_INTERVAL_MS ||
    candle.timestamp % SHADOW_OUTCOME_INTERVAL_MS !== 0
  )) {
    return {
      quality: "fail", horizonReached: false, observedThrough: null,
      reasonCode: "HISTORY_TIMESTAMP_OUT_OF_SCOPE", simulationSafe: true,
    };
  }
  for (let index = 1; index < candles.length; index++) {
    if (candles[index].timestamp - candles[index - 1].timestamp !== SHADOW_OUTCOME_INTERVAL_MS) {
      return {
        quality: "fail", horizonReached: false, observedThrough: null,
        reasonCode: "HISTORICAL_GAP", simulationSafe: true,
      };
    }
  }
  const proof = candles.find((candle) => candle.timestamp >= plan.horizonEnd) ?? null;
  if (candles.some((candle) => candle.volume === 0)) {
    return {
      quality: "degraded", horizonReached: Boolean(proof), observedThrough: proof?.timestamp ?? null,
      reasonCode: "ZERO_VOLUME_BAR", simulationSafe: true,
    };
  }
  return {
    quality: "pass",
    horizonReached: Boolean(proof),
    observedThrough: proof?.timestamp ?? null,
    reasonCode: proof ? "CONTIGUOUS_HISTORY_HORIZON_PROVEN" : "CONTIGUOUS_HISTORY_IN_PROGRESS",
    simulationSafe: true,
  };
}

function registeredPlan(event: DecisionJournalEvent): ShadowTradePlan | null {
  if (event.eventType !== "shadow_plan_registered" || !object(event.payload)) return null;
  const plan = event.payload.plan;
  if (!object(plan)) return null;
  try {
    validateShadowTradePlan(plan as unknown as ShadowTradePlan);
  } catch {
    return null;
  }
  return plan as unknown as ShadowTradePlan;
}

function learningObservation(
  event: DecisionJournalEvent,
  decision: DecisionJournalRecord,
): LearningObservation | null {
  if (event.eventType !== "outcome_appended" || !object(event.payload)) return null;
  const { plan, outcome, observedThrough, dataQuality } = event.payload;
  if (!object(plan) || !object(outcome) ||
      !["pass", "degraded", "fail"].includes(String(dataQuality)) ||
      (observedThrough !== null && !Number.isSafeInteger(observedThrough))) return null;
  return {
    observationId: event.eventId,
    recordedAt: event.occurredAt,
    observedThrough: observedThrough as number | null,
    dataQuality: dataQuality as ShadowOutcomeDataQuality,
    decision,
    plan: plan as unknown as ShadowTradePlan,
    outcome: outcome as unknown as ShadowOutcome,
  };
}

/**
 * Collects only pre-registered plans, fetches bounded post-decision history,
 * appends content-addressed outcome snapshots and produces maturity-gated
 * descriptive cohorts. It cannot mutate decisions or paper-account balances.
 */
export async function evaluateShadowOutcomes(
  input: EvaluateShadowOutcomesInput,
): Promise<ShadowOutcomeServiceReport> {
  if (!input || !input.journal || typeof input.fetchHistory !== "function") {
    throw new TypeError("A journal and historical candle loader are required");
  }
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new RangeError("Outcome evaluation time must be a non-negative safe integer");
  }
  const decisions = await input.journal.list(500);
  const failures: ShadowOutcomeFailure[] = [];
  let plansEvaluated = 0;
  let outcomesRecorded = 0;
  let outcomesUnchanged = 0;
  let legacyDecisionsSkipped = 0;

  for (const decision of decisions) {
    const events = await input.journal.listEvents(decision.decisionId);
    const planEvents = events.filter((event) => event.eventType === "shadow_plan_registered");
    if (decision.candidate && planEvents.length === 0) {
      legacyDecisionsSkipped++;
      continue;
    }
    for (const event of planEvents) {
      const plan = registeredPlan(event);
      if (!plan || plan.decisionId !== decision.decisionId || event.occurredAt !== decision.decisionAt) {
        failures.push({ decisionId: decision.decisionId, reason: "Invalid or mismatched registered shadow plan" });
        continue;
      }
      plansEvaluated++;
      try {
        const candles = await input.fetchHistory(plan);
        const audit = auditShadowHistory(plan, candles);
        if (!audit.simulationSafe) throw new Error(audit.reasonCode);
        const result = await journalShadowOutcome(
          plan,
          candles,
          input.now,
          input.journal,
          input.hasher,
          audit.quality,
        );
        if (result.alreadyRecorded) outcomesUnchanged++;
        else outcomesRecorded++;
      } catch (error) {
        failures.push({
          decisionId: decision.decisionId,
          reason: error instanceof Error ? error.message : "Unknown shadow outcome failure",
        });
      }
    }
  }

  const observations: LearningObservation[] = [];
  const latestOutcomes: ShadowOutcomeRow[] = [];
  for (const decision of decisions) {
    const events = await input.journal.listEvents(decision.decisionId);
    const outcomeEvents = events.filter((event) => event.eventType === "outcome_appended" && object(event.payload));
    for (const event of outcomeEvents) {
      const observation = learningObservation(event, decision);
      if (observation) observations.push(observation);
    }
    const latest = [...outcomeEvents].sort((left, right) => {
      const leftThrough = Number(left.payload.observedThrough ?? -1);
      const rightThrough = Number(right.payload.observedThrough ?? -1);
      return rightThrough - leftThrough || right.occurredAt - left.occurredAt || right.eventId.localeCompare(left.eventId);
    })[0];
    if (latest && object(latest.payload) &&
        object(latest.payload.outcome) && object(latest.payload.plan)) {
      const outcome = latest.payload.outcome as unknown as ShadowOutcome;
      const plan = latest.payload.plan as unknown as ShadowTradePlan;
      try {
        validateShadowTradePlan(plan);
      } catch {
        failures.push({ decisionId: decision.decisionId, reason: "Invalid plan in stored outcome event" });
        continue;
      }
      if (!["pending", "expired", "open", "completed", "ambiguous", "invalidated"].includes(outcome.status)) {
        failures.push({ decisionId: decision.decisionId, reason: "Invalid outcome status in stored event" });
        continue;
      }
      latestOutcomes.push({
        decisionId: decision.decisionId,
        symbol: decision.symbol,
        decisionStatus: decision.status,
        simulationVersion: plan.simulationVersion,
        outcomeStatus: outcome.status,
        horizonReached: outcome.horizonReached,
        dataQuality: latest.payload.dataQuality as ShadowOutcomeDataQuality,
        observedThrough: latest.payload.observedThrough as number | null,
      });
    }
  }

  return {
    decisionsScanned: decisions.length,
    latestOutcomes,
    plansEvaluated,
    outcomesRecorded,
    outcomesUnchanged,
    legacyDecisionsSkipped,
    failures,
    learning: evaluateLearningCohorts(observations),
  };
}
