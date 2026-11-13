import { describe, expect, it } from "vitest";
import { runProtectiveExitSensitivity } from "./protective-exit-sensitivity";
import type { Candle } from "./candles";

const candles: Candle[] = Array.from({ length: 16 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: index === 7 ? 115 : 102 + index,
  low: index === 7 ? 99 : 99 + index,
  close: 101 + index,
  volume: 1_000,
}));

const config = {
  folds: { trainBars: 6, testBars: 4, stepBars: 4, embargoBars: 0 },
  backtest: { initialCapital: 1_000, feeRate: 0, slippageBps: 0, allocationFraction: 1 },
  executionModel: {
    feeRate: 0, baseSlippageBps: 0, halfSpreadBps: 0,
    maxParticipationRate: 1, marketImpactBpsAtMaxParticipation: 0,
  },
  regime: {
    fastEmaPeriod: 2, slowEmaPeriod: 3, atrPeriod: 2,
    trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.1, highVolatilityAtrPct: 10,
  },
};

describe("runProtectiveExitSensitivity", () => {
  it("runs a disabled baseline plus the full stop/target cartesian grid", () => {
    const result = runProtectiveExitSensitivity(candles, [{
      id: "buy-once",
      name: "Buy once",
      fit: (training) => (history) => history.length === training.length + 1 ? "buy" : "hold",
    }], config, { stopLossValuesPct: [5], takeProfitValuesPct: [2] }, {
      symbol: "BTCUSDT", interval: "1h", provider: "Binance public spot",
    });

    expect(result.scenarios).toHaveLength(4);
    expect(result.scenarios[0]).toMatchObject({
      stopLossPct: undefined, takeProfitPct: undefined, label: "Stop off · target off",
    });
    expect(result.scenarios.some((scenario) =>
      scenario.stopLossPct === 5 && scenario.takeProfitPct === 2)).toBe(true);
    const targetOnly = result.scenarios.find((scenario) => scenario.stopLossPct === undefined && scenario.takeProfitPct === 2)!;
    const stopOnly = result.scenarios.find((scenario) => scenario.stopLossPct === 5 && scenario.takeProfitPct === undefined)!;
    const combined = result.scenarios.find((scenario) => scenario.stopLossPct === 5 && scenario.takeProfitPct === 2)!;
    expect(targetOnly.report.candidateResults[0].evaluation.folds[0].result.trades[0]?.exitReason).toBe("take-profit");
    expect(stopOnly.report.candidateResults[0].evaluation.folds[0].result.trades[0]?.exitReason).toBe("stop-loss");
    expect(combined.report.candidateResults[0].evaluation.folds[0].result.trades[0]?.exitReason).toBe("stop-loss");
    expect(result.scenarios.every((scenario) =>
      scenario.report.dataset.fingerprint === result.datasetFingerprint)).toBe(true);
    expect(result.scenarios.every((scenario) =>
      scenario.report.dataset.metadata?.symbol === "BTCUSDT")).toBe(true);
  });

  it("uses the same execution-aware fill model and OOS folds for every scenario", () => {
    const result = runProtectiveExitSensitivity(candles, [{
      id: "buy-once",
      name: "Buy once",
      fit: (training) => (history) => history.length === training.length + 1 ? "buy" : "hold",
    }], config, { stopLossValuesPct: [5], takeProfitValuesPct: [2] });

    for (const scenario of result.scenarios) {
      const candidate = scenario.report.candidateResults[0];
      expect(candidate.evaluation.foldCount).toBe(2);
      expect(candidate.evaluation.totalFillEvents).toBeGreaterThan(0);
      expect(scenario.report.config.executionModel).toEqual(config.executionModel);
      expect(candidate.evaluation.folds.map((fold) => fold.testStartTimestamp)).toEqual(
        result.scenarios[0].report.candidateResults[0].evaluation.folds.map((fold) => fold.testStartTimestamp),
      );
    }
  });

  it("rejects invalid, duplicate and oversized grids", () => {
    const candidates = [{ id: "hold", name: "Hold", fit: () => () => "hold" as const }];
    expect(() => runProtectiveExitSensitivity(candles, candidates, config, {
      stopLossValuesPct: [0], takeProfitValuesPct: [],
    })).toThrow();
    expect(() => runProtectiveExitSensitivity(candles, candidates, config, {
      stopLossValuesPct: [5, 5], takeProfitValuesPct: [],
    })).toThrow();
    expect(() => runProtectiveExitSensitivity(candles, candidates, config, {
      stopLossValuesPct: [1, 2, 3, 4, 5], takeProfitValuesPct: [1, 2, 3, 4, 5],
    })).toThrow();
  });

  it("states that scenario results are exploratory and not an unbiased selected result", () => {
    const result = runProtectiveExitSensitivity(candles, [{
      id: "hold", name: "Hold", fit: () => () => "hold",
    }], config, { stopLossValuesPct: [], takeProfitValuesPct: [] });
    expect(result.selectionWarning).toMatch(/selection bias/i);
    expect(result.scenarios).toHaveLength(1);
  });
});
