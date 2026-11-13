import type { Candle } from "../domain/candles";
import type { StrategyEvaluator } from "../domain/backtest";

function positivePeriod(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(label + " must be a positive safe integer");
  }
}

function trailingSma(history: readonly Candle[], period: number, offset: number): number | null {
  const end = history.length - 1 - offset;
  const start = end - period + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let index = start; index <= end; index += 1) sum += history[index].close;
  return sum / period;
}

export interface SmaCrossoverConfig {
  fastPeriod: number;
  slowPeriod: number;
}

/** Close-based crossover; the backtester controls next-open execution. */
export function createSmaCrossover(config: SmaCrossoverConfig): StrategyEvaluator {
  positivePeriod(config.fastPeriod, "fastPeriod");
  positivePeriod(config.slowPeriod, "slowPeriod");
  if (config.fastPeriod >= config.slowPeriod) {
    throw new RangeError("fastPeriod must be less than slowPeriod");
  }

  return (history) => {
    if (history.length < config.slowPeriod + 1) return "hold";
    const previousFast = trailingSma(history, config.fastPeriod, 1);
    const currentFast = trailingSma(history, config.fastPeriod, 0);
    const previousSlow = trailingSma(history, config.slowPeriod, 1);
    const currentSlow = trailingSma(history, config.slowPeriod, 0);
    if (previousFast === null || currentFast === null ||
        previousSlow === null || currentSlow === null) return "hold";
    if (previousFast <= previousSlow && currentFast > currentSlow) return "buy";
    if (previousFast >= previousSlow && currentFast < currentSlow) return "sell";
    return "hold";
  };
}

export interface RsiMeanReversionConfig {
  period: number;
  oversold: number;
  overbought: number;
}

/**
 * Incremental Wilder RSI evaluator. It consumes only newly appended candles
 * and assumes history is a stable, chronological prefix on each invocation.
 */
export function createRsiMeanReversion(config: RsiMeanReversionConfig): StrategyEvaluator {
  positivePeriod(config.period, "period");
  if (!Number.isFinite(config.oversold) || !Number.isFinite(config.overbought) ||
      config.oversold < 0 || config.overbought > 100 || config.oversold >= config.overbought) {
    throw new RangeError("RSI thresholds must satisfy 0 <= oversold < overbought <= 100");
  }

  let processed = 0;
  let previousClose = 0;
  let gainSum = 0;
  let lossSum = 0;
  let averageGain: number | null = null;
  let averageLoss: number | null = null;
  let previousRsi: number | null = null;
  let currentRsi: number | null = null;

  const reset = (): void => {
    processed = 0;
    previousClose = 0;
    gainSum = 0;
    lossSum = 0;
    averageGain = null;
    averageLoss = null;
    previousRsi = null;
    currentRsi = null;
  };

  const calculateRsi = (): number => {
    if (averageGain === 0 && averageLoss === 0) return 50;
    if (averageLoss === 0) return 100;
    if (averageGain === 0) return 0;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
  };

  return (history) => {
    if (history.length < processed) reset();

    while (processed < history.length) {
      const close = history[processed].close;
      if (!Number.isFinite(close)) throw new TypeError("RSI strategy requires finite closes");
      if (processed === 0) {
        previousClose = close;
        processed += 1;
        continue;
      }

      const change = close - previousClose;
      previousClose = close;
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);

      if (processed <= config.period) {
        gainSum += gain;
        lossSum += loss;
        if (processed === config.period) {
          averageGain = gainSum / config.period;
          averageLoss = lossSum / config.period;
          currentRsi = calculateRsi();
        }
      } else {
        previousRsi = currentRsi;
        averageGain = (averageGain! * (config.period - 1) + gain) / config.period;
        averageLoss = (averageLoss! * (config.period - 1) + loss) / config.period;
        currentRsi = calculateRsi();
      }
      processed += 1;
    }

    if (previousRsi === null || currentRsi === null) return "hold";
    if (previousRsi <= config.oversold && currentRsi > config.oversold) return "buy";
    if (previousRsi >= config.overbought && currentRsi < config.overbought) return "sell";
    return "hold";
  };
}

export interface DonchianBreakoutConfig {
  period: number;
}

/** Uses the prior period's highs/lows; the current candle is excluded. */
export function createDonchianBreakout(config: DonchianBreakoutConfig): StrategyEvaluator {
  positivePeriod(config.period, "period");
  return (history) => {
    if (history.length < config.period + 1) return "hold";
    const current = history[history.length - 1];
    let upper = Number.NEGATIVE_INFINITY;
    let lower = Number.POSITIVE_INFINITY;
    const first = history.length - config.period - 1;
    for (let index = first; index < history.length - 1; index += 1) {
      upper = Math.max(upper, history[index].high);
      lower = Math.min(lower, history[index].low);
    }
    if (current.close > upper) return "buy";
    if (current.close < lower) return "sell";
    return "hold";
  };
}
