import { validateCandles, type Candle } from "./candles";
import { validateDecisionJournalEvent, validateDecisionJournalRecord, type DecisionJournalEvent, type DecisionJournalRecord } from "./decision-journal";

export const NO_SETUP_REPLAY_VERSION = "donchian-no-setup-v1" as const;
export const NO_SETUP_REPLAY_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Frozen, decision-time inputs for a deliberately narrow Donchian-only
 * diagnostic. This is not a full replay of multi-timeframe market filters.
 */
export interface NoSetupReplaySpec {
  schemaVersion: 1;
  detectorVersion: typeof NO_SETUP_REPLAY_VERSION;
  decisionId: string;
  symbol: "BTCUSDT";
  timeframe: "1h";
  decisionAt: number;
  lookback: number;
  initialWindow: Candle[];
  strategyId: string;
  strategyVersion: string;
  atrStopMultiple: number;
  rewardRiskMultiple: number;
  riskBudget: number;
  maxNotional: number;
  expiryBars: number;
}

export interface NoSetupTrigger {
  timestamp: number;
  entryReferencePrice: number;
  priorChannelHigh: number;
  candleClose: number;
  barsAfterDecision: number;
}

export type NoSetupReplayResult =
  | { status: "trigger_found"; trigger: NoSetupTrigger; evaluationBars: number }
  | { status: "no_trigger"; evaluationBars: number; reason: "NO_BREAKOUT_IN_OBSERVED_WINDOW" | "NO_CLOSED_FUTURE_CANDLES" };

/** Build a frozen detector spec only for the exact absence the detector can explain. */
export function buildNoSetupReplaySpec(input: {
  decisionId: string;
  decisionAt: number;
  symbol: string;
  timeframe: string;
  status: string;
  reasonCodes: readonly string[];
  candles: readonly Candle[];
  strategy: {
    id: string; version: string; lookback: number;
    atrStopMultiple: number; rewardRiskMultiple: number;
    riskBudget: number; maxNotional: number; expiryBars: number;
  };
}): NoSetupReplaySpec | null {
  if (input.status !== "NO_SETUP" || !input.reasonCodes.includes("DONCHIAN_TRIGGER_ABSENT")) return null;
  if (input.symbol !== "BTCUSDT" || input.timeframe !== "1h") return null;
  if (!Number.isSafeInteger(input.decisionAt) || input.decisionAt < 0 ||
      input.decisionAt % NO_SETUP_REPLAY_INTERVAL_MS !== 0) return null;
  const candles = validateCandles(input.candles);
  const strategy = input.strategy;
  if (!Number.isSafeInteger(strategy.lookback) || strategy.lookback < 2 ||
      candles.length < strategy.lookback) return null;
  const initialWindow = candles.slice(-strategy.lookback);
  if (initialWindow.some((candle) =>
    candle.timestamp + NO_SETUP_REPLAY_INTERVAL_MS > input.decisionAt
  )) return null;
  if (![strategy.atrStopMultiple, strategy.rewardRiskMultiple, strategy.riskBudget, strategy.maxNotional]
    .every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isSafeInteger(strategy.expiryBars) || strategy.expiryBars < 1) return null;
  return {
    schemaVersion: 1,
    detectorVersion: NO_SETUP_REPLAY_VERSION,
    decisionId: input.decisionId,
    symbol: "BTCUSDT",
    timeframe: "1h",
    decisionAt: input.decisionAt,
    lookback: strategy.lookback,
    initialWindow,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    atrStopMultiple: strategy.atrStopMultiple,
    rewardRiskMultiple: strategy.rewardRiskMultiple,
    riskBudget: strategy.riskBudget,
    maxNotional: strategy.maxNotional,
    expiryBars: strategy.expiryBars,
  };
}

/**
 * Replays strictly post-decision, closed hourly candles. It returns the first
 * close above the rolling channel and never optimises entry or outcome.
 */
