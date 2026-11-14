import { describe, expect, it } from "vitest";
import { runExecutionStressTest } from "./execution-stress-test";
import type { Candle } from "./candles";

const candles: Candle[] = Array.from({ length: 24 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10_000,
}));

const config = {
  folds: { trainBars: 8, testBars: 4, stepBars: 4, embargoBars: 0 },
  backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
  executionModel: {
    feeRate: 0.001,
    baseSlippageBps: 5,
    halfSpreadBps: 2,
    maxParticipationRate: 0.1,
    marketImpactBpsAtMaxParticipation: 20,
  },
  regime: {
    fastEmaPeriod: 2, slowEmaPeriod: 3, atrPeriod: 2,
    trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.1, highVolatilityAtrPct: 10,
  },
};

const candidates = [{
  id: "buy-once-v1",
  name: "Buy once",
  fit: (training: readonly Candle[]) => (history: readonly Candle[]) =>
    history.length === training.length + 1 ? "buy" as const : "hold" as const,
}];

describe("runExecutionStressTest", () => {
  it("runs a baseline and deterministic adverse-cost and reduced-capacity scenarios", () => {
    const report = runExecutionStressTest(candles, candidates, config, {}, {
      symbol: "BTCUSDT", interval: "1m", provider: "test",
    });
    expect(report.scenarios.map((scenario) => scenario.id)).toEqual([
      "baseline", "friction-1_5x", "friction-2x", "friction-3x", "capacity-half",
    ]);
    expect(report.scenarios).toHaveLength(5);
    expect(report.scenarios[0].report.config.executionModel).toEqual(config.executionModel);
    expect(report.scenarios[2].report.config.executionModel?.feeRate).toBe(0.002);
    expect(report.scenarios[2].report.config.executionModel?.baseSlippageBps).toBe(10);
    expect(report.scenarios[4].report.config.executionModel?.maxParticipationRate).toBe(0.05);
    expect(report.scenarios.every((scenario) =>
      scenario.report.dataset.fingerprint === report.datasetFingerprint)).toBe(true);
    expect(report.scenarios.every((scenario) =>
      scenario.report.candidateResults[0].evaluation.folds.map((fold) => fold.testStartTimestamp)
        .join(",") === report.scenarios[0].report.candidateResults[0].evaluation.folds
          .map((fold) => fold.testStartTimestamp).join(","))).toBe(true);
  });

  it("does not silently fall back when execution-aware assumptions are missing", () => {
    const legacy = { ...config, executionModel: undefined };
    expect(() => runExecutionStressTest(candles, candidates, legacy, {}, {
      symbol: "BTCUSDT", interval: "1m", provider: "test",
    })).toThrow(/execution-aware/i);
  });

  it("rejects invalid stress multipliers and impossible stressed cost assumptions", () => {
    expect(() => runExecutionStressTest(candles, candidates, config, undefined as never)).toThrow();
    const extreme = {
      ...config,
      executionModel: { ...config.executionModel, baseSlippageBps: 4_000 },
      backtest: { ...config.backtest, slippageBps: 4_000 },
    };
    expect(() => runExecutionStressTest(candles, candidates, extreme, {}, {
      symbol: "BTCUSDT", interval: "1m", provider: "test",
    })).toThrow();
  });

  it("reports deterioration without selecting a preferred scenario", () => {
    const report = runExecutionStressTest(candles, candidates, config, {}, {
      symbol: "BTCUSDT", interval: "1m", provider: "test",
    });
    expect(report.selectionWarning).toMatch(/must not select/i);
    expect(report.scenarios.every((scenario) => scenario.label.length > 0)).toBe(true);
  });
});
