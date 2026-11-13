import { atr, ema } from "./indicators";
import { validateCandles, type Candle } from "./candles";
import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

export type TrendRegime = "uptrend" | "downtrend" | "range" | "unknown";
export type VolatilityRegime = "low" | "normal" | "high" | "unknown";

export interface MarketRegimeConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  atrPeriod: number;
  /** Absolute EMA spread, expressed as percent of slow EMA. */
  trendThresholdPct: number;
  /** ATR/close percentage below which volatility is low. */
  lowVolatilityAtrPct: number;
  /** ATR/close percentage above which volatility is high. */
  highVolatilityAtrPct: number;
}

export interface MarketRegime {
  timestamp: number;
  trend: TrendRegime;
  volatility: VolatilityRegime;
  emaSpreadPct: number | null;
  atrPct: number | null;
}

export interface RegimeScorecard {
  groups: RegimePerformance[];
  classifiedTrades: number;
  unclassifiedTrades: number;
}

export interface RegimePerformance {
  trend: Exclude<TrendRegime, "unknown">;
  volatility: Exclude<VolatilityRegime, "unknown">;
  completedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(label + " must be a positive integer");
  }
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(label + " must be finite and non-negative");
  }
}

/**
 * Causal regime labels. Each candle is classified only from indicator values
 * calculated on that candle and earlier candles; no centered windows or future
 * observations are used. Thresholds are fixed inputs, not fitted on test data.
 */
export function classifyMarketRegimes(
  input: readonly Candle[],
  config: MarketRegimeConfig,
): MarketRegime[] {
  const candles = validateCandles(input);
  positiveInteger(config.fastEmaPeriod, "fastEmaPeriod");
  positiveInteger(config.slowEmaPeriod, "slowEmaPeriod");
  positiveInteger(config.atrPeriod, "atrPeriod");
  if (config.fastEmaPeriod >= config.slowEmaPeriod) {
    throw new RangeError("fastEmaPeriod must be less than slowEmaPeriod");
  }
  finiteNonNegative(config.trendThresholdPct, "trendThresholdPct");
  finiteNonNegative(config.lowVolatilityAtrPct, "lowVolatilityAtrPct");
  finiteNonNegative(config.highVolatilityAtrPct, "highVolatilityAtrPct");
  if (config.lowVolatilityAtrPct >= config.highVolatilityAtrPct) {
    throw new RangeError("lowVolatilityAtrPct must be less than highVolatilityAtrPct");
  }

  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, config.fastEmaPeriod);
  const slow = ema(closes, config.slowEmaPeriod);
  const ranges = atr(
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    closes,
    config.atrPeriod,
  );

  return candles.map((candle, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    const atrValue = ranges[index];
    const emaSpreadPct = fastValue === null || slowValue === null || slowValue === 0
      ? null
      : ((fastValue - slowValue) / slowValue) * 100;
    const atrPct = atrValue === null || candle.close <= 0
      ? null
      : (atrValue / candle.close) * 100;

    let trend: TrendRegime = "unknown";
    if (emaSpreadPct !== null) {
      if (emaSpreadPct > config.trendThresholdPct) trend = "uptrend";
      else if (emaSpreadPct < -config.trendThresholdPct) trend = "downtrend";
      else trend = "range";
    }

    let volatility: VolatilityRegime = "unknown";
    if (atrPct !== null) {
      if (atrPct < config.lowVolatilityAtrPct) volatility = "low";
      else if (atrPct > config.highVolatilityAtrPct) volatility = "high";
      else volatility = "normal";
    }

    return { timestamp: candle.timestamp, trend, volatility, emaSpreadPct, atrPct };
  });
}

/**
 * Attributes each completed trade to the regime known when the exit decision
 * was made: the candle immediately before the next-open exit fill. This avoids
 * using the exit candle close/high/low, which were not known at fill time.
 * Warm-up trades are counted as unclassified; missing timestamps fail closed.
 */
export function buildRegimeScorecard(
  candles: readonly Candle[],
  evaluation: WalkForwardEvaluationResult,
  config: MarketRegimeConfig,
): RegimeScorecard {
  const regimes = classifyMarketRegimes(candles, config);
  const indexByTimestamp = new Map(regimes.map((regime, index) => [regime.timestamp, index]));
  const trendLabels = ["uptrend", "downtrend", "range"] as const;
  const volatilityLabels = ["low", "normal", "high"] as const;
  const buckets = new Map<string, {
    trend: typeof trendLabels[number];
    volatility: typeof volatilityLabels[number];
    pnls: number[];
  }>();

  for (const trend of trendLabels) {
    for (const volatility of volatilityLabels) {
      buckets.set(trend + ":" + volatility, { trend, volatility, pnls: [] });
    }
  }

  let classifiedTrades = 0;
  let unclassifiedTrades = 0;
  for (const fold of evaluation.folds) {
    for (const trade of fold.result.trades) {
      if (!Number.isSafeInteger(trade.entryTimestamp) ||
          !Number.isSafeInteger(trade.exitTimestamp) ||
          trade.exitTimestamp < trade.entryTimestamp ||
          !Number.isFinite(trade.pnl)) {
        throw new RangeError("Trade ledger contains invalid timestamps or PnL");
      }
      const exitIndex = indexByTimestamp.get(trade.exitTimestamp);
      if (exitIndex === undefined) {
        throw new RangeError("Trade exit timestamp is missing from supplied candles");
      }
      const decisionRegime = exitIndex > 0 ? regimes[exitIndex - 1] : undefined;
      if (!decisionRegime || decisionRegime.trend === "unknown" ||
          decisionRegime.volatility === "unknown") {
        unclassifiedTrades += 1;
        continue;
      }
      buckets.get(decisionRegime.trend + ":" + decisionRegime.volatility)!.pnls.push(trade.pnl);
      classifiedTrades += 1;
    }
  }

  const groups = [...buckets.values()].filter((bucket) => bucket.pnls.length > 0).map((bucket) => {
    const completedTrades = bucket.pnls.length;
    const winningTrades = bucket.pnls.filter((pnl) => pnl > 0).length;
    const losingTrades = bucket.pnls.filter((pnl) => pnl < 0).length;
    const grossProfit = bucket.pnls.reduce((sum, pnl) => sum + Math.max(0, pnl), 0);
    const grossLoss = bucket.pnls.reduce((sum, pnl) => sum + Math.max(0, -pnl), 0);
    const netPnl = bucket.pnls.reduce((sum, pnl) => sum + pnl, 0);
    return {
      trend: bucket.trend,
      volatility: bucket.volatility,
      completedTrades,
      winningTrades,
      losingTrades,
      winRatePct: winningTrades / completedTrades * 100,
      netPnl,
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      expectancyPerTrade: netPnl / completedTrades,
    };
  });

  return { groups, classifiedTrades, unclassifiedTrades };
}
