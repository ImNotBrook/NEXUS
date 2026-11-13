# Paper Trading

## Scope

The first paper broker is BTC/USDT spot only. It is a local simulation, not a connection to an exchange account. It does not submit, sign, queue, or route real orders. There is no leverage, borrowing, short selling, or margin.

The dashboard starts with a simulated balance of 10,000 USDT. The account is persisted in the browser's IndexedDB database on the device. Clearing site data or browser storage can erase it; it is not a cloud backup and does not synchronize between devices.

## Execution model

- Market orders fill immediately at the supplied latest completed-candle close used by the dashboard.
- Buys receive adverse slippage above the reference price; sells receive adverse slippage below it.
- Fees are charged on both sides.
- Default simulated fee: 0.10% per fill.
- Default adverse slippage: 0.10% per fill.
- Default maximum notional exposure per symbol: 25% of current account equity.
- Default daily loss limit: 3% of start-of-UTC-day equity. When breached, new buys are blocked. Sells remain available to reduce risk.
- Position cost basis includes entry fees. Realised P&L deducts the allocated entry cost and exit fee.
- Only BTCUSDT can be traded from the current dashboard. The domain broker accepts exchange-style symbols for future extension.
- The dashboard disables new orders while refreshing or after the market snapshot is more than five minutes old.

These are simulation assumptions, not estimates of actual execution quality. The close is not a live bid/ask quote; the simulation does not yet model spread, depth, latency, partial fills, queue priority, market impact, exchange outages, or rejected exchange orders.

## Persistence and failure behavior

PaperAccountStore writes account snapshots through IndexedDB read/write transactions. The UI updates in-memory state only after the persistence transaction succeeds. If local storage is unavailable or a transaction fails, the order is not shown as filled. Browser storage can still be cleared or evicted by the operating system.

## Risk boundaries

- Backtests and paper accounts are separate state machines.
- Paper fills cannot create exchange orders.
- Qualification status does not unlock live execution.
- No exchange credentials are stored or requested.
- No live execution adapter is implemented.

A profitable paper result is not evidence of live profitability. Any future live-trading capability would require a separately reviewed execution service, independent risk controls, explicit user approval, and realistic out-of-sample validation.
