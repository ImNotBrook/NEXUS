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
  instrumentCategory: "spot",
  volumeUnit: "base",
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

  it("rejects spot shorts until borrow costs and availability are modelled", () => {
    expect(() => simulateShadowOutcome(plan({
      side: "short", stopPrice: 105, targetPrice: 90,
    }), [candle(2_000, 100, 101, 99, 100)])).toThrow(/borrow/i);
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
    expect(open.horizonReached).toBe(true);
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
  it("rejects non-spot instruments until funding-aware simulation is implemented", () => {
    expect(() => simulateShadowOutcome(plan({
      instrumentCategory: "linear_perpetual",
    }), [])).toThrow(/spot/i);
  });

  it("requires non-zero penetration for target limit execution", () => {
    expect(() => simulateShadowOutcome(plan({
      entry: { ...plan().entry, penetrationBps: 0 },
    }), [])).toThrow(/penetration/i);
  });

  it("carries partial target-limit exits until the remaining position is filled", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100, 1_000),
      candle(3_000, 100, 112, 99, 111, 5),
      candle(4_000, 100, 112, 99, 111, 5),
    ]);
    expect(result.status).toBe("completed");
    expect(result.exitFilledQuantity).toBeCloseTo(1);
    expect(result.fillEvents.filter((event) => event.eventType === "exit")).toHaveLength(2);
  });

  it("keeps a triggered partial stop as a market exit even if price later recovers", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100, 1_000),
      candle(3_000, 100, 101, 94, 96, 5),
      candle(4_000, 100, 102, 99, 101, 5),
    ]);
    expect(result.status).toBe("completed");
    expect(result.exitReason).toBe("stop-loss");
    expect(result.exitFilledQuantity).toBeCloseTo(1);
    expect(result.exitAveragePrice).toBeLessThan(100);
  });

  it("calculates MFE and MAE only from post-entry candles", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 104, 97, 101),
    ]);
    expect(result.mfeBps).toBeGreaterThan(0);
    expect(result.maeBps).toBeGreaterThan(0);
  });

  it("invalidates a market entry that gaps outside the original stop/target corridor", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 112, 114, 111, 113),
    ]);
    expect(result.status).toBe("invalidated");
    expect(result.entryFilledQuantity).toBe(0);
    expect(result.invalidationReason).toBe("ENTRY_GAPPED_OUT_OF_PLAN");
  });

  it("retains a triggered stop when volume is insufficient to execute it", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100, 1_000),
      candle(3_000, 100, 101, 94, 96, 0),
    ]);
    expect(result.status).toBe("open");
    expect(result.exitFilledQuantity).toBe(0);
    expect(result.pendingExitReason).toBe("stop-loss");
  });

  it("cancels a residual entry that gaps out while still managing the already-filled position", () => {
    const result = simulateShadowOutcome(plan({
      quantity: 1,
      executionModel: { ...executionModel, maxParticipationRate: 0.1 },
    }), [
      candle(2_000, 100, 101, 99, 100, 5),
      candle(3_000, 112, 113, 111, 112, 5),
    ]);
    expect(result.entryFilledQuantity).toBeCloseTo(0.5);
    expect(result.entryOrderStatus).toBe("cancelled");
    expect(result.invalidationReason).toBe("ENTRY_GAPPED_OUT_OF_PLAN");
    expect(result.exitFilledQuantity).toBeCloseTo(0.5);
    expect(result.status).toBe("completed");
  });

  it("enforces one aggregate participation cap across entry and exit fills in a candle", () => {
    const result = simulateShadowOutcome(plan({
      executionModel: { ...executionModel, maxParticipationRate: 0.1 },
    }), [
      candle(2_000, 100, 101, 99, 100, 5),
      candle(3_000, 100, 112, 99, 111, 5),
    ]);
    expect(result.entryFilledQuantity).toBeCloseTo(1);
    expect(result.exitFilledQuantity).toBe(0);
    expect(result.positionRemainingQuantity).toBeCloseTo(1);
    expect(result.pendingExitReason).toBe("take-profit");
  });

  it("rejects quote-denominated candle volume for base-asset participation calculations", () => {
    expect(() => simulateShadowOutcome(plan({
      volumeUnit: "quote",
    }), [])).toThrow(/base/i);
  });

  it("rejects non-positive spot OHLC prices", () => {
    expect(() => simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 0, 100),
    ])).toThrow(/positive/i);
  });

  it("does not mark an outcome mature when the supplied candles stop before its horizon", () => {
    const result = simulateShadowOutcome(plan(), [
      candle(2_000, 100, 101, 99, 100),
      candle(3_000, 100, 105, 98, 102),
    ]);
    expect(result.status).toBe("open");
    expect(result.horizonReached).toBe(false);
  });

  it("marks a limit-entry candle ambiguous when a protective level also trades", () => {
    const result = simulateShadowOutcome(plan({
      entry: { orderType: "limit", referencePrice: 100, limitPrice: 100,
        earliestEligibleAt: 2_000, expiresAt: 3_000, penetrationBps: 10 },
    }), [candle(2_000, 100.5, 112, 99.8, 111)]);
    expect(result.status).toBe("ambiguous");
    expect(result.entryFilledQuantity).toBe(1);
    expect(result.exitFilledQuantity).toBe(0);
  });

});