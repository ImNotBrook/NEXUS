# Execution cost model

The pure `resolveMarketFill` domain function estimates a single market-order fill against one completed OHLCV candle. It is the first increment of a more realistic execution model; it is not yet wired into the historical backtester or paper broker.

## Inputs

- Order side, requested quantity and reference price.
- Completed candle base-asset volume.
- Fee rate, baseline adverse slippage, half-spread estimate, maximum volume participation and impact at that participation cap.

## Fill rules

1. Maximum fill quantity is `candleVolume × maxParticipationRate`.
2. Filled quantity is the lesser of requested quantity and that capacity.
3. Remaining quantity is reported explicitly. The caller must decide whether to carry, cancel or reprice it; this function does not silently fill it on a later candle.
4. Market impact is linear in observed participation relative to the configured maximum participation rate.
5. Total adverse price adjustment is baseline slippage + half-spread + estimated market impact.
6. Buys pay above the reference price; sells receive below it.
7. Fees are charged only on the actually filled notional. Unfilled orders incur no fee.
8. Zero-volume candles produce an unfilled result and no execution cost.

## Important limitations

- Candle volume is a coarse historical proxy, not executable order-book depth. The model cannot establish whether the displayed volume was available at the required price or at the time the order arrived.
- Spread, baseline slippage and impact are explicit assumptions until calibrated against reliable venue data.
- Linear impact is a deliberately simple conservative placeholder, not a universal market-impact law. It should be validated by symbol, venue, timeframe and participation bucket.
- The function models one candle and one fill decision. It does not implement order persistence, queue priority, latency, intrabar sequencing, minimum order sizes, tick/lot rounding, exchange rejects or partial-fill continuation.
- This model must not be presented as live execution quality or used to authorize real orders.

The existing backtester and paper broker continue to use their previous execution assumptions until a separately tested integration handles partial entries/exits, residual orders, average fill prices and portfolio accounting.
