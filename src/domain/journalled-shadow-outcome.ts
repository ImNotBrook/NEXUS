import {
  validateDecisionJournalEvent,
  type DecisionJournalEvent,
  type DecisionJournalRecord,
} from "./decision-journal";
import {
  simulateShadowOutcome,
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

export interface JournalledShadowOutcomeResult {
  outcome: ShadowOutcome;
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
 * Simulates a fixed shadow plan and appends an immutable, content-addressed
 * outcome event. Re-running the same input at the same recordedAt is idempotent.
 */
export async function journalShadowOutcome(
  plan: ShadowTradePlan,
  inputCandles: readonly Candle[],
  recordedAt: number,
  journal: ShadowOutcomeJournal,
  hasher: ShadowOutcomeHasher = sha256,
): Promise<JournalledShadowOutcomeResult> {
  if (!Number.isSafeInteger(recordedAt) || recordedAt < plan.decisionAt) {
    throw new RangeError("A valid recording timestamp at or after the decision time is required");
  }
  assertPlanMatchesDecision(plan, await journal.get(plan.decisionId));

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
  const hashInput = {
    decisionId: plan.decisionId,
    plan: planSnapshot,
    candles: relevantCandles,
    horizonReached: outcome.horizonReached,
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
      observedThrough: relevantCandles.length
        ? relevantCandles[relevantCandles.length - 1].timestamp
        : null,
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
