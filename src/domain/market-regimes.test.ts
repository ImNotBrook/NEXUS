import { describe, expect, it } from "vitest";
import { classifyMarketRegimes, buildRegimeScorecard } from "./market-regimes";
import type { Candle } from "./candles";
import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

function candlesFromCloses(closes: number[], interval = 60_000): Candle[] {
  return closes.map((close, index) => ({
    timestamp: index * interval,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  }));
}

function evaluationWithTrades(trades: Array<{ exitTimestamp: number; pnl: number }>): WalkForwardEvaluationResult {
  const ledger = trades.map((trade) => ({
    entryTimestamp: Math.max(0, trade.exitTimestamp - 60_000),
    exitTimestamp: trade.exitTimestamp,
    entryPrice: 100,
    exitPrice: 100,
    quantity: 1,
    entryFee: 0,
    exitFee: 0,
    pnl: trade.pnl,
    pnlPct: trade.pnl,
  }));
  const fold = {
    index: 0,
    trainStartTimestamp: 0,
    trainEndTimestamp: 60_000,
    testStartTimestamp: 120_000,
    testEndTimestamp: 600_000,
    result: {
      startingCapital: 1000,
      endingEquity: 1000,
      cash: 1000,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      completedTrades: ledger.length,
      winRatePct: 0,
      totalFees: 0,
      trades: ledger,
      equityCurve: [],
      openPosition: null,
    },
  };
  return {
    folds: [fold],
    foldCount: 1,
    totalCompletedTrades: ledger.length,
    totalFees: 0,
    meanFoldReturnPct: 0,
    compoundedReturnPct: 0,
    worstFoldDrawdownPct: 0,
    aggregateWinRatePct: 0,
  };
}

describe("classifyMarketRegimes", () => {
  it("uses trailing-only EMA and ATR values and leaves warmup unknown", () => {
    const candles = candlesFromCloses([100, 101, 102, 103, 104, 105, 106, 107]);
    const regimes = classifyMarketRegimes(candles, {
      fastEmaPeriod: 2,
      slowEmaPeriod: 3,
      atrPeriod: 2,
      trendThresholdPct: 0.1,
      lowVolatilityAtrPct: 0.5,
      highVolatilityAtrPct: 3,
    });
    expect(regimes.slice(0, 2).every((item) => item.trend === "unknown")).toBe(true);
    expect(regimes.at(-1)?.trend).toBe("uptrend");
    expect(regimes.at(-1)?.volatility).toBe("normal");
    expect(regimes.at(-1)?.atrPct).toBeGreaterThan(0);
    const prefix = classifyMarketRegimes(candles.slice(0, 6), {
      fastEmaPeriod: 2, slowEmaPeriod: 3, atrPeriod: 2,
      trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3,
    });
    expect(regimes.slice(0, 6)).toEqual(prefix);
  });

  it("labels flat prices as range and validates threshold ordering", () => {
    const candles = candlesFromCloses(Array(12).fill(100));
    const regimes = classifyMarketRegimes(candles, {
      fastEmaPeriod: 2,
      slowEmaPeriod: 3,
      atrPeriod: 2,
      trendThresholdPct: 0.2,
      lowVolatilityAtrPct: 1,
      highVolatilityAtrPct: 3,
    });
    expect(regimes.at(-1)?.trend).toBe("range");
    expect(() => classifyMarketRegimes(candles, {
      fastEmaPeriod: 2,
      slowEmaPeriod: 3,
      atrPeriod: 2,
      trendThresholdPct: 0.2,
      lowVolatilityAtrPct: 3,
      highVolatilityAtrPct: 1,
    })).toThrow();
  });
});

describe("buildRegimeScorecard", () => {
  it("attributes completed trades to the pre-exit decision regime and reports net expectancy", () => {
    const candles = candlesFromCloses([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
    const config = {
      fastEmaPeriod: 2,
      slowEmaPeriod: 3,
      atrPeriod: 2,
      trendThresholdPct: 0.1,
      lowVolatilityAtrPct: 0.1,
      highVolatilityAtrPct: 10,
    };
    const evaluation = evaluationWithTrades([
      { exitTimestamp: 9 * 60_000, pnl: 10 },
      { exitTimestamp: 10 * 60_000, pnl: -5 },
    ]);
    const report = buildRegimeScorecard(candles, evaluation, config);
    const uptrend = report.groups.find((item) => item.trend === "uptrend" && item.volatility === "normal");
    expect(report.classifiedTrades).toBe(2);
    expect(report.unclassifiedTrades).toBe(0);
    expect(uptrend).toMatchObject({
      completedTrades: 2,
      winningTrades: 1,
      losingTrades: 1,
      netPnl: 5,
      expectancyPerTrade: 2.5,
      winRatePct: 50,
    });
  });

  it("counts trades without a prior classified decision candle as unclassified", () => {
    const candles = candlesFromCloses([100, 101, 102, 103, 104, 105]);
    const report = buildRegimeScorecard(candles, evaluationWithTrades([
      { exitTimestamp: 0, pnl: 2 },
    ]), {
      fastEmaPeriod: 2, slowEmaPeriod: 3, atrPeriod: 2,
      trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.1, highVolatilityAtrPct: 10,
    });
    expect(report.classifiedTrades).toBe(0);
    expect(report.unclassifiedTrades).toBe(1);
    expect(report.groups).toHaveLength(0);
  });

  it("rejects trades whose exit timestamp is absent from supplied market data", () => {
    const candles = candlesFromCloses([100, 101, 102, 103, 104, 105, 106, 107]);
    expect(() => buildRegimeScorecard(candles, evaluationWithTrades([
      { exitTimestamp: 999_999, pnl: 1 },
    ]), {
      fastEmaPeriod: 2,
      slowEmaPeriod: 3,
      atrPeriod: 2,
      trendThresholdPct: 0.1,
      lowVolatilityAtrPct: 0.1,
      highVolatilityAtrPct: 10,
    })).toThrow();
  });
});
