import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import { createPaperTradingAgentState, runPaperTradingAgentCycle, type PaperTradingAgentConfig } from "./paper-trading-agent";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const config: PaperTradingAgentConfig = {
  allocationFraction: 0.25,
  maxDailyLossFraction: 0.03,
  executionModel: {
    feeRate: 0.001,
    baseSlippageBps: 8,
    halfSpreadBps: 5,
    maxParticipationRate: 0.02,
    marketImpactBpsAtMaxParticipation: 25,
  },
};

function candles(closes: number[], volumes = closes.map(() => 100)): Candle[] {
  return closes.map((close, index) => ({
    timestamp: 1_800_000_000_000 + index * HOUR,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: volumes[index],
  }));
}

describe("persistent paper trading agent", () => {
  it("queues a close-generated buy and fills it at the next candle open with execution costs", () => {
    const data = candles([100, 100, 102, 103], [100, 100, 10_000, 10_000]);
    const start = data[0].timestamp;
    const state = createPaperTradingAgentState("test-sma", 10_000, start);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", config);
    expect(next.pendingOrder).toBeNull();
    expect(next.position?.quantity).toBeGreaterThan(0);
    expect(next.fills.length).toBeGreaterThan(0);
    expect(next.fills[0].timestamp).toBe(data[2].timestamp);
    expect(next.fills[0].executionPrice).toBeGreaterThan(data[2].open);
    expect(next.totalFees).toBeGreaterThan(0);
  });

  it("keeps partial market fills pending and completes them on later candles", () => {
    const data = candles([100, 100, 100, 100, 100, 100], [100, 100, 1, 1, 10_000, 10_000]);
    const start = data[0].timestamp;
    const state = createPaperTradingAgentState("test-partial", 10_000, start);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", config);
    expect(next.fills.length).toBeGreaterThan(1);
    expect(next.totalPartialFillEvents).toBeGreaterThan(0);
    expect(next.pendingOrder).toBeNull();
    expect(next.position?.quantity).toBeGreaterThan(0);
  });

  it("closes a long position on a sell signal and records net P&L after fees", () => {
    const data = candles([100, 100, 100, 105, 110, 108], [100, 100, 100, 100, 10_000, 100]);
    const start = data[0].timestamp;
    const state = createPaperTradingAgentState("test-roundtrip", 10_000, start);
    const next = runPaperTradingAgentCycle(state, data, (history) => {
      if (history.length === 2) return "buy";
      if (history.length === 4) return "sell";
      return "hold";
    }, config);
    expect(next.position).toBeNull();
    expect(next.completedTrades).toBe(1);
    expect(next.trades[0].pnl).toBeGreaterThan(0);
    expect(next.trades[0].exitFee).toBeGreaterThan(0);
  });

  it("is idempotent when the same closed candles are processed again", () => {
    const data = candles([100, 100, 102, 103]);
    const state = createPaperTradingAgentState("test-idempotent", 10_000, data[0].timestamp);
    const evaluator = (history: readonly Candle[]) => history.length === 2 ? "buy" as const : "hold" as const;
    const first = runPaperTradingAgentCycle(state, data, evaluator, config);
    const second = runPaperTradingAgentCycle(first, data, evaluator, config);
    expect(second).toEqual(first);
  });

  it("does not open short positions when a sell signal occurs while flat", () => {
    const data = candles([100, 99, 98]);
    const state = createPaperTradingAgentState("test-long-only", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, () => "sell", config);
    expect(next.position).toBeNull();
    expect(next.pendingOrder).toBeNull();
    expect(next.fills).toHaveLength(0);
  });

  it("blocks new entries after the configured daily loss limit", () => {
    const data = candles([100, 100, 100, 80, 80], [100, 100, 10_000, 10_000, 10_000]);
    const state = createPaperTradingAgentState("test-daily-stop", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, (history) => {
      if (history.length === 2) return "buy";
      if (history.length === 4) return "sell";
      if (history.length === 5) return "buy";
      return "hold";
    }, config);
    expect(next.pendingOrder).toBeNull();
    expect(next.position).toBeNull();
  });

  it("executes stop-loss exits at the trigger with adverse market costs", () => {
    const data = candles([100, 100, 100, 90, 90], [10_000, 10_000, 10_000, 10_000, 10_000]);
    const state = createPaperTradingAgentState("test-stop", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", {
        ...config,
        protectiveOrders: { stopLossPct: 5 },
      });
    expect(next.position).toBeNull();
    expect(next.completedTrades).toBe(1);
    expect(next.trades[0].exitReason).toBe("stop-loss");
    expect(next.fills.at(-1)?.totalAdverseBps).toBeGreaterThan(0);
  });

  it("executes take-profit as a limit order and preserves opening price improvement", () => {
    const data = candles([100, 100, 100, 110, 111], [10_000, 10_000, 10_000, 10_000, 10_000]);
    const state = createPaperTradingAgentState("test-target", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", {
        ...config,
        protectiveOrders: { takeProfitPct: 5 },
      });
    expect(next.position).toBeNull();
    expect(next.completedTrades).toBe(1);
    expect(next.trades[0].exitReason).toBe("take-profit");
    expect(next.trades[0].exitPrice).toBe(110);
    expect(next.fills.at(-1)?.totalAdverseBps).toBe(0);
  });

  it("chooses the adverse stop when stop and target are both touched in one candle", () => {
    const data = candles([100, 100, 100, 100, 100], [10_000, 10_000, 10_000, 10_000, 10_000]);
    data[3] = { ...data[3], high: 112, low: 88 };
    const state = createPaperTradingAgentState("test-collision", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", {
        ...config,
        protectiveOrders: { stopLossPct: 5, takeProfitPct: 5 },
      });
    expect(next.position).toBeNull();
    expect(next.trades[0].exitReason).toBe("stop-loss");
  });

  it("keeps a partial take-profit limit pending until a later candle reaches its limit", () => {
    const data = candles([100, 100, 100, 106, 104, 106], [10_000, 10_000, 10_000, 1, 10_000, 10_000]);
    const state = createPaperTradingAgentState("test-target-partial", 10_000, data[0].timestamp);
    const next = runPaperTradingAgentCycle(state, data, (history) =>
      history.length === 2 ? "buy" : "hold", {
        ...config,
        protectiveOrders: { takeProfitPct: 5 },
      });
    expect(next.position).toBeNull();
    expect(next.pendingOrder).toBeNull();
    expect(next.completedTrades).toBe(1);
    expect(next.fills.some((fill) => fill.status === "partial" && fill.side === "sell")).toBe(true);
  });

  it("rejects a persisted state without a configuration fingerprint", () => {
    const data = candles([100, 100, 101]);
    const state = createPaperTradingAgentState("test-fingerprint", 10_000, data[0].timestamp);
    const invalid = { ...state, configFingerprint: "" };
    expect(() => runPaperTradingAgentCycle(invalid, data, () => "hold", config)).toThrow("state failed validation");
  });

  it("fails closed if persisted checkpoint is outside available candle history", () => {
    const data = candles([100, 100, 101]);
    const state = createPaperTradingAgentState("test-history", 10_000, data[0].timestamp - DAY * 10);
    expect(() => runPaperTradingAgentCycle(state, data, () => "hold", config)).toThrow("no longer contains");
  });
});
