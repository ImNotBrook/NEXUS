# Market data architecture

## Provider-neutral contract

The domain service consumes `MarketDataProvider` implementations and returns a `MarketSnapshot` containing the normalized market, interval, source, fetch time, stale flag and validated OHLCV candles. Indicators and strategies should depend on this contract, not a provider SDK or response schema.

## Independent public sources

- **Binance public spot klines:** primary BTC/USDT hourly feed. It filters the currently open candle using the provider close time.
- **Kraken public OHLC:** independent fallback for BTC/USDT hourly data. Kraken's final row is excluded because its API identifies that row as the current, uncommitted interval. The first implementation deliberately supports only BTC/USD and BTC/USDT at 1h; unsupported pairs and intervals fail closed.

Both adapters use public endpoints and require no API key. A provider response is validated by the shared OHLCV validator. Malformed or non-monotonic data is rejected and causes the resolver to try the next provider.

## Historical backfill

- Binance history pagination is sequential and bounded: at most 1,000 rows per request, 10,000 candles by default and 100,000 maximum per call.
- The cursor advances from the last completed candle's open timestamp plus the fixed interval duration. A non-advancing page is rejected to prevent duplicate loops.
- Fixed minute/hour/day/week intervals are supported. Calendar-month intervals are excluded because their duration is variable.
- HTTP errors, including rate-limit responses, fail the backfill; there is no automatic retry loop. Callers should resume from the last persisted candle after a transient failure rather than repeat the entire range.
- Historical candles are persisted locally in a separate IndexedDB object store, partitioned by symbol, interval and provider. Batch writes upsert by timestamp; reads can be restricted to inclusive time bounds.
- Historical candle storage is separate from the latest-snapshot cache and paper account ledger.

## Resolution and fallback policy

1. Try providers in declared priority order.
2. Validate the first successful response and cache it locally.
3. If every provider fails, load the matching symbol/interval cache entry.
4. Cached data is accepted only when its fetch time is not in the future and it is no older than 24 hours.
5. Cache fallback is explicitly marked stale. The dashboard displays the source and stale state; paper orders are disabled whenever the snapshot is stale.
6. A configurable minimum candle count is enforced during provider resolution. A short response is treated as provider failure and the next source is tried.
7. If no valid fresh provider response or eligible cache entry exists, return an error. There is no silent synthetic price or empty-series substitution.

A local cache write failure does not invalidate a fresh provider response. Cache read failure does not create data; the market request fails visibly.

## Local persistence

Market snapshots share the versioned `nexus-local` IndexedDB database with paper accounts. Schema version 3 creates `paperAccounts`, `marketSnapshots` and `historicalCandles` under one shared upgrade routine. The history store has a `series` index for provider-specific lookups. Cache keys are symbol plus interval, so BTC/USD hourly data cannot overwrite BTC/USDT or another timeframe.

The cache is device-local, not a cloud backup. Browser data clearing or eviction can remove it. Paper-account and market-snapshot adapters use one shared schema owner and database version, which creates both object stores in the same upgrade transaction and closes old connections on version changes.

## Data-quality and research limits

- OHLCV timestamps are milliseconds in the domain model.
- Candles must be strictly increasing and each open timestamp must align to the UTC interval boundary; the system does not sort, shift or repair bad provider data.
- No currently open candle is passed to indicators or backtests.
- Provider timestamps and candle close timestamps are distinct: `fetchedAt` records when NEXUS retrieved the snapshot; each candle timestamp identifies its open time.
- Cross-provider prices are not blindly merged. Different venues have different liquidity, volume conventions, pair availability and market microstructure.
- The quality gate checks candle ordering/OHLC validity, exact interval continuity, snapshot fetch-time validity and age, and the latest candle close boundary. An unclosed last candle fails; a last completed candle older than one full interval plus the freshness grace fails. Missing intervals fail; zero-volume candles warn but are not silently discarded.
- Binance and Kraken hourly closes are compared only at identical candle timestamps, and both feeds must contain the same latest candle timestamp. Older overlap alone is insufficient. The dashboard flags deviations above 50 bps; it does not average or substitute prices.
- Paper orders require a fresh quality-passing snapshot and a successful within-tolerance cross-provider comparison. A missing second feed, insufficient overlap or discrepancy blocks paper orders.
- The dashboard still uses hourly snapshots and manual refresh. It is not a tick feed or a trading-grade execution quote.

## Indicator conventions

