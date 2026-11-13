import { describe, expect, it } from "vitest";
import {
  createPaperAccount,
  processPaperCandle,
  submitPaperOrder,
} from "./paper-broker-partial-fills";

describe("paper broker partial-fill lifecycle", () => {
  const start = Date.UTC(2026, 0, 1);
  const execution = {
    feeRate: 0.001,
    baseSlippageBps: 2,
    halfSpreadBps: 5,
    maxParticipationRate: 0.1,
    marketImpactBpsAtMaxParticipation: 20,
  };

  it("keeps a submitted order pending until a candle provides liquidity", () => {
    const account = createPaperAccount({
      maxPositionValueFraction: 0.9,
      executionModel: execution,
    }, start);
    const submitted = submitPaperOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.2, referencePrice: 50_000, timestamp: start,
    });

    expect(submitted.fills).toHaveLength(0);
    expect(submitted.openOrders).toHaveLength(1);
    expect(submitted.openOrders[0].remainingQuantity).toBe(0.2);
    expect(submitted.cash).toBe(10_000);
  });

  it("carries a partial buy remainder and updates cash, fees and weighted average entry", () => {
    const account = createPaperAccount({
      maxPositionValueFraction: 0.9,
      executionModel: execution,
    }, start);
    const submitted = submitPaperOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.2, referencePrice: 50_000, timestamp: start,
    });
    const first = processPaperCandle(submitted, {
      symbol: "BTCUSDT", open: 50_000, volume: 1, timestamp: start + 60_000,
    });

    expect(first.fills).toHaveLength(1);
    expect(first.fills[0].quantity).toBeCloseTo(0.1);
    expect(first.openOrders[0].remainingQuantity).toBeCloseTo(0.1);
    expect(first.openOrders[0].status).toBe("partial");
    expect(first.positions.BTCUSDT.quantity).toBeCloseTo(0.1);
    expect(first.totalFees).toBeGreaterThan(0);

    const second = processPaperCandle(first, {
      symbol: "BTCUSDT", open: 51_000, volume: 1, timestamp: start + 120_000,
    });
    expect(second.openOrders).toHaveLength(0);
    expect(second.positions.BTCUSDT.quantity).toBeCloseTo(0.2);
    expect(second.fills).toHaveLength(2);
    expect(second.positions.BTCUSDT.averageEntryPrice).toBeGreaterThan(50_000);
    expect(second.cash).toBeLessThan(first.cash);
  });

  it("partially sells an existing position and realizes PnL only on the filled quantity", () => {
    const account = createPaperAccount({
      maxPositionValueFraction: 0.9,
      executionModel: execution,
    }, start);
    const buyOrder = submitPaperOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.2, referencePrice: 50_000, timestamp: start,
    });
    const bought = processPaperCandle(buyOrder, {
      symbol: "BTCUSDT", open: 50_000, volume: 10, timestamp: start + 60_000,
    });
    const sellOrder = submitPaperOrder(bought, {
      symbol: "BTCUSDT", side: "sell", quantity: 0.2, referencePrice: 52_000, timestamp: start + 60_000,
    });
    const partial = processPaperCandle(sellOrder, {
      symbol: "BTCUSDT", open: 52_000, volume: 1, timestamp: start + 120_000,
    });

    expect(partial.positions.BTCUSDT.quantity).toBeCloseTo(0.1);
    expect(partial.openOrders[0].remainingQuantity).toBeCloseTo(0.1);
    expect(partial.realizedPnl).toBeGreaterThan(0);
    expect(partial.fills.at(-1)?.realizedPnl).toBeGreaterThan(0);
  });

  it("does not fill an order on a zero-volume candle", () => {
    const account = createPaperAccount({
      maxPositionValueFraction: 0.9,
      executionModel: execution,
    }, start);
    const submitted = submitPaperOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.1, referencePrice: 50_000, timestamp: start,
    });
    const result = processPaperCandle(submitted, {
      symbol: "BTCUSDT", open: 50_000, volume: 0, timestamp: start + 60_000,
    });

    expect(result.fills).toHaveLength(0);
    expect(result.openOrders[0].status).toBe("open");
    expect(result.cash).toBe(10_000);
  });

  it("supports explicit cancellation of a residual order without reversing prior fills", () => {
    const account = createPaperAccount({
      maxPositionValueFraction: 0.9,
      executionModel: execution,
    }, start);
    const submitted = submitPaperOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.2, referencePrice: 50_000, timestamp: start,
    });
    const partial = processPaperCandle(submitted, {
      symbol: "BTCUSDT", open: 50_000, volume: 1, timestamp: start + 60_000,
    });
    const cancelled = cancelPaperOrder(partial, partial.openOrders[0].id);

    expect(cancelled.openOrders).toHaveLength(0);
    expect(cancelled.positions.BTCUSDT.quantity).toBeCloseTo(0.1);
    expect(cancelled.fills).toHaveLength(1);
  });
});
