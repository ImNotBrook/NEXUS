# Protective order simulation model

The NEXUS long-only spot backtesters optionally accept `protectiveOrders` with a stop-loss percentage, take-profit percentage, or both. Percentages are measured from the simulated entry fill price. In the execution-aware backtester, protection is disabled unless explicitly configured.

## Execution semantics

1. Protective orders become active on the candle after entry. The entry candle's high/low is not inspected because OHLC data cannot establish whether the protective level traded before or after the opening entry.
2. A stop-market gap through the stop uses the candle open as its reference price; an intrabar stop uses the stop level. Both are executed through the shared market execution model, including adverse slippage, half-spread, participation-scaled market impact and fees.
3. A take-profit is modelled as a sell limit. An intrabar touch fills at the target; a gap above the target receives the opening price. No adverse market costs are applied to a limit fill, but the fee is charged.
4. If both stop and target are touched intrabar and the open has not already crossed either level, the stop is assumed to have happened first. This is deliberately conservative because OHLC candles do not reveal intrabar path.
5. Fill quantity is capped by the configured maximum participation of candle volume. If a protective exit is only partially filled, the remaining quantity stays pending.
6. A partially filled stop remains a market exit and is processed against subsequent candle opens using the market execution model. A partially filled take-profit remains a limit exit at its original target price: later candles must reach the limit, and an opening gap above it receives price improvement.
7. A pending protective exit cannot be cancelled by a contrary strategy signal and is not retriggered while its remainder is pending.
8. Completed trade P&L aggregates all partial exit proceeds and fees against the full fee-inclusive entry cost. Open residual inventory remains marked to market and is not counted as a completed trade.

## Limitations

This is a bar-based approximation, not exchange matching-engine simulation. Candle volume is a coarse liquidity proxy, not order-book depth. The model does not simulate queue priority, latency, tick/lot rounding, exchange rejections, or the true intrabar path. Stop fills can be worse than the modelled costs in fast markets. Results must not be treated as a guarantee of executable prices.

Protective exits are optional and disabled unless configured. They are confined to historical simulation; they do not create broker orders or enable live execution.


## Walk-forward research integration

When the research pipeline selects the execution-aware fill model, the same optional stop/target configuration is passed to every out-of-sample fold. The mobile research console exposes stop-loss and take-profit percentages; either can be disabled independently. Research reports retain the complete protective-order configuration, and run comparison rejects different protective settings as non-comparable. Exit-reason counts are displayed with the candidate scorecard. These settings affect historical simulation only and do not create broker-side orders.