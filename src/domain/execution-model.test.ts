import { describe, expect, it } from "vitest";
import { resolveMarketFill, type MarketExecutionConfig } from "./execution-model";

const config: MarketExecutionConfig = {
  feeRate: 0.001,
  baseSlippageBps: 2,
  halfSpreadBps: 5,
  maxParticipationRate: 0.1,
  marketImpactBpsAtMaxParticipation: 20,
};

describe("resolveMarketFill", () => {
  it("applies spread, base slippage and participation-scaled impact to buys", () => {
    const result = resolveMarketFill({
      side: "buy", requestedQuantity: 50, referencePrice: 100, candleVolume: 1_000,
    }, config);

    expect(result.status).toBe("filled");
    expect(result.filledQuantity).toBe(50);
    expect(result.remainingQuantity).toBe(0);
    expect(result.impactBps).toBeCloseTo(10);
    expect(result.totalAdverseBps).toBeCloseTo(17);
    expect(result.executionPrice).toBeCloseTo(100.17);
    expect(result.fee).toBeCloseTo(result.notional * config.feeRate);
  });

  it("applies adverse execution costs below the reference price for sells", () => {
    const result = resolveMarketFill({
      side: "sell", requestedQuantity: 50, referencePrice: 100, candleVolume: 1_000,
    }, config);

    expect(result.status).toBe("filled");
    expect(result.executionPrice).toBeCloseTo(99.83);
    expect(result.fee).toBeGreaterThan(0);
  });

  it("caps fill quantity at the configured fraction of candle volume", () => {
    const result = resolveMarketFill({
      side: "buy", requestedQuantity: 30, referencePrice: 100, candleVolume: 100,
    }, config);

    expect(result.status).toBe("partial");
    expect(result.filledQuantity).toBeCloseTo(10);
    expect(result.remainingQuantity).toBeCloseTo(20);
    expect(result.notional).toBeCloseTo(result.filledQuantity * result.executionPrice);
  });

  it("returns an unfilled order and charges no fee when volume is zero", () => {
    const result = resolveMarketFill({
      side: "buy", requestedQuantity: 10, referencePrice: 100, candleVolume: 0,
    }, config);

    expect(result.status).toBe("unfilled");
    expect(result.filledQuantity).toBe(0);
    expect(result.remainingQuantity).toBe(10);
    expect(result.fee).toBe(0);
    expect(result.notional).toBe(0);
  });

  it("charges fees only on the filled portion of a partial order", () => {
    const result = resolveMarketFill({
      side: "sell", requestedQuantity: 30, referencePrice: 100, candleVolume: 100,
    }, config);

    expect(result.status).toBe("partial");
    expect(result.fee).toBeCloseTo(result.filledQuantity * result.executionPrice * config.feeRate);
    expect(result.fee).toBeLessThan(30 * result.executionPrice * config.feeRate);
  });

  it("increases market impact linearly with participation up to the configured cap", () => {
    const low = resolveMarketFill({
      side: "buy", requestedQuantity: 25, referencePrice: 100, candleVolume: 1_000,
    }, config);
    const high = resolveMarketFill({
      side: "buy", requestedQuantity: 50, referencePrice: 100, candleVolume: 1_000,
    }, config);

    expect(low.impactBps).toBeCloseTo(5);
    expect(high.impactBps).toBeCloseTo(10);
  });

  it("rejects invalid order quantities, prices, volume and execution settings", () => {
    expect(() => resolveMarketFill({
      side: "buy", requestedQuantity: 0, referencePrice: 100, candleVolume: 10,
    }, config)).toThrow(/requestedQuantity/i);
    expect(() => resolveMarketFill({
      side: "buy", requestedQuantity: 1, referencePrice: 0, candleVolume: 10,
    }, config)).toThrow(/referencePrice/i);
    expect(() => resolveMarketFill({
      side: "buy", requestedQuantity: 1, referencePrice: 100, candleVolume: -1,
    }, config)).toThrow(/candleVolume/i);
    expect(() => resolveMarketFill({
      side: "buy", requestedQuantity: 1, referencePrice: 100, candleVolume: 10,
    }, { ...config, maxParticipationRate: 0 })).toThrow(/maxParticipationRate/i);
  });

  it("rejects configurations that could produce a non-positive sell fill price", () => {
    expect(() => resolveMarketFill({
      side: "sell", requestedQuantity: 1, referencePrice: 100, candleVolume: 10,
    }, { ...config, baseSlippageBps: 9_999, halfSpreadBps: 1 }))
      .toThrow(/total adverse execution cost/i);
  });
});
