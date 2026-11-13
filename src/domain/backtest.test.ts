import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestSignal } from "./backtest";
import type { Candle } from "./candles";

const candles: Candle[] = [
  { timestamp: 1, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { timestamp: 2, open: 110, high: 121, low: 109, close: 120, volume: 10 },
  { timestamp: 3, open: 120, high: 131, low: 119, close: 130, volume: 10 },
  { timestamp: 4, open: 130, high: 131, low: 119, close: 120, volume: 10 },
];

describe("runBacktest", () => {
  it("executes a close signal at the next candle open, never the same close", () => {
    const seen: number[] = [];
    const result = runBacktest(candles, (history) => {
      seen.push(history.length);
      return history.length === 1 ? "buy" : "hold";
    }, { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 });
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(result.openPosition?.entryPrice).toBe(110);
    expect(result.openPosition?.entryTimestamp).toBe(2);
    expect(result.completedTrades).toBe(0);
  });

  it("uses warm-up history without allowing pre-test signals or equity into the test result", () => {
    const series: Candle[] = [
      ...candles,
      { timestamp: 5, open: 120, high: 131, low: 119, close: 125, volume: 10 },
    ];
    const result = runBacktest(series, (history) =>
      history.length === 3 ? "buy" : history.length === 4 ? "sell" : "hold",
    { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5, warmupBars: 2 });
    expect(result.equityCurve.map((point) => point.timestamp)).toEqual([3, 4, 5]);
    expect(result.completedTrades).toBe(1);
    expect(result.trades[0].entryTimestamp).toBe(4);
    expect(result.trades[0].exitTimestamp).toBe(5);
  });

  it("rejects warm-up bars that consume an empty or complete dataset", () => {
    expect(() => runBacktest([], () => "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1, warmupBars: 1,
    })).toThrow(/warmupBars/i);
    expect(() => runBacktest(candles, () => "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1, warmupBars: candles.length,
    })).toThrow(/warmupBars/i);
  });

  it("applies fees and adverse slippage to both entry and exit", () => {
    const result = runBacktest(candles.slice(0, 3), (history) =>
      history.length === 1 ? "buy" : history.length === 2 ? "sell" : "hold",
    { initialCapital: 1000, feeRate: 0.001, slippageBps: 10, allocationFraction: 0.5 });
    expect(result.completedTrades).toBe(1);
    expect(result.trades[0].entryPrice).toBeCloseTo(110.11);
    expect(result.trades[0].exitPrice).toBeCloseTo(119.88);
    expect(result.trades[0].entryFee).toBeGreaterThan(0);
    expect(result.trades[0].exitFee).toBeGreaterThan(0);
    expect(result.trades[0].pnl).toBeGreaterThan(0);
  });

  it("does not execute a signal generated on the final candle", () => {
    const result = runBacktest(candles.slice(0, 1), () => "buy", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1,
    });
    expect(result.completedTrades).toBe(0);
    expect(result.openPosition).toBeNull();
    expect(result.endingEquity).toBe(1000);
  });

  it("rejects invalid costs, sizing and non-positive spot prices", () => {
    expect(() => runBacktest(candles, () => "hold", { initialCapital: 0, feeRate: 0, slippageBps: 0, allocationFraction: 1 })).toThrow();
    expect(() => runBacktest(candles, () => "hold", { initialCapital: 1000, feeRate: 0, slippageBps: 10000, allocationFraction: 1 })).toThrow();
    expect(() => runBacktest([{ ...candles[0], close: 0 }], () => "hold", { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1 })).toThrow();
  });

  it("reports drawdown and keeps the open position marked to market", () => {
    const result = runBacktest(candles, (history): BacktestSignal =>
      history.length === 1 ? "buy" : "hold",
    { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 0.5 });
    expect(result.equityCurve).toHaveLength(candles.length);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result.endingEquity).toBeCloseTo(result.cash + (result.openPosition?.quantity ?? 0) * 120);
  });

  it("gives the strategy an immutable prefix ending at the current close, never future bars", () => {
    const observed: Array<{ lastTimestamp: number; historyLength: number; frozen: boolean }> = [];
    const result = runBacktest(candles, (history) => {
      observed.push({
        lastTimestamp: history[history.length - 1].timestamp,
        historyLength: history.length,
        frozen: Object.isFrozen(history) && history.every((candle) => Object.isFrozen(candle)),
      });
      return "hold";
    }, { initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1 });

    expect(observed).toEqual(candles.map((candle, index) => ({
      lastTimestamp: candle.timestamp,
      historyLength: index + 1,
      frozen: true,
    })));
    expect(result.completedTrades).toBe(0);
  });


  it("activates protective orders only after the entry candle", () => {
    const series: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 2, open: 100, high: 120, low: 80, close: 100, volume: 1 },
    ];
    const result = runBacktest(series, (history) => history.length === 1 ? "buy" : "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1,
      protectiveOrders: { stopLossPct: 5, takeProfitPct: 10 },
    });
    expect(result.openPosition?.entryTimestamp).toBe(2);
    expect(result.completedTrades).toBe(0);
  });

  it("executes an intrabar stop at its level with adverse slippage and fees", () => {
    const series: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 3, open: 100, high: 102, low: 94, close: 96, volume: 1 },
    ];
    const result = runBacktest(series, (history) => history.length === 1 ? "buy" : "hold", {
      initialCapital: 1000, feeRate: 0.001, slippageBps: 10, allocationFraction: 1,
      protectiveOrders: { stopLossPct: 5 },
    });
    expect(result.trades[0].exitReason).toBe("stop-loss");
    expect(result.trades[0].exitPrice).toBeCloseTo(94.999905);
    expect(result.trades[0].exitFee).toBeGreaterThan(0);
  });

  it("fills a stop gap at the opening price before adverse slippage", () => {
    const series: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 3, open: 90, high: 92, low: 88, close: 91, volume: 1 },
    ];
    const result = runBacktest(series, (history) => history.length === 1 ? "buy" : "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 10, allocationFraction: 1,
      protectiveOrders: { stopLossPct: 5 },
    });
    expect(result.trades[0].exitPrice).toBeCloseTo(89.91);
  });

  it("chooses the stop when stop and target are both touched intrabar", () => {
    const series: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 3, open: 100, high: 112, low: 94, close: 105, volume: 1 },
    ];
    const result = runBacktest(series, (history) => history.length === 1 ? "buy" : "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1,
      protectiveOrders: { stopLossPct: 5, takeProfitPct: 10 },
    });
    expect(result.trades[0].exitReason).toBe("stop-loss");
    expect(result.trades[0].exitPrice).toBe(95);
  });

  it("fills a take-profit gap at the opening price without adverse market slippage", () => {
    const series: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: 3, open: 115, high: 117, low: 111, close: 114, volume: 1 },
    ];
    const result = runBacktest(series, (history) => history.length === 1 ? "buy" : "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 50, allocationFraction: 1,
      protectiveOrders: { takeProfitPct: 10 },
    });
    expect(result.trades[0].exitReason).toBe("take-profit");
    expect(result.trades[0].exitPrice).toBe(115);
  });


  it("rejects invalid protective settings even when no position is opened", () => {
    expect(() => runBacktest(candles, () => "hold", {
      initialCapital: 1000, feeRate: 0, slippageBps: 0, allocationFraction: 1,
      protectiveOrders: { stopLossPct: 0 },
    })).toThrow(/stopLossPct/i);
  });

});
