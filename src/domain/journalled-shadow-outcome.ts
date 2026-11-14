import {
  validateDecisionJournalEvent,
  type DecisionJournalEvent,
  type DecisionJournalRecord,
} from "./decision-journal";
import {
  simulateShadowOutcome,
  validateShadowTradePlan,
  type ShadowOutcome,
  type ShadowTradePlan,
} from "./shadow-outcome-engine";
import type { Candle } from "./candles";

export const MAX_SHADOW_OUTCOME_CANDLES = 5_000;

export interface ShadowOutcomeJournal {
  get(decisionId: string): Promise<DecisionJournalRecord | null>;
  appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent>;
  listEvents(decisionId: string): Promise<DecisionJournalEvent[]>;
}

export type ShadowOutcomeHasher = (value: unknown) => Promise<string>;
export type ShadowOutcomeDataQuality = "pass" | "degraded" | "fail";

export interface JournalledShadowOutcomeResult {
  outcome: ShadowOutcome;
  event: DecisionJournalEvent;
  alreadyRecorded: boolean;
}

export interface JournalledShadowPlanResult {
  event: DecisionJournalEvent;
  alreadyRecorded: boolean;
}

function jsonSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function sha256(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}


function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)) * 1e-9);
}

function assertPlanMatchesDecision(plan: ShadowTradePlan, decision: DecisionJournalRecord | null): void {
  if (!decision) throw new Error("Missing decision: parent record not found in the Decision Journal");
  const candidate = decision.candidate;
  if (!candidate) throw new Error("A shadow outcome requires a journalled candidate; NO_SETUP has no candidate");
  if (
    decision.decisionAt !== plan.decisionAt ||
    decision.symbol !== plan.symbol ||
    decision.timeframe !== plan.timeframe ||
    candidate.id !== plan.candidateId ||
    candidate.symbol !== plan.symbol ||
    candidate.timeframe !== plan.timeframe ||
    candidate.side !== plan.side
  ) {
    throw new Error("Shadow plan identity and scope do not match the parent decision candidate");
  }
  if (!candidate.triggerConfirmed && plan.entry.orderType !== "limit") {
    throw new Error("An unconfirmed candidate requires a pre-defined limit-entry trigger");
  }
  const candidatePlan = candidate.plan;
  if (
    candidatePlan.targetPrices.length !== 1 ||
    !approximatelyEqual(candidatePlan.entryPrice, plan.entry.referencePrice) ||
    !approximatelyEqual(candidatePlan.stopPrice, plan.stopPrice) ||
    !approximatelyEqual(candidatePlan.targetPrices[0], plan.targetPrice) ||
    !approximatelyEqual(candidatePlan.quantity, plan.quantity) ||
    (plan.entry.orderType === "limit" &&
      !approximatelyEqual(candidatePlan.entryPrice, plan.entry.limitPrice ?? Number.NaN)) ||
    plan.entry.expiresAt > candidate.expiresAt
  ) {
    throw new Error("Shadow plan execution parameters do not match the immutable decision candidate plan");
  }
}

/**
 * Registers the complete plan at the original decision timestamp, before any
 * outcome candles are observed. The event is content-addressed and immutable.
 */
export async function registerShadowPlan(
  plan: ShadowTradePlan,
  journal: ShadowOutcomeJournal,
  hasher: ShadowOutcomeHasher = sha256,
): Promise<JournalledShadowPlanResult> {
  validateShadowTradePlan(plan);
  const decision = await journal.get(plan.decisionId);
  assertPlanMatchesDecision(plan, decision);
  const hash = await hasher({ decisionId: plan.decisionId, plan: jsonSnapshot(plan) });
  if (typeof hash !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(hash)) {
    throw new TypeError("Shadow plan hasher must return a non-empty URL-safe identifier");
  }
  const event: DecisionJournalEvent = {
    schemaVersion: 1,
    eventId: "shadow-plan:" + hash,
    decisionId: plan.decisionId,
    eventType: "shadow_plan_registered",
    occurredAt: plan.decisionAt,
    payload: {
      candidateId: plan.candidateId,
      simulationVersion: plan.simulationVersion,
      plan: jsonSnapshot(plan),
    },
  };
  validateDecisionJournalEvent(event);
  const existing = (await journal.listEvents(plan.decisionId)).find((item) => item.eventId === event.eventId);
  if (existing) {
    if (existing.eventType === event.eventType && JSON.stringify(existing.payload) === JSON.stringify(event.payload)) {
      return { event: existing, alreadyRecorded: true };
    }
    throw new Error("Content-addressed shadow plan event ID conflicts with different immutable content");
  }
  try {
    const persisted = await journal.appendEvent(event);
    return { event: persisted, alreadyRecorded: false };
  } catch (error) {
    const match = (await journal.listEvents(plan.decisionId)).find((item) => item.eventId === event.eventId);
    if (match && match.eventType === event.eventType &&
        JSON.stringify(match.payload) === JSON.stringify(event.payload)) {
      return { event: match, alreadyRecorded: true };
    }
    throw error;
  }
}

