# Paper broker partial-fill lifecycle

The paper broker supports an explicit submit → candle execution → residual order lifecycle.

## API

- `submitPaperOrder(account, request)` validates risk and creates an open order. It does not create a fill, debit cash or mutate positions.
- `processPaperCandle(account, candle)` evaluates eligible orders for that symbol against the candle's opening price and base-asset volume. Orders are processed deterministically in submission order.
- `cancelPaperOrder(account, orderId)` cancels only the unfilled remainder. Historical fills, fees, cash movements and positions are preserved.

## Execution and accounting

- Per-candle aggregate participation is capped at `candle.volume × maxParticipationRate`; multiple orders for the same symbol share that capacity.
- Filled quantity is limited by remaining order quantity, available candle capacity, position-allocation headroom and available cash (for buys), or unreserved position quantity (for sells).
- Spread, baseline slippage and participation-scaled impact are applied by the shared execution model.
- Fees are charged only on filled notional.
- Partial buys update cash and fee-inclusive weighted-average entry price.
- Partial sells reduce position quantity and realize P&L only on the executed quantity. Remaining sell quantity stays reserved by the open order.
- Zero-volume candles do not fill orders.
- Open orders are part of the paper account snapshot and therefore persist through the existing IndexedDB account store.

## Compatibility

The legacy `executePaperMarketOrder` immediate-fill API remains available for existing callers. New code that needs realistic liquidity constraints must use the explicit lifecycle API. The existing UI is not switched to this API until it is wired to provide completed candle volume and order lifecycle controls.

## Limitations

This is a candle-volume proxy, not order-book replay. It does not model queue priority, latency, intrabar execution path, minimum lot/tick sizes, exchange rejections or guaranteed future liquidity. Orders are retried only when the caller supplies a later candle. This remains paper-only and is not live-execution authorization.
