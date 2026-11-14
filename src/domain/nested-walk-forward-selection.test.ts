import { describe, expect, it } from "vitest";
import { runNestedWalkForwardSelection } from "./nested-walk-forward-selection";
import type { Candle } from "./candles";

const makeCandles = (): Candle[] => Array.from({ length: 30 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1_000,
}));

const pipeline = {
  folds: { trainBars: 5, testBars: 3, stepBars: 3, embargoBars: 1, expanding: true },
  backtest: { initialCapital: 1_000, feeRate: 0.001, slippageBps: 2, allocationFraction: 0.5 },
  executionModel: {
    feeRate: 0.001, baseSlippageBps: 2, halfSpreadBps: 1,
    maxParticipationRate: 0.1, marketImpactBpsAtMaxParticipation: 5,
  },
  regime: {
    fastEmaPeriod: 2, slowEmaPeriod: 3, atrPeriod: 2,
    trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.1, highVolatilityAtrPct: 10,
  },
};

const nestedConfig = {
  outerFolds: { trainBars: 12, testBars: 5, stepBars: 5, embargoBars: 1, expanding: true },
  innerFolds: { trainBars: 5, testBars: 3, stepBars: 3, embargoBars: 1, expanding: true },
  grid: { stopLossValuesPct: [2, 4], takeProfitValuesPct: [3, 6] },
  minimumInnerTrades: 1,
};

describe("runNestedWalkForwardSelection", () => {
  it("never supplies outer test candles to inner parameter selection", () => {
    const candles = makeCandles();
    const observedTrainingEndTimestamps: number[] = [];
    const result = runNestedWalkForwardSelection(candles, [{
      id: "hold",
      name: "Hold",
      fit: (training) => {
        observedTrainingEndTimestamps.push(training[training.length - 1].timestamp);
        return () => "hold";
      },
    }], pipeline, nestedConfig);

    expect(result.candidateResults[0].folds.length).toBeGreaterThan(0);
    for (const [index, fold] of result.candidateResults[0].folds.entries()) {
      expect(fold.trainEndTimestamp).toBeLessThan(fold.testStartTimestamp);
      expect(fold.testStartTimestamp - fold.trainEndTimestamp).toBe(2 * 60_000);
      if (index > 0) {
        expect(result.candidateResults[0].folds[index - 1].testEndTimestamp)
          .toBeLessThan(fold.testStartTimestamp);
      }
    }
    expect(observedTrainingEndTimestamps.length).toBeGreaterThan(0);
    expect(observedTrainingEndTimestamps.every((timestamp) =>
      timestamp < Math.max(...result.candidateResults[0].folds.map((fold) => fold.testStartTimestamp)))).toBe(true);
  });

  it("does not let changes to an outer test window change its selected parameters", () => {
    const candles = makeCandles();
    const candidates = [{ id: "hold", name: "Hold", fit: () => () => "hold" as const }];
    const first = runNestedWalkForwardSelection(candles, candidates, pipeline, nestedConfig);
    const changedTest = candles.map((candle, index) => index >= 13 && index < 18
      ? { ...candle, open: candle.open * 4, high: candle.high * 4, low: candle.low * 4, close: candle.close * 4 }
      : candle);
    const second = runNestedWalkForwardSelection(changedTest, candidates, pipeline, nestedConfig);

    expect(first.candidateResults[0].folds[0].selectedStopLossPct)
      .toBe(second.candidateResults[0].folds[0].selectedStopLossPct);
    expect(first.candidateResults[0].folds[0].selectedTakeProfitPct)
      .toBe(second.candidateResults[0].folds[0].selectedTakeProfitPct);
  });

  it("uses the disabled baseline when no inner scenario meets the minimum trade requirement", () => {
    const result = runNestedWalkForwardSelection(makeCandles(), [{
      id: "hold", name: "Hold", fit: () => () => "hold",
    }], pipeline, nestedConfig);

    expect(result.candidateResults[0].folds[0].selectedStopLossPct).toBeUndefined();
    expect(result.candidateResults[0].folds[0].selectedTakeProfitPct).toBeUndefined();
    expect(result.candidateResults[0].folds[0].selectionReason).toMatch(/minimum trade/i);
  });

  it("selects the strongest eligible protective settings from inner OOS trades", () => {
    const candles = makeCandles().map((candle, index) => {
      if (index === 8 || index === 11) {
        return { ...candle, high: candle.open + 4, low: candle.open - 4, close: candle.open + 1 };
      }
      return candle;
    });
    const result = runNestedWalkForwardSelection(candles, [{
      id: "buy-and-protect",
      name: "Buy and protect",
      fit: (training) => (history) =>
        history.length === training.length + 2 ? "buy" : "hold",
    }], pipeline, nestedConfig);

    expect(result.candidateResults[0].folds[0].selectedStopLossPct).toBeUndefined();
    expect(result.candidateResults[0].folds[0].selectedTakeProfitPct).toBe(3);
    expect(result.candidateResults[0].folds[0].innerSelection.completedTrades).toBeGreaterThanOrEqual(1);
    expect(result.candidateResults[0].totalFees).toBeGreaterThan(0);
    expect(result.candidateResults[0].totalFillEvents).toBeGreaterThan(0);
    expect(result.candidateResults[0].averageExposurePct).toBeGreaterThan(0);
    expect(result.candidateResults[0].completedTurnover).toBe(0);
  });

  it("rejects invalid fold geometry and selection thresholds", () => {
    const candidates = [{ id: "hold", name: "Hold", fit: () => () => "hold" as const }];
    expect(() => runNestedWalkForwardSelection(makeCandles(), candidates, pipeline, {
      ...nestedConfig,
      innerFolds: { trainBars: 12, testBars: 3, stepBars: 3, embargoBars: 1 },
    })).toThrow();
    expect(() => runNestedWalkForwardSelection(makeCandles(), candidates, pipeline, {
      ...nestedConfig,
      minimumInnerTrades: -1,
    })).toThrow();
  });

  it("reports outer test metrics separately from inner selection metrics", () => {
    const result = runNestedWalkForwardSelection(makeCandles(), [{
      id: "hold", name: "Hold", fit: () => () => "hold",
    }], pipeline, nestedConfig);
    const fold = result.candidateResults[0].folds[0];

    expect(fold.innerSelection.foldCount).toBeGreaterThan(0);
    expect(fold.outerEvaluation.evaluation.foldCount).toBe(1);
    expect(fold.outerEvaluation.evaluation.folds[0].testStartTimestamp).toBe(fold.testStartTimestamp);
    expect(result.selectionWarning).toMatch(/outer test/i);
  });
});
