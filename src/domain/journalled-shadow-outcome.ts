import {
  validateDecisionJournalEvent,
  type DecisionJournalEvent,
} from "./decision-journal";
import {
  simulateShadowOutcome,
  type ShadowOutcome,
  type ShadowTradePlan,
} from "./shadow-outcome-engine";
import type { Candle } from "./candles";

export const MAX_SHADOW_OUTCOME_CANDLES = 5_000;

export interface ShadowOutcomeJournal {
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
    recordedAt,
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
      recordedAt,
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

  try {
    const persisted = await journal.appendEvent(event);
    return { outcome, event: persisted, alreadyRecorded: false };
  } catch (error) {
    // Duplicate content-addressed events are safe to treat as idempotent only
    // when the existing immutable event is byte-for-byte equivalent.
    try {
      const existing = await journal.listEvents(plan.decisionId);
      const match = existing.find((item) => item.eventId === event.eventId);
      if (match && JSON.stringify(match) === JSON.stringify(event)) {
        return { outcome, event: match, alreadyRecorded: true };
      }
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}
