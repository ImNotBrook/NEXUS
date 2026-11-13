# Protective order simulation model

The NEXUS long-only spot backtester optionally accepts `protectiveOrders` with a stop-loss percentage, take-profit percentage, or both. Percentages are measured from the simulated entry fill price.

## Execution semantics

1. Strategy-generated market exits retain priority and fill at the next candle open with adverse slippage.
2. Protective orders become active on the candle after entry. The entry candle's high/low is not inspected because OHLC data cannot establish whether the protective level traded before or after the opening entry.
3. A stop-market gap through the stop fills at the candle open, then applies adverse sell slippage and the exit fee.
4. An intrabar stop trigger fills at the stop level, then applies adverse sell slippage and the exit fee.
5. A take-profit is modelled as a sell limit. An intrabar touch fills at the target; a gap above the target receives the opening price. No adverse slippage is applied to a limit fill, but the exit fee is charged.
6. If both stop and target are touched intrabar and the open has not already crossed either level, the stop is assumed to have happened first. This is deliberately conservative because OHLC candles do not reveal intrabar path.
7. All exits are recorded with `exitReason`; realized P&L includes entry and exit fees.

## Limitations

This is a bar-based approximation, not exchange matching-engine simulation. It does not model bid/ask spread, queue priority, partial fills, latency, market impact, liquidity constraints, or exchange-specific stop/limit trigger rules. Stop fills can be worse than the modelled slippage under fast markets. Results must not be treated as a guarantee of executable prices.

Protective exits are optional and disabled unless configured. The feature is confined to historical simulation; it does not create broker orders or enable live execution.
