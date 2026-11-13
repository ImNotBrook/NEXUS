# Baseline strategy library

NEXUS includes three deterministic research baselines. They are starting points for evaluation, not recommendations or claims of profitability.

## SMA crossover

- Computes trailing fast and slow simple moving averages.
- Buys when the fast SMA crosses above the slow SMA.
- Sells when the fast SMA crosses below the slow SMA.
- Requires fast period to be less than slow period.
- Uses only the current and previous trailing windows.

## RSI mean reversion

- Uses incremental Wilder RSI state.
- Buys when RSI crosses upward through the oversold threshold.
- Sells when RSI crosses downward through the overbought threshold.
- Requires 0 <= oversold < overbought <= 100.
- Assumes the evaluator receives stable chronological history prefixes. The backtest engine satisfies this contract.

## Donchian breakout

- Compares the current completed close with the previous N candles' high/low range.
- Buys above the prior upper channel; sells below the prior lower channel.
- Explicitly excludes the current candle from the channel calculation to prevent self-referencing breakouts.

## Execution and validation

All three functions return signals only. They do not submit orders or decide fills. The backtest engine applies next-candle-open execution, configured fees, adverse slippage and position sizing.

Every baseline must be compared with cash and buy-and-hold, evaluated on chronological walk-forward folds, and tested with a final untouched holdout before strategy selection. Parameters must not be selected using the final test data. No baseline is automatically connected to paper execution.

## Reproducible research batches

The domain function runResearchBatch evaluates multiple candidate factories against the same chronological folds, market history, costs, slippage and position-sizing assumptions. Each factory is fitted independently on each fold's training data. The output includes the walk-forward evaluation, trade/fold scorecard and trend × volatility attribution for every candidate.

Candidate IDs must be stable and changed when strategy logic or parameters change. The dataset record includes candle count, first/last timestamp and a 32-bit FNV-1a fingerprint. This fingerprint is a reproducibility aid, not a cryptographic integrity hash.

The pipeline deliberately does not rank, tune, select, promote or execute candidates. Candidate comparison and selection remain an explicit research decision, with multiple-testing and final-holdout controls.
