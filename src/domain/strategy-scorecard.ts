import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

export interface StrategyScorecard {
  foldCount: number;
  positiveFoldCount: number;
  positiveFoldPct: number | null;
  meanFoldReturnPct: number | null;
  medianFoldReturnPct: number | null;
  worstFoldReturnPct: number | null;
  bestFoldReturnPct: number | null;
  foldReturnStdDevPct: number | null;
  completedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number | null;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
  totalFees: number;
  worstFoldDrawdownPct: number | null;
  totalFillEvents: number;
  totalPartialFillEvents: number;
  foldsWithOpenPositions: number;
  foldsWithPendingOrders: number;
  totalPendingQuantity: number;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Summarises chronological out-of-sample folds and their completed trades.
 * PnL is taken from the backtest ledger, which is net of entry/exit fees.
 * An open position is not a completed trade and is excluded from trade metrics.
 */
export function buildStrategyScorecard(evaluation: WalkForwardEvaluationResult): StrategyScorecard {
  if (!Number.isSafeInteger(evaluation.foldCount) || evaluation.foldCount < 0 ||
      evaluation.foldCount !== evaluation.folds.length) {
    throw new RangeError("foldCount must match the number of folds");
  }
  finite(evaluation.totalFees, "totalFees");
  if (evaluation.totalFees < 0) throw new RangeError("totalFees must be non-negative");

  const returns = evaluation.folds.map((fold) => {
    finite(fold.result.totalReturnPct, "fold totalReturnPct");
    finite(fold.result.maxDrawdownPct, "fold maxDrawdownPct");
    if (fold.result.maxDrawdownPct < 0) throw new RangeError("fold maxDrawdownPct must be non-negative");
    return fold.result.totalReturnPct;
  });
  const trades = evaluation.folds.flatMap((fold) => fold.result.trades);

  for (const trade of trades) {
    finite(trade.pnl, "trade pnl");
    finite(trade.pnlPct, "trade pnlPct");
  }

  const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
  const losingTrades = trades.filter((trade) => trade.pnl < 0).length;
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(0, trade.pnl), 0);
  const grossLoss = trades.reduce((sum, trade) => sum + Math.max(0, -trade.pnl), 0);
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const positiveFoldCount = returns.filter((value) => value > 0).length;
  const meanFoldReturnPct = returns.length
    ? returns.reduce((sum, value) => sum + value, 0) / returns.length
    : null;
  const variance = meanFoldReturnPct === null
    ? null
    : returns.reduce((sum, value) => sum + (value - meanFoldReturnPct) ** 2, 0) / returns.length;

  return {
    foldCount: returns.length,
    positiveFoldCount,
    positiveFoldPct: returns.length ? (positiveFoldCount * 100) / returns.length : null,
    meanFoldReturnPct,
    medianFoldReturnPct: median(returns),
    worstFoldReturnPct: returns.length ? Math.min(...returns) : null,
    bestFoldReturnPct: returns.length ? Math.max(...returns) : null,
    foldReturnStdDevPct: variance === null ? null : Math.sqrt(variance),
    completedTrades: trades.length,
    winningTrades,
    losingTrades,
    winRatePct: trades.length ? winningTrades / trades.length * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancyPerTrade: trades.length ? totalPnl / trades.length : null,
    totalFees: evaluation.totalFees,
    worstFoldDrawdownPct: returns.length
      ? Math.max(...evaluation.folds.map((fold) => fold.result.maxDrawdownPct))
      : null,
    totalFillEvents: evaluation.totalFillEvents,
    totalPartialFillEvents: evaluation.totalPartialFillEvents,
    foldsWithOpenPositions: evaluation.foldsWithOpenPositions,
    foldsWithPendingOrders: evaluation.foldsWithPendingOrders,
    totalPendingQuantity: evaluation.totalPendingQuantity,
  };
}
