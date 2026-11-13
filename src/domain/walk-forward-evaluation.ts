import { runBacktest, type BacktestConfig, type BacktestResult, type StrategyEvaluator } from "./backtest";
import { runExecutionAwareBacktest, type ExecutionAwareBacktestResult } from "./execution-aware-backtest";
import type { MarketExecutionConfig } from "./execution-model";
import type { Candle } from "./candles";
import { buildWalkForwardFolds, type WalkForwardConfig } from "./walk-forward";

export type StrategyFactory = (training: readonly Candle[]) => StrategyEvaluator;

export interface WalkForwardEvaluationConfig {
  folds: WalkForwardConfig;
  backtest: Omit<BacktestConfig, "warmupBars">;
  /** Optional realistic candle-volume execution model; absent preserves legacy fills. */
  executionModel?: MarketExecutionConfig;
  /** Fit parameters using training candles only; return a frozen test-time evaluator. */
  fit: StrategyFactory;
}

export interface WalkForwardFoldResult {
  index: number;
  trainStartTimestamp: number;
  trainEndTimestamp: number;
  testStartTimestamp: number;
  testEndTimestamp: number;
  result: BacktestResult | ExecutionAwareBacktestResult;
}

export interface WalkForwardEvaluationResult {
  folds: WalkForwardFoldResult[];
  foldCount: number;
  totalCompletedTrades: number;
  totalFees: number;
  meanFoldReturnPct: number;
  compoundedReturnPct: number;
  worstFoldDrawdownPct: number;
  aggregateWinRatePct: number;
  totalFillEvents: number;
  totalPartialFillEvents: number;
  foldsWithOpenPositions: number;
  foldsWithPendingOrders: number;
  totalPendingQuantity: number;
}

/**
 * Fits a strategy independently on each training fold and evaluates it only
 * against that fold's subsequent test candles. Each fold starts with the same
 * configured capital; compoundedReturnPct models sequential reinvestment of
 * those per-fold returns and is not a pooled trade-level equity curve.
 */
export function evaluateWalkForward(
  candles: readonly Candle[],
  config: WalkForwardEvaluationConfig,
): WalkForwardEvaluationResult {
  if (typeof config.fit !== "function") throw new TypeError("fit must be a function");
  const folds = buildWalkForwardFolds(candles, config.folds);
  const results: WalkForwardFoldResult[] = [];

  for (const fold of folds) {
    const evaluator = config.fit(fold.train);
    if (typeof evaluator !== "function") {
      throw new TypeError("Strategy factory must return a strategy evaluator");
    }
    const testSeries = [...fold.train, ...fold.embargo, ...fold.test];
    if (config.executionModel && config.backtest.protectiveOrders) {
      throw new RangeError("Execution-aware backtesting does not yet support protective stop/target orders");
    }
    const result = config.executionModel
      ? runExecutionAwareBacktest(testSeries, evaluator, {
        initialCapital: config.backtest.initialCapital,
        allocationFraction: config.backtest.allocationFraction,
        warmupBars: fold.train.length + fold.embargo.length,
        executionModel: config.executionModel,
      })
      : runBacktest(testSeries, evaluator, {
        ...config.backtest,
        warmupBars: fold.train.length + fold.embargo.length,
      });
    results.push({
      index: fold.index,
      trainStartTimestamp: fold.train[0].timestamp,
      trainEndTimestamp: fold.train[fold.train.length - 1].timestamp,
      testStartTimestamp: fold.test[0].timestamp,
      testEndTimestamp: fold.test[fold.test.length - 1].timestamp,
      result,
    });
  }

  const totalCompletedTrades = results.reduce((sum, fold) => sum + fold.result.completedTrades, 0);
  const totalFees = results.reduce((sum, fold) => sum + fold.result.totalFees, 0);
  const meanFoldReturnPct = results.reduce((sum, fold) => sum + fold.result.totalReturnPct, 0) / results.length;
  const compoundedGrowth = results.reduce(
    (growth, fold) => growth * (1 + fold.result.totalReturnPct / 100),
    1,
  );
  const winners = results.reduce(
    (sum, fold) => sum + fold.result.trades.filter((trade) => trade.pnl > 0).length,
    0,
  );

  return {
    folds: results,
    foldCount: results.length,
    totalCompletedTrades,
    totalFees,
    meanFoldReturnPct,
    compoundedReturnPct: (compoundedGrowth - 1) * 100,
    worstFoldDrawdownPct: Math.max(...results.map((fold) => fold.result.maxDrawdownPct)),
    aggregateWinRatePct: totalCompletedTrades ? (winners / totalCompletedTrades) * 100 : 0,
    totalFillEvents: results.reduce((sum, fold) => sum + ("fillEvents" in fold.result ? fold.result.fillEvents : 0), 0),
    totalPartialFillEvents: results.reduce((sum, fold) => sum + ("partialFillEvents" in fold.result ? fold.result.partialFillEvents : 0), 0),
    foldsWithOpenPositions: results.filter((fold) => fold.result.openPosition !== null).length,
    foldsWithPendingOrders: results.filter((fold) => "pendingOrder" in fold.result && fold.result.pendingOrder !== null).length,
    totalPendingQuantity: results.reduce((sum, fold) => sum + ("pendingOrder" in fold.result ? fold.result.pendingOrder?.remainingQuantity ?? 0 : 0), 0),
  };
}