export function findFirstCausalDonchianTrigger(
  spec: NoSetupReplaySpec,
  inputCandles: readonly Candle[],
  asOf = Number.MAX_SAFE_INTEGER,
): NoSetupReplayResult {
  if (!spec || spec.schemaVersion !== 1 || spec.detectorVersion !== NO_SETUP_REPLAY_VERSION) {
    throw new TypeError("Unsupported frozen NO_SETUP replay specification");
  }
  if (!Number.isSafeInteger(asOf) || asOf < spec.decisionAt) {
    throw new RangeError("Replay as-of timestamp must be at or after the original decision");
  }
  if (spec.symbol !== "BTCUSDT" || spec.timeframe !== "1h" ||
      !Number.isSafeInteger(spec.lookback) || spec.lookback < 2 ||
      spec.initialWindow.length !== spec.lookback) {
    throw new TypeError("Frozen replay scope or initial channel window is invalid");
  }
  const initial = validateCandles(spec.initialWindow);
  if (initial.some((candle) => candle.timestamp + NO_SETUP_REPLAY_INTERVAL_MS > spec.decisionAt)) {
    throw new RangeError("Frozen initial channel contains data unavailable at decision time");
  }
  const future = validateCandles(inputCandles);
  const closed = future.filter((candle) =>
    candle.timestamp > spec.decisionAt &&
    candle.timestamp + NO_SETUP_REPLAY_INTERVAL_MS <= asOf
  );
  if (closed.length !== future.filter((candle) => candle.timestamp > spec.decisionAt).length) {
    // Future/incomplete candles are not silently included; they are simply beyond the as-of boundary.
  }
  let window = initial.map((candle) => ({ ...candle }));
  let evaluated = 0;
  let expectedTimestamp = spec.decisionAt + NO_SETUP_REPLAY_INTERVAL_MS;
  for (const candle of closed) {
    if (candle.timestamp !== expectedTimestamp) {
      throw new RangeError("Replay history must be continuous hourly candles after the decision");
    }
    const priorChannelHigh = Math.max(...window.map((item) => item.high));
    evaluated += 1;
    if (candle.close > priorChannelHigh) {
      return {
        status: "trigger_found",
        trigger: {
          timestamp: candle.timestamp,
          entryReferencePrice: candle.close,
          priorChannelHigh,
          candleClose: candle.close,
          barsAfterDecision: evaluated,
        },
        evaluationBars: evaluated,
      };
    }
    window = [...window.slice(1), candle];
    expectedTimestamp += NO_SETUP_REPLAY_INTERVAL_MS;
  }
  return {
    status: "no_trigger",
    evaluationBars: evaluated,
    reason: evaluated ? "NO_BREAKOUT_IN_OBSERVED_WINDOW" : "NO_CLOSED_FUTURE_CANDLES",
  };
}


export interface NoSetupReplayJournal {
  get(decisionId: string): Promise<DecisionJournalRecord | null>;
  appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent>;
  listEvents(decisionId: string): Promise<DecisionJournalEvent[]>;
}

/** Persist the exact detector inputs at the original NO_SETUP timestamp. */
export async function registerNoSetupReplay(
  spec: NoSetupReplaySpec,
  journal: NoSetupReplayJournal,
): Promise<{ event: DecisionJournalEvent; alreadyRecorded: boolean }> {
  const decision = await journal.get(spec.decisionId);
  if (!decision) throw new Error("NO_SETUP replay parent decision is missing");
  validateDecisionJournalRecord(decision);
  if (decision.status !== "NO_SETUP" || decision.decisionAt !== spec.decisionAt ||
      decision.symbol !== spec.symbol || decision.timeframe !== spec.timeframe ||
      !decision.reasonCodes.includes("DONCHIAN_TRIGGER_ABSENT")) {
    throw new Error("Frozen replay specification does not match an eligible NO_SETUP decision");
  }
  if (spec.detectorVersion !== NO_SETUP_REPLAY_VERSION ||
      spec.initialWindow.length !== spec.lookback) {
    throw new TypeError("Frozen NO_SETUP replay specification is invalid");
  }
  const event: DecisionJournalEvent = {
    schemaVersion: 1,
    eventId: "no-setup-replay:" + spec.decisionId + ":" + spec.detectorVersion,
    decisionId: spec.decisionId,
    eventType: "no_setup_replay_registered",
    occurredAt: spec.decisionAt,
    payload: { spec: structuredClone(spec) as unknown as Record<string, unknown> },
  };
  validateDecisionJournalEvent(event);
  const existing = (await journal.listEvents(spec.decisionId))
    .find((item) => item.eventType === event.eventType);
  if (existing) {
    if (existing.occurredAt === event.occurredAt &&
        JSON.stringify(existing.payload) === JSON.stringify(event.payload)) {
      return { event: existing, alreadyRecorded: true };
    }
    throw new Error("A different NO_SETUP replay specification is already registered for this decision");
  }
  return { event: await journal.appendEvent(event), alreadyRecorded: false };
}
