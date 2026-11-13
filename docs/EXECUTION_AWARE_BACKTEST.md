# Execution-aware historical backtesting

`runExecutionAwareBacktest` is the partial-fill-aware long-only backtest entry point. It is separate from `runBacktest` so existing research reports and strategy integrations retain their current behavior until explicitly migrated.

## Configuration

The function accepts initial capital, allocation fraction, optional warm-up bars and the shared `MarketExecutionConfig`. Strategy evaluators receive an immutable chronological prefix ending at the current candle close.

## Execution lifecycle

1. A strategy signal generated at a candle close creates an order for the next candle; no same-close fill is possible.
2. At each subsequent candle open, the order is filled against that candle's base-asset volume and configured participation cap.
3. Partial quantities remain pending across later candles. Zero-volume candles do not fill.
4. Buys are additionally constrained by available cash and allocation budget. Sells are constrained by the open long position.
5. A contrary strategy signal cancels the unfilled remainder. Any already filled quantity remains in the portfolio and is accounted for normally.
6. A trade is added to the completed-trade ledger only when the entire long position is closed. Partial exit proceeds and fees are accumulated until closure.
7. Remaining open positions are marked to the final candle close. Pending order remainder is returned separately and is not treated as executed.

## Accounting

- Each fill uses the shared spread, baseline slippage and participation-scaled market-impact model.
- Fees are charged only on filled notional.
- Entry cost includes entry fees; average entry price is quantity-weighted across partial fills.
- Partial exits realize cash proceeds and fees immediately. Final trade P&L is the aggregate net exit proceeds less the full fee-inclusive entry cost.
- Total fees include all partial fills. The open position's remaining cost basis is reduced proportionally after partial exits.

## Limitations and research controls

- Candle volume is a coarse liquidity proxy, not historical order-book depth. The model does not simulate queue priority, latency, tick/lot rounding, exchange rejections or intrabar execution path.
- This execution-aware mode is long-only and optionally supports protective stop/target exits. Protective stop residuals remain market orders; target residuals preserve their limit price. It does not model leverage, shorts or funding.
- The legacy `runBacktest` remains unchanged. Research pipelines must explicitly select `runExecutionAwareBacktest` before claiming partial-fill execution realism.
- This does not remove overfitting, regime, data-quality, survivorship or market-impact calibration risk. Validate assumptions by venue, symbol and timeframe using out-of-sample data.
- Paper and historical simulation only; no live order routing.


## Walk-forward research integration

The research pipeline accepts an optional `executionModel`. When supplied, every out-of-sample fold uses `runExecutionAwareBacktest`; when omitted, the legacy immediate-fill backtester remains in use. The full model is persisted in `ResearchBatchResult.config`, so run comparison detects changed execution assumptions rather than presenting those runs as directly comparable.

The mobile research console now fetches one candle dataset and runs the same candidate set and walk-forward folds twice: legacy and execution-aware. It renders both result sets side by side, stores both reports locally, and shows the execution-cost sensitivity deltas. These deltas are deliberately labelled as a sensitivity analysis, not an apples-to-apples strategy comparison.

Each strategy scorecard also includes fill-event count, partial-fill event count, number of folds ending with open positions, number of folds ending with pending orders, and aggregate unfilled residual quantity. Open positions and pending orders are not completed trades; completed-trade win rate and expectancy exclude them, while fold equity includes marked-to-market open inventory.

The UI exposes fee, baseline slippage, half-spread, maximum candle-volume participation and market impact at the participation cap. Defaults are scenario assumptions, not empirically calibrated venue estimates. Calibrate them against exchange-specific historical order-book or trade data before interpreting the results.


## Protective exits in execution-aware walk-forward research

The optional `backtest.protectiveOrders` configuration is propagated into every execution-aware out-of-sample fold. Stop-market exits use the configured market fill model; take-profit exits retain limit semantics and are not charged adverse market spread/slippage. The settings are retained in the research report configuration and strict run comparison rejects reports with different stop/target assumptions. The mobile console exposes independent optional stop-loss and take-profit percentages and reports completed stop-loss and take-profit exit counts. Empty fields disable that protective order.