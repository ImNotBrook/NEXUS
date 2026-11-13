import { describe, expect, it } from "vitest";
import { runExecutionAwareBacktest } from "./execution-aware-backtest";
import type { Candle } from "./candles";

const model = {
  feeRate: 0.001,
  baseSlippageBps: 2,
  halfSpreadBps: 5,
  maxParticipationRate: 0.1,
  marketImpactBpsAtMaxParticipation: 20,
};

describe("runExecutionAwareBacktest", () => {
  it("carries partial entry fills across candles and exposes the unfilled remainder", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 3, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : "hold",
      { initialCapital: 1_000, allocationFraction: 0.5, warmupBars: 0, executionModel: model });

    expect(result.openPosition?.quantity).toBeCloseTo(2);
    expect(result.pendingOrder?.side).toBe("buy");
    expect(result.pendingOrder?.remainingQuantity).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
    expect(result.totalFees).toBeGreaterThan(0);
  });

  it("completes a trade only after a partially filled exit order finishes", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 3, open: 110, high: 111, low: 109, close: 110, volume: 10 },
      { timestamp: 4, open: 110, high: 111, low: 109, close: 110, volume: 10 },
      { timestamp: 5, open: 110, high: 111, low: 109, close: 110, volume: 100 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : history.length === 2 ? "sell" : "hold",
      { initialCapital: 1_000, allocationFraction: 0.5, warmupBars: 0, executionModel: model });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].quantity).toBeGreaterThan(0);
    expect(result.trades[0].exitTimestamp).toBe(5);
    expect(result.pendingOrder).toBeNull();
    expect(result.openPosition).toBeNull();
  });

  it("uses candle volume for aggregate fill capacity and charges fees only on executed quantity", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 0 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : "hold",
      { initialCapital: 1_000, allocationFraction: 0.5, warmupBars: 0, executionModel: model });

    expect(result.openPosition).toBeNull();
    expect(result.totalFees).toBe(0);
    expect(result.pendingOrder?.remainingQuantity).toBeGreaterThan(0);
    expect(result.cash).toBe(1_000);
  });

  it("cancels the unfilled remainder when the strategy reverses its pending order", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 3, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : history.length === 2 ? "sell" : "hold",
      { initialCapital: 1_000, allocationFraction: 0.5, warmupBars: 0, executionModel: model });

    expect(result.pendingOrder).toBeNull();
    expect(result.openPosition).toBeNull();
    expect(result.trades).toHaveLength(1);
  });

  it("executes an intrabar stop through the market execution model and records its reason", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 3, open: 100, high: 102, low: 94, close: 96, volume: 100 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : "hold",
      { initialCapital: 1_000, allocationFraction: 1, executionModel: model,
        protectiveOrders: { stopLossPct: 5 } });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("stop-loss");
    expect(result.trades[0].exitPrice).toBeLessThan(95);
    expect(result.openPosition).toBeNull();
    expect(result.pendingOrder).toBeNull();
  });

  it("executes a take-profit as a limit fill without adverse slippage", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 3, open: 100, high: 112, low: 99, close: 111, volume: 100 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : "hold",
      { initialCapital: 1_000, allocationFraction: 1, executionModel: model,
        protectiveOrders: { takeProfitPct: 10 } });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("take-profit");
    expect(result.trades[0].exitPrice).toBe(110);
    expect(result.openPosition).toBeNull();
  });

  it("keeps a partially filled protective exit open until the residual quantity is filled", () => {
    const candles: Candle[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { timestamp: 3, open: 100, high: 102, low: 94, close: 96, volume: 10 },
      { timestamp: 4, open: 90, high: 92, low: 88, close: 90, volume: 100 },
    ];
    const result = runExecutionAwareBacktest(candles,
      history => history.length === 1 ? "buy" : "hold",
      { initialCapital: 1_000, allocationFraction: 1, executionModel: model,
        protectiveOrders: { stopLossPct: 5 } });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("stop-loss");
    expect(result.pendingOrder).toBeNull();
    expect(result.openPosition).toBeNull();
  });

});