- SMA: trailing arithmetic mean.
- EMA: first period-sized SMA is the seed; alpha = 2 / (period + 1).
- RSI: Wilder smoothing; initial average gain/loss over period changes; flat series returns 50.
- ATR: Wilder smoothing; first true range is high minus low.
- MACD: EMA(fast) minus EMA(slow); signal is EMA of the valid MACD line.
- Bollinger Bands: trailing SMA plus/minus the configured number of population standard deviations.
- WMA: trailing weighted mean with linearly increasing weights toward the newest close.
- ROC: percentage change from the close one configured period earlier.
- Stochastic: close location within the trailing high/low range; %D is an SMA of %K. A flat range returns 50.
- CCI: typical-price deviation from its trailing mean, scaled by mean absolute deviation and 0.015; zero deviation returns 0.
- ADX: Wilder-smoothed directional movement; +DI/-DI describe directional components and ADX describes strength without direction. ADX first becomes valid after 2 × period − 1 bars.
- OBV: cumulative volume signed by close-to-close direction; the initial value is anchored at zero.
- VWAP: cumulative typical-price volume weighting over the supplied input window; this window defines the anchor.
- MFI: rolling positive/negative typical-price volume flow; zero-flow windows return 50.
- Donchian Channels: highest high and lowest low over the prior period candles, explicitly excluding the current candle.
- Keltner Channels: EMA centre with upper/lower bands offset by a multiple of Wilder ATR.

All series preserve input length and use null during warm-up. Values are deterministic and do not inspect future observations.


## Public derivatives observations

The Bybit adapter adds separate, provider-stamped observations for:
- Funding rate history: settlement rate and settlement timestamp.
- Open interest: timestamped size, preserving the unit convention. Bybit documents linear open interest in base-asset units and inverse open interest in quote-currency units.
- Long/short account ratio: buy-side and sell-side account shares. These are account-holder proportions, not notional position sizes.

The adapter uses public V5 endpoints and requires no API key:
- `/v5/market/funding/history` (maximum 200 records per request).
- `/v5/market/open-interest` (maximum 200 records per request; supports a cursor).
- `/v5/market/account-ratio` (maximum 500 records per request; supports a cursor).

Funding history requires `startTime` and `endTime` together if either is supplied. Each endpoint has its own interval and instrument semantics. The adapter sorts observations chronologically, rejects duplicate timestamps and malformed values, and surfaces HTTP/API errors. It does not retry indefinitely or silently synthesize missing observations.

The provider-neutral observation model records each metric separately, validates its units and semantics, and supports chronological merge/deduplication with a retention cutoff. Device-local IndexedDB schema version 9 adds a dedicated derivatives observation store with provider/instrument/category/metric series isolation and ingestion timestamps. It is separate from the OHLCV candle store and paper-trading ledger. The Bybit adapter still returns one bounded page per request; scheduled collection and durable cross-device history are separate follow-up work. Browser storage is device-local and can be cleared or evicted. Funding rates must be interpreted per instrument's actual settlement interval. Open-interest values from different contract categories must never be compared without unit conversion. Account ratios describe the exchange's account population, not market-wide capital or notional exposure.

Official references:
- [Bybit funding history](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate)
- [Bybit open interest](https://bybit-exchange.github.io/docs/v5/market/open-interest)
- [Bybit long/short account ratio](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio)


## Scheduled derivatives collection

The scheduled workflow `.github/workflows/derivatives-data.yml` uses public Bybit V5 endpoints without an API key. After this workflow is merged, it runs daily at 02:17 UTC and can also be started manually from GitHub Actions.

Initial coverage:
- BTCUSDT, ETHUSDT and SOLUSDT linear perpetuals.
- Funding history: latest bounded page (up to 200 observations).
- Open interest: 1-hour observations (up to 200 per request).
- Long/short account ratio: 1-hour account-share observations (up to 200 per request).

The collector stores JSON histories in the separate `nexus-market-ledger` branch, preserving the observation timestamp and ingestion timestamp. Current files are trimmed to a rolling 365-day window and duplicate timestamps are upserted within the same provider/symbol/category/metric series. A collection report records per-series success or failure. A partial outage does not overwrite the failed series with empty data; a run with zero successful series fails visibly.

Collection is deliberately bounded to one page per metric and symbol. A 200-row hourly page covers about eight days; if collection is unavailable longer than that, missing history is not fabricated and must be detected by the downstream quality checks. Funding rates are stored per settlement and are not annualized because settlement intervals can differ by instrument. The public ledger branch contains market observations only, not user or exchange-account data.

The ledger branch is separate from the PWA's device-local IndexedDB. The current scheduled collector does not yet feed the paper-trading worker or create trading signals. The rolling JSON retention does not rewrite Git history, so historical commits remain in the repository's Git object history.
