# Walk-forward evaluation protocol

`src/domain/walk-forward-evaluation.ts` connects chronological folds to the existing next-open-fill backtest engine.

## Contract

For every fold:

1. `fit(training)` receives only that fold's training candles and must return a `StrategyEvaluator`.
2. The evaluator is then run on the fold's test candles only.
3. The backtest starts with the configured capital independently for each fold.
4. Signals are generated from test-fold history and filled at the next test candle open, using the existing fee and slippage model.
5. Results are reported per fold and as aggregate summaries.

The aggregate compounded return treats fold returns as sequential reinvestment of the same starting capital. It is a summary of the fold returns, not a pooled trade-level equity curve. Mean fold return, worst fold drawdown, aggregate completed trades, fees and trade-weighted win rate are also reported.

## Strategy implementation requirements

The factory may fit parameters or capture state from training data. The returned evaluator receives only candles observed so far in the test fold. Strategies that require indicator warm-up at the test boundary must explicitly carry the training-derived indicator state into the evaluator; do not recompute parameters from test outcomes.

Do not use the same test fold to tune a strategy and claim its return as unbiased validation. Any model/parameter selection must occur inside training data (ideally with a nested validation procedure). Keep a final untouched holdout period outside all walk-forward selection.

## Interpretation and limitations

This implementation runs a fresh independent backtest for each test fold. It does not simulate one continuous account across folds, capital allocation between concurrent assets, funding, borrow, spread dynamics, partial fills, market impact, delisted assets, or order-book liquidity. The current backtester is long-only spot. Results are not evidence of future profitability.

A walk-forward protocol reduces direct train/test leakage but does not eliminate multiple-testing bias, survivorship bias, data quality problems, regime change, or overfitting from repeated human inspection of test results.
