import { describe, expect, it } from "vitest";
import { buildStrategyScorecard } from "./strategy-scorecard";
import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

function evaluation(returns: number[], trades: Array<{ pnl: number; pnlPct: number }>[]): WalkForwardEvaluationResult {
  const folds = returns.map((totalReturnPct, index) => {
    const foldTrades = trades[index].map((trade) => ({
      entryTimestamp: index * 1000,
      exitTimestamp: index * 1000 + 1,
      entryPrice: 100,
      exitPrice: 100,
      quantity: 1,
      entryFee: 0,
      exitFee: 0,
      pnl: trade.pnl,
      pnlPct: trade.pnlPct,
    }));
    return {
      index,
      trainStartTimestamp: 0,
      trainEndTimestamp: 1,
      testStartTimestamp: 2,
      testEndTimestamp: 3,
      result: {
        startingCapital: 1000,
        endingEquity: 1000 * (1 + totalReturnPct / 100),
        cash: 1000,
        totalReturnPct,
        maxDrawdownPct: index + 1,
        completedTrades: foldTrades.length,
        winRatePct: 0,
        totalFees: 2,
        trades: foldTrades,
        equityCurve: [],
        openPosition: null,
      },
    };
  });
  const allTrades = folds.flatMap((fold) => fold.result.trades);
  const winners = allTrades.filter((trade) => trade.pnl > 0).length;
  return {
    folds,
    foldCount: folds.length,
    totalCompletedTrades: allTrades.length,
    totalFees: folds.reduce((sum, fold) => sum + fold.result.totalFees, 0),
    meanFoldReturnPct: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    compoundedReturnPct: 0,
    worstFoldDrawdownPct: Math.max(...folds.map((fold) => fold.result.maxDrawdownPct)),
    aggregateWinRatePct: allTrades.length ? winners / allTrades.length * 100 : 0,
  };
}

describe("buildStrategyScorecard", () => {
  it("reports fold consistency and trade-level expectancy after costs", () => {
    const result = buildStrategyScorecard(evaluation(
      [10, -5, 5],
      [[{ pnl: 20, pnlPct: 2 }, { pnl: -10, pnlPct: -1 }], [{ pnl: -5, pnlPct: -0.5 }], [{ pnl: 15, pnlPct: 1.5 }]],
    ));
    expect(result).toMatchObject({
      foldCount: 3,
      positiveFoldCount: 2,
      positiveFoldPct: 200 / 3,
      medianFoldReturnPct: 5,
      worstFoldReturnPct: -5,
      completedTrades: 4,
      winningTrades: 2,
      losingTrades: 2,
      winRatePct: 50,
      grossProfit: 35,
      grossLoss: 15,
      profitFactor: 35 / 15,
      expectancyPerTrade: 5,
      totalFees: 6,
      worstFoldDrawdownPct: 3,
    });
  });

  it("uses null profit factor when there are no losing trades", () => {
    const result = buildStrategyScorecard(evaluation([1], [[{ pnl: 10, pnlPct: 1 }]]));
    expect(result.profitFactor).toBeNull();
    expect(result.expectancyPerTrade).toBe(10);
  });

  it("returns null trade metrics when no trades completed", () => {
    const result = buildStrategyScorecard(evaluation([0, 0], [[], []]));
    expect(result.completedTrades).toBe(0);
    expect(result.winRatePct).toBeNull();
    expect(result.profitFactor).toBeNull();
    expect(result.expectancyPerTrade).toBeNull();
  });

  it("rejects malformed fold and trade values", () => {
    const malformed = evaluation([1], [[{ pnl: 1, pnlPct: 1 }]]);
    malformed.folds[0].result.trades[0].pnl = Number.NaN;
    expect(() => buildStrategyScorecard(malformed)).toThrow();
  });
});
