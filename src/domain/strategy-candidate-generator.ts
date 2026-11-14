import type { DecisionCandidate } from "./decision-engine";
import { validateCandles, type Candle } from "./candles";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { CrossFeedStatus } from "./market-intelligence-service";
import type { DecisionJournalThesis } from "./decision-journal";

export interface ApprovedDonchianStrategy {
  id: string;
  version: string;
  approvedBy: string;
  approvedAt: number;
  lookback: number;
  atrStopMultiple: number;
  rewardRiskMultiple: number;
  riskBudget: number;
  maxNotional: number;
  expiryBars: number;
}

export interface DonchianCandidateGenerationInput {
  snapshot: MarketIntelligenceSnapshot;
  candles: readonly Candle[];
  crossFeedStatus: CrossFeedStatus;
  strategy: ApprovedDonchianStrategy;
  evaluationTime: number;
}

export interface StrategyCandidateGenerationResult {
  status: "candidate" | "no_setup" | "blocked";
  candidate: DecisionCandidate | null;
  thesis: DecisionJournalThesis;
  reasonCodes: string[];
  strategyRef: { id: string; version: string };
}

const INTERVAL_MS = 3_600_000;
const EMPTY_THESIS: DecisionJournalThesis = {
  bullCase: [],
  bearCase: [],
  alternatives: [],
  invalidation: [],
};

