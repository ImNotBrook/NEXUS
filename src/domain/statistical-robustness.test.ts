import { describe, expect, it } from "vitest";
import { buildStatisticalRobustnessReport } from "./statistical-robustness";
import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

function evaluation(pnls: number[], foldReturns = [2, 1, 3, -1, 2]): WalkForwardEvaluationResult {
  const trades = pnls.map((pnl, index) => ({
    entryTimestamp: index * 2, exitTimestamp: index * 2 + 1,
    entryPrice: 100, exitPrice: 100, quantity: 1,
    entryFee: 0, exitFee: 0, pnl, pnlPct: pnl,
    exitReason: "signal" as const,
  }));
  const folds = foldReturns.map((totalReturnPct, index) => ({
    index, trainStartTimestamp: 0, trainEndTimestamp: 1,
    testStartTimestamp: 2, testEndTimestamp: 3,
    result: {
      startingCapital: 1000, endingEquity: 1000 * (1 + totalReturnPct / 100),
      cash: 1000, totalReturnPct, maxDrawdownPct: 4,
      completedTrades: 0, winRatePct: 0, totalFees: 0,
      trades: trades.slice(index * Math.ceil(trades.length / foldReturns.length),
        (index + 1) * Math.ceil(trades.length / foldReturns.length)),
      equityCurve: [], openPosition: null,
    },
  }));
  const completed = folds.reduce((sum, fold) => sum + fold.result.trades.length, 0);
  return {
    folds, foldCount: folds.length, totalCompletedTrades: completed,
    totalFees: 0, meanFoldReturnPct: 0, compoundedReturnPct: 0,
    worstFoldDrawdownPct: 4, aggregateWinRatePct: 50,
    totalFillEvents: 0, totalPartialFillEvents: 0,
    foldsWithOpenPositions: 0, foldsWithPendingOrders: 0, totalPendingQuantity: 0,
  };
}

describe("buildStatisticalRobustnessReport", () => {
  it("reports sample uncertainty and a deterministic block-bootstrap expectancy interval", () => {
    const input = evaluation(Array.from({ length: 50 }, (_, i) => i % 3 === 0 ? -1 : 2));
    const first = buildStatisticalRobustnessReport(input, 3);
    const second = buildStatisticalRobustnessReport(input, 3);
    expect(first).toEqual(second);
    expect(first.completedTrades).toBe(50);
    expect(first.winRateConfidence95.lowerPct).toBeLessThan(first.winRatePct!);
    expect(first.winRateConfidence95.upperPct).toBeGreaterThan(first.winRatePct!);
    expect(first.expectancyBlockBootstrap95).not.toBeNull();
    expect(first.warnings).toContain("Multiple candidates were evaluated; the best observed result is exposed to selection bias.");
  });

  it("refuses to label a small sample as robust", () => {
    const report = buildStatisticalRobustnessReport(evaluation([2, -1, 3]), 1);
    expect(report.status).toBe("INSUFFICIENT_SAMPLE");
    expect(report.expectancyBlockBootstrap95).toBeNull();
    expect(report.warnings).toContain("Fewer than 30 completed out-of-sample trades.");
  });

  it("flags fragile expectancy and unresolved execution state", () => {
    const input = evaluation(Array.from({ length: 40 }, (_, i) => i % 2 ? 1 : -1));
    input.folds[0].result.openPosition = {
      entryTimestamp: 0, entryPrice: 100, quantity: 1, entryFee: 0, entryCost: 100,
    };
    const report = buildStatisticalRobustnessReport(input, 1);
    expect(report.status).toBe("FRAGILE");
    expect(report.warnings).toContain("At least one test fold ends with an open position or pending order.");
  });

  it("rejects invalid candidate counts and malformed PnL", () => {
    expect(() => buildStatisticalRobustnessReport(evaluation([1]), 0)).toThrow();
    const input = evaluation([1]);
    input.folds[0].result.trades[0].pnl = Number.NaN;
    expect(() => buildStatisticalRobustnessReport(input, 1)).toThrow();
  });
});