/**
 * Simulates a fixed shadow plan and appends an immutable, content-addressed
 * outcome event. Re-running the same input at the same recordedAt is idempotent.
 */
export async function journalShadowOutcome(
  plan: ShadowTradePlan,
  inputCandles: readonly Candle[],
  recordedAt: number,
  journal: ShadowOutcomeJournal,
  hasher: ShadowOutcomeHasher = sha256,
  dataQuality: ShadowOutcomeDataQuality = "degraded",
): Promise<JournalledShadowOutcomeResult> {
  if (!Number.isSafeInteger(recordedAt) || recordedAt < plan.decisionAt) {
    throw new RangeError("A valid recording timestamp at or after the decision time is required");
  }
  assertPlanMatchesDecision(plan, await journal.get(plan.decisionId));

  if (!["pass", "degraded", "fail"].includes(dataQuality)) {
    throw new TypeError("Shadow outcome data quality is invalid");
  }
  const outcome = simulateShadowOutcome(plan, inputCandles);
  const relevantCandles = inputCandles
    .filter((candle) => candle.timestamp > plan.decisionAt && candle.timestamp <= plan.horizonEnd)
    .map((candle) => ({
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));

  if (relevantCandles.length > MAX_SHADOW_OUTCOME_CANDLES) {
    throw new RangeError("Shadow outcome windows are limited to 5000 candles");
  }

  const planSnapshot = jsonSnapshot(plan);
  const observedThrough = inputCandles.find((candle) => candle.timestamp >= plan.horizonEnd)?.timestamp ??
    (inputCandles.length ? inputCandles[inputCandles.length - 1].timestamp : null);
  const hashInput = {
    decisionId: plan.decisionId,
    plan: planSnapshot,
    candles: relevantCandles,
    horizonReached: outcome.horizonReached,
    observedThrough,
    dataQuality,
  };
  const inputHash = await hasher(hashInput);
  if (typeof inputHash !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(inputHash)) {
    throw new TypeError("Shadow outcome hasher must return a non-empty URL-safe identifier");
  }

  const event: DecisionJournalEvent = {
    schemaVersion: 1,
    eventId: "shadow-outcome:" + inputHash,
    decisionId: plan.decisionId,
    eventType: "outcome_appended",
    occurredAt: recordedAt,
    payload: {
      candidateId: plan.candidateId,
      simulationVersion: plan.simulationVersion,
      inputHash,
      horizonReached: outcome.horizonReached,
      // Timestamp-only maturity proof; post-horizon OHLC remains excluded.
      observedThrough,
      dataQuality,
      candleCount: relevantCandles.length,
      plan: planSnapshot,
      candles: relevantCandles,
      outcome: jsonSnapshot(outcome),
    },
  };
  validateDecisionJournalEvent(event);

  const existingEvents = await journal.listEvents(plan.decisionId);
  const existing = existingEvents.find((item) => item.eventId === event.eventId);
  if (existing) {
    if (
      existing.decisionId === event.decisionId &&
      existing.eventType === event.eventType &&
      JSON.stringify(existing.payload) === JSON.stringify(event.payload)
    ) {
      return { outcome, event: existing, alreadyRecorded: true };
    }
    throw new Error("Content-addressed shadow event ID conflicts with different immutable content");
  }

  try {
    const persisted = await journal.appendEvent(event);
    return { outcome, event: persisted, alreadyRecorded: false };
  } catch (error) {
    // Duplicate content-addressed events are safe to treat as idempotent only
    // when the existing immutable event is byte-for-byte equivalent.
    try {
      const existing = await journal.listEvents(plan.decisionId);
      const match = existing.find((item) => item.eventId === event.eventId);
      if (
        match &&
        match.decisionId === event.decisionId &&
        match.eventType === event.eventType &&
        JSON.stringify(match.payload) === JSON.stringify(event.payload)
      ) {
        return { outcome, event: match, alreadyRecorded: true };
      }
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}