function validateStrategy(strategy: ApprovedDonchianStrategy, evaluationTime: number): void {
  if (!strategy || typeof strategy !== "object") throw new TypeError("A reviewed Donchian strategy is required");
  if (![strategy.id, strategy.version].every((value) => typeof value === "string" && value.trim())) {
    throw new TypeError("Strategy ID and version are required");
  }
  if (!strategy.approvedBy?.trim() || !Number.isSafeInteger(strategy.approvedAt) ||
      strategy.approvedAt < 0 || strategy.approvedAt > evaluationTime) {
    throw new TypeError("Strategy approval must be explicit and predate the evaluation");
  }
  if (!Number.isSafeInteger(strategy.lookback) || strategy.lookback < 2 || strategy.lookback > 500) {
    throw new RangeError("Donchian lookback must be between 2 and 500");
  }
  for (const [name, value] of Object.entries({
    atrStopMultiple: strategy.atrStopMultiple,
    rewardRiskMultiple: strategy.rewardRiskMultiple,
    riskBudget: strategy.riskBudget,
    maxNotional: strategy.maxNotional,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + " must be finite and positive");
  }
  if (!Number.isSafeInteger(strategy.expiryBars) || strategy.expiryBars < 1 || strategy.expiryBars > 100) {
    throw new RangeError("expiryBars must be between 1 and 100");
  }
}

function blocked(
  strategy: ApprovedDonchianStrategy,
  reasonCodes: string[],
): StrategyCandidateGenerationResult {
  return {
    status: "blocked",
    candidate: null,
    thesis: structuredClone(EMPTY_THESIS),
    reasonCodes,
    strategyRef: { id: strategy.id, version: strategy.version },
  };
}

/**
 * Causal, deterministic Donchian breakout candidate generator.
 * Uses only completed 1H candles; the current candle is excluded from its
 * prior channel. It proposes a plan but never evaluates the final decision,
 * persists a journal record or submits an order.
 */
export function generateDonchianStrategyCandidate(
  input: DonchianCandidateGenerationInput,
): StrategyCandidateGenerationResult {
  if (!input || typeof input !== "object") throw new TypeError("Candidate generation input is required");
  if (!Number.isSafeInteger(input.evaluationTime) || input.evaluationTime < 0) {
    throw new RangeError("evaluationTime must be a non-negative safe integer");
  }
  const strategy = input.strategy;
  if (!strategy || typeof strategy !== "object") throw new TypeError("A strategy configuration is required");

  // An unapproved strategy is a governance block, not a reason to silently use defaults.
  if (!strategy.approvedBy?.trim()) return blocked(strategy, ["STRATEGY_NOT_APPROVED"]);
  validateStrategy(strategy, input.evaluationTime);

  const snapshot = input.snapshot;
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("A market snapshot is required");
  if (snapshot.evaluationTime !== input.evaluationTime) {
    throw new RangeError("Snapshot and candidate evaluation times must match");
  }
  if (!snapshot.snapshotId?.trim() || !snapshot.contentHash?.trim()) {
    throw new TypeError("Market snapshot identity and content hash are required");
  }
  if (snapshot.dataQuality !== "pass" || input.crossFeedStatus !== "within_tolerance" ||
      snapshot.frames["1h"].status !== "available" || snapshot.frames["4h"].status !== "available") {
    return blocked(strategy, ["MARKET_DATA_NOT_READY"]);
  }
  if (snapshot.frames["1h"].availableAt === null ||
      snapshot.frames["1h"].availableAt > input.evaluationTime ||
      snapshot.frames["4h"].availableAt === null ||
      snapshot.frames["4h"].availableAt > input.evaluationTime) {
    return blocked(strategy, ["MARKET_EVIDENCE_NOT_CAUSAL"]);
  }

  const validated = validateCandles(input.candles);
  if (validated.length < strategy.lookback + 1) {
    return blocked(strategy, ["INSUFFICIENT_CANDLE_HISTORY"]);
  }
  const completed = validated.filter((candle) =>
    candle.timestamp <= Number.MAX_SAFE_INTEGER - INTERVAL_MS &&
    candle.timestamp + INTERVAL_MS <= input.evaluationTime
  );
  if (completed.length !== validated.length) {
    throw new RangeError("Candidate generation accepts completed candles only");
  }
  const latest = completed[completed.length - 1];
  if (snapshot.frames["1h"].latestCandleAt !== latest.timestamp) {
    return blocked(strategy, ["MARKET_CANDLE_SNAPSHOT_MISMATCH"]);
  }
  const prior = completed.slice(-(strategy.lookback + 1), -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const side = latest.close > priorHigh
    ? "long"
    : latest.close < priorLow
      ? "short"
      : null;

  if (!side) {
    return {
      status: "no_setup",
      candidate: null,
      thesis: structuredClone(EMPTY_THESIS),
      reasonCodes: ["DONCHIAN_TRIGGER_ABSENT"],
      strategyRef: { id: strategy.id, version: strategy.version },
    };
  }

  const expectedTrend = side === "long" ? "uptrend" : "downtrend";
  if (snapshot.primaryTrend !== expectedTrend || snapshot.tacticalTrend !== expectedTrend) {
    return {
      status: "no_setup",
      candidate: null,
      thesis: {
        bullCase: side === "long" ? ["Completed 1H close broke the prior Donchian upper channel"] : [],
        bearCase: side === "short" ? ["Completed 1H close broke the prior Donchian lower channel"] : [],
        alternatives: ["Wait for 4H and 1H trend alignment or a new causal setup"],
        invalidation: [],
      },
      reasonCodes: ["HIGHER_TIMEFRAME_CONFLICT"],
      strategyRef: { id: strategy.id, version: strategy.version },
    };
  }

  const atrPct = snapshot.frames["1h"].atrPct;
  if (atrPct === null || !Number.isFinite(atrPct) || atrPct <= 0) {
    return blocked(strategy, ["ATR_UNAVAILABLE"]);
  }
  const entryPrice = latest.close;
  const stopDistance = entryPrice * atrPct / 100 * strategy.atrStopMultiple;
  const stopPrice = side === "long" ? entryPrice - stopDistance : entryPrice + stopDistance;
  const targetPrice = side === "long"
    ? entryPrice + stopDistance * strategy.rewardRiskMultiple
    : entryPrice - stopDistance * strategy.rewardRiskMultiple;
  if (stopPrice <= 0 || targetPrice <= 0 || !Number.isFinite(stopDistance)) {
    return blocked(strategy, ["INVALID_VOLATILITY_DERIVED_PLAN"]);
  }

  const riskSizedQuantity = strategy.riskBudget / stopDistance;
  const notionalCappedQuantity = strategy.maxNotional / entryPrice;
  const quantity = Math.min(riskSizedQuantity, notionalCappedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return blocked(strategy, ["INVALID_POSITION_SIZE"]);
  }

  const candidate: DecisionCandidate = {
    id: [strategy.id, strategy.version, snapshot.symbol, latest.timestamp, side].join(":"),
    symbol: snapshot.symbol,
    side,
    setupFamily: "donchian-breakout",
    timeframe: "1h",
    triggerConfirmed: true,
    expiresAt: input.evaluationTime + INTERVAL_MS * strategy.expiryBars,
    plan: {
      entryPrice,
      stopPrice,
      targetPrices: [targetPrice],
      quantity,
    },
  };
  const thesis: DecisionJournalThesis = {
    bullCase: side === "long"
      ? ["Completed 1H close exceeded the prior " + strategy.lookback + "-bar Donchian high",
        "4H and 1H market trends align with the long candidate"]
      : [],
    bearCase: side === "short"
      ? ["Completed 1H close fell below the prior " + strategy.lookback + "-bar Donchian low",
        "4H and 1H market trends align with the short candidate"]
      : [],
    alternatives: ["Breakout failure or rapid return inside the prior channel",
      "Wait for a retest rather than accepting the close as an immediate fill"],
    invalidation: [side === "long"
      ? "Price reaches the volatility-derived stop at " + stopPrice
      : "Price reaches the volatility-derived stop at " + stopPrice],
  };

  return {
    status: "candidate",
    candidate,
    thesis,
    reasonCodes: ["DONCHIAN_BREAKOUT_CONFIRMED"],
    strategyRef: { id: strategy.id, version: strategy.version },
  };
}
