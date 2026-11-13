# Market regime classification and evaluation

NEXUS classifies each candle into one trend bucket and one volatility bucket. The classifier is causal: each row uses only that candle and earlier candles.

## Trend classification

- Fast EMA and slow EMA are seeded with the existing SMA-seeded EMA implementation.
- Spread is `(fast EMA - slow EMA) / slow EMA × 100`.
- `uptrend` when spread is greater than the configured positive threshold.
- `downtrend` when spread is below the negative threshold.
- `range` otherwise.
- `unknown` during EMA warm-up or when the slow EMA cannot be used.

## Volatility classification

- Uses Wilder ATR divided by close, expressed as a percentage.
- `low` below the configured low threshold.
- `high` above the configured high threshold.
- `normal` between the thresholds, inclusive.
- `unknown` during ATR warm-up or when close is non-positive.

Thresholds are explicit configuration. They are not optimized on the out-of-sample test window. Thresholds are instrument- and timeframe-dependent; do not treat one set as universal. If thresholds are selected by optimization, selection must occur inside the training data, never on the reported test fold.

## Regime scorecard

Completed trades are attributed to the regime on the candle immediately before the exit fill timestamp. The backtester exits at the next candle open, so using the exit candle's close/high/low would introduce information unavailable at the fill. Trades with insufficient warm-up context are counted as unclassified. A trade exit timestamp absent from the supplied candle history is a hard data-integrity error.

The scorecard groups by trend × volatility and reports completed trades, win rate, net PnL, gross profit/loss, profit factor and net expectancy. PnL is already net of fees and slippage from the backtest ledger.

## Limitations

- EMA spread is a simple trend proxy, not a market-structure or statistical regime-switching model.
- ATR% measures realized range, not implied volatility or liquidity.
- Fixed thresholds can misclassify assets and timeframes; report configuration alongside every result.
- Small per-regime trade counts are descriptive only. Do not rank regimes on tiny samples.
- This is a research diagnostic, not a signal generator or permission to trade.
