# Backtest engine contract (v0)

## Execution model
- Long-only spot; one position at a time; no leverage or short selling.
- Strategy evaluates the candle history ending at the current candle close.
- A buy/sell signal is queued and executes at the next candle open. A signal on the final candle is not filled.
- Buy fills apply adverse slippage upward; sell fills apply adverse slippage downward.
- Fees are charged on entry and exit notional.
- Position size is bounded by the configured fraction of available cash, including the entry fee.
- Open positions are marked to market at the final candle close. They are not force-liquidated; no hypothetical exit fee is deducted from final equity.

## Inputs and constraints
- Candles must pass the shared OHLCV validator and have strictly positive spot OHLC prices.
- Timestamps must be strictly increasing; duplicates and out-of-order bars are rejected.
- Initial capital must be positive.
- Fee rate must be in [0, 1); slippage must be in [0, 10,000) basis points.
- Allocation fraction must be in (0, 1].

## Walk-forward out-of-sample evaluation

- `evaluateWalkForward` creates expanding or rolling chronological folds with non-overlapping test windows and an optional embargo.
- A strategy factory receives only the fold's training candles. It returns a fresh evaluator for that fold; the engine then supplies training and embargo bars as indicator warm-up context, but excludes them from fills, equity curves and reported returns.
- Warm-up bars are not traded. The first test-window close may generate a signal, which can fill no earlier than the next test candle open.
- Each fold resets to the configured initial capital. Results include each fold plus mean, median, worst and best fold return, total trades/fees, pooled win rate and worst fold drawdown. Fold returns are descriptive statistics and are not compounded into a synthetic portfolio.

## Output
The engine returns closed trades, entry/exit fills, per-side fees, P&L, equity curve, ending marked-to-market equity, total return, maximum peak-to-trough drawdown, win rate, total fees and any remaining open position.

## Known model limitations
This is a deterministic research simulator, not an exchange execution emulator. It does not yet model bid/ask spread, order-book depth, partial fills, market impact, funding, borrow, taxes, outages or latency. It is long-only spot and does not force-close the final position. These limitations must be addressed before performance claims or live use. Walk-forward folds reduce temporal leakage but do not remove multiple-testing bias, parameter overfitting, survivorship bias, regime shift or the need for a final untouched holdout. Fold-level strategy selection and parameter-search accounting are not yet automated.
