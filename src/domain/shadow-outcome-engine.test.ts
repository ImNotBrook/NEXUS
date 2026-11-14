import { describe, expect, it } from "vitest";
import { simulateShadowOutcome, type ShadowTradePlan } from "./shadow-outcome-engine";
import type { Candle } from "./candles";

const executionModel = {
  feeRate: 0.001,
  baseSlippageBps: 2,
  halfSpreadBps: 3,
  maxParticipationRate: 0.1,
  marketImpactBpsAtMaxParticipation: 10,
};
const plan = (overrides: Partial<ShadowTradePlan> = {}): ShadowTradePlan => ({
  schemaVersion: 1,
  simulationVersion: "shadow-v1",
  decisionId: "decision-1",
  candidateId: "candidate-1",
  symbol: "BTCUSDT",
  side: "long",
  decisionAt: 1_000,
  entry: {
    orderType: "market",
    referencePrice: 100,
    earliestEligibleAt: 2_000,
    expiresAt: 5_000,
    penetrationBps: 5,
  },
  stopPrice: 95,
  targetPrice: 110,
  quantity: 1,
  horizonEnd: 10_000,
  sameBarPolicy: "adverse_stop_first",
  executionModel,
  ...overrides,
});
const candle = (timestamp: number, open: number, high: number, low: number, close: number, volume = 1_000): Candle =>
  ({ timestamp, open, high, low, close, volume });

describe("simulateShadowOutcome", () => {
  it("uses the first eligible candle open for market entry and applies adverse costs", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(1_000, 100, 101, 99, 100),
      candle(2_000, 102, 103, 101, 102),
    ]);
    expect(result.entryFilledQuantity).toBe(1);
    expect(result.entryTimestamp).toBe(2_000);
    expect(result.entryAveragePrice).toBeGreaterThan(102);
    expect(result.entryFees).toBeGreaterThan(0);
    expect(result.status).toBe("open");
  });

  it("does not fill a limit order on a mere touch without the configured penetration", () => {
    const result = simulateShadowOutcome(plan({
      entry: { orderType: "limit", referencePrice: 100, limitPrice: 100,
        earliestEligibleAt: 2_000, expiresAt: 3_000, penetrationBps: 10 },
    }), [
      candle(2_000, 100.5, 101, 99.95, 100.2),
      candle(3_000, 100.2, 101, 100, 100.5),
    ]);
    expect(result.entryFilledQuantity).toBe(0);
    expect(result.status).toBe("expired");
  });

  it("fills a penetrated limit at its limit or better, without adverse market slippage", () => {
    const result = simulateShadowOutcome(plan({
      entry: { orderType: "limit", referencePrice: 100, limitPrice: 100,
        earliestEligibleAt: 2_000, expiresAt: 3_000, penetrationBps: 10 },
    }), [candle(2_000, 100.5, 101, 99.8, 100.2)]);
    expect(result.entryFilledQuantity).toBe(1);
    expect(result.entryAveragePrice).toBe(100);
    expect(result.entryFees).toBeCloseTo(0.1);
  });

  it("resolves a same-bar stop and target collision using adverse stop-first ordering", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 112, 94, 101),
    ]);
    expect(result.status).toBe("completed");
    expect(result.exitReason).toBe("stop-loss");
    expect(result.exitAveragePrice).toBeLessThan(95);
  });

  it("marks same-bar stop and target collisions ambiguous when configured", () => {
    const result = simulateShadowOutcome(plan({ sameBarPolicy: "ambiguous" }), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 112, 94, 101),
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.exitFilledQuantity).toBe(0);
  });

  it("fills a target as a limit order only after penetration and includes fees in net PnL", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 112, 99, 111),
    ]);
    expect(result.status).toBe("completed");
    expect(result.exitReason).toBe("take-profit");
    expect(result.exitAveragePrice).toBe(110);
    expect(result.exitFees).toBeGreaterThan(0);
    expect(result.netPnl).toBeLessThan(10);
    expect(result.netPnl).toBeGreaterThan(0);
  });

  it("handles short stop gaps at the worse opening price", () => {
    const result = simulateShadowOutcome(plan({
      side: "short", stopPrice: 105, targetPrice: 90,
    }), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 110, 112, 108, 109),
    ]);
    expect(result.status).toBe("completed");
    expect(result.exitReason).toBe("stop-loss");
    expect(result.exitAveragePrice).toBeGreaterThan(110);
    expect(result.netPnl).toBeLessThan(0);
  });

  it("carries partial market entry fills across eligible candles", () => {
    const result = simulateShadowOutcome(plan({
      executionModel: { ...executionModel, maxParticipationRate: 0.1 },
    }), [
      candle(2_000, 100, 101, 99, 100, 5),
      candle(3_000, 101, 102, 100, 101, 5),
    ]);
    expect(result.entryFilledQuantity).toBeCloseTo(1);
    expect(result.entryTimestamp).toBe(2_000);
    expect(result.status).toBe("open");
  });

  it("expires an unfilled candidate and ignores candles beyond its outcome horizon", () => {
    const expired = simulateShadowOutcome(plan({
      entry: { orderType: "limit", referencePrice: 100, limitPrice: 100,
        earliestEligibleAt: 2_000, expiresAt: 3_000, penetrationBps: 10 },
    }), [candle(2_000, 100, 101, 99.95, 100), candle(4_000, 100, 101, 99, 100)]);
    expect(expired.status).toBe("expired");

    const open = simulateShadowOutcome(plan({
      horizonEnd: 3_000,
      entry: { ...plan().entry, expiresAt: 3_000 },
    }), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 105, 98, 102),
      candle(4_000, 100, 112, 94, 101),
    ]);
    expect(open.status).toBe("open");
    expect(open.exitReason).toBeNull();
  });

  it("rejects invalid plans and malformed or unordered candles", () => {
    expect(() => simulateShadowOutcome(plan({ quantity: 0 }), [])).toThrow();
    expect(() => simulateShadowOutcome(plan(), [
      candle(2_000, 100, 99, 101, 100),
    ])).toThrow();
    expect(() => simulateShadowOutcome(plan(), [
      candle(3_000, 100, 101, 99, 100),
      candle(2_000, 100, 101, 99, 100),
    ])).toThrow();
  });
});
