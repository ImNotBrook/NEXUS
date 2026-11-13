import { describe, expect, it } from "vitest";
import { evaluateWalkForward } from "./walk-forward-evaluation";
import type { Candle } from "./candles";

const candles: Candle[] = Array.from({ length: 16 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10,
}));

describe("evaluateWalkForward", () => {
  it("fits only on each training fold and reports independent test results", () => {
    const trainingEnds: number[] = [];
    const result = evaluateWalkForward(candles, {
      folds: { trainBars: 6, testBars: 4, stepBars: 4, embargoBars: 0 },
      backtest: { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 },
      fit: (training) => {
        trainingEnds.push(training.at(-1)!.timestamp);
        return () => "hold";
      },
    });
    expect(result.folds).toHaveLength(2);
    expect(trainingEnds).toEqual([5 * 60_000, 9 * 60_000]);
    expect(result.folds[0].testStartTimestamp).toBe(6 * 60_000);
    expect(result.folds[1].testStartTimestamp).toBe(10 * 60_000);
    expect(result.totalCompletedTrades).toBe(0);
    expect(result.compoundedReturnPct).toBeCloseTo(0);
  });

  it("provides training and embargo history as non-trading warm-up context", () => {
    const result = evaluateWalkForward(candles, {
      folds: { trainBars: 6, testBars: 4, stepBars: 4, embargoBars: 2 },
      backtest: { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 },
      fit: (training) => (history) =>
        history.length === training.length + 3 ? "buy"
          : history.length === training.length + 4 ? "sell" : "hold",
    });
    expect(result.folds).toHaveLength(2);
    expect(result.folds.every((fold) => fold.result.equityCurve.length === 4)).toBe(true);
    expect(result.folds.every((fold) => fold.result.completedTrades === 1)).toBe(true);
    expect(result.totalCompletedTrades).toBe(2);
  });

  it("aggregates returns, worst drawdown, fees and trade counts across folds", () => {
    const result = evaluateWalkForward(candles, {
      folds: { trainBars: 6, testBars: 4, stepBars: 4 },
      backtest: { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 },
      fit: (training) => (history) => history.length === training.length + 1 ? "buy"
        : history.length === training.length + 2 ? "sell" : "hold",
    });
    expect(result.folds).toHaveLength(2);
    expect(result.totalCompletedTrades).toBe(2);
    expect(result.totalFees).toBe(0);
    expect(result.meanFoldReturnPct).toBeGreaterThan(0);
    expect(result.worstFoldDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid strategy factory output", () => {
    expect(() => evaluateWalkForward(candles, {
      folds: { trainBars: 6, testBars: 4 },
      backtest: { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 },
      fit: () => 42 as never,
    })).toThrow();
  });
});
