# Shadow Outcomes & Learning Operations

**Status:** Stage 3 operational integration  
**Mode:** Hypothetical research only  
**Simulation:** `spot-shadow-v1`  
**Market history:** Public Binance spot 1H candles

## Flow

1. A candidate decision is appended to the immutable Decision Journal.
2. In the same workbench scan, NEXUS derives a shadow plan only from the stored candidate's exact entry reference, stop, target and quantity.
3. The plan is appended as a `shadow_plan_registered` event timestamped at the original decision time. The content-addressed event is immutable and idempotent.
4. The operator opens **Shadow outcomes** and manually requests evaluation.
5. NEXUS fetches closed hourly candles beginning at the first full hourly bar after the decision. The request is bounded by the declared outcome horizon and the current time.
6. The historical audit checks OHLCV validity, timestamp alignment, the first expected candle and hourly continuity.
7. The simulator evaluates only candles strictly after the decision and no later than the final in-horizon millisecond. It applies the frozen fees, spread, slippage, market impact, volume participation, gap and same-bar assumptions.
8. The first completed candle opening at or after the horizon boundary proves maturity by timestamp only. Its OHLCV is not included in the outcome path.
9. NEXUS appends a content-addressed `outcome_appended` event. Later observations are separate events; the original decision and plan are never overwritten.
10. The learning engine selects only mature, data-quality-passed, fully resolved observations and reports descriptive cohorts by symbol, timeframe, original decision status, setup family and simulation version.

## Current v1 plan rules

- Spot BTC/USDT long candidates only.
- Candidate must have a confirmed, pre-decision trigger and a valid single-target plan.
- Entry is a market fill at the first eligible post-decision hourly candle open, with adverse execution costs.
- The plan expires at the original candidate expiry.
- Default outcome horizon is 24 hours from decision time, rounded to the next hourly boundary. The horizon-proof candle is excluded from price evaluation.
- Execution assumptions: 0.10% fee, 10 bps base slippage, zero explicit half-spread, 5% maximum candle participation and 5 bps impact at maximum participation.
- Same-bar stop/target collision uses adverse stop-first ordering.
- Spot shorts, derivatives, untriggered WAIT candidates without a predeclared limit trigger, NO_SETUP and decisions lacking a plan registered at decision time are not simulated.

## Quality and maturity

- A history must begin at the exact first eligible candle and remain contiguous at one-hour intervals to pass the local historical coverage audit.
- Invalid OHLCV cannot be simulated and is reported as a collection failure.
- Missing candles fail the data-quality gate. Zero-volume bars degrade it.
- A valid but incomplete history can produce a pending/open outcome snapshot, but it is not eligible for mature learning.
- Ambiguous, open, pending, early, superseded or data-degraded observations are excluded from cohort metrics.
- Mature no-fill expiry and pre-fill gap invalidation count as no-fill candidates, not zero-R trades.
- NO_SETUP is intentionally excluded. A separate causal, versioned discovery detector is required before missed-opportunity analytics can be valid.

## Causal NO_SETUP diagnostics (Stage 4 v1)

- A new workbench scan registers a replay specification only when the immutable decision is `NO_SETUP` for `DONCHIAN_TRIGGER_ABSENT`, on BTCUSDT 1H, with a valid frozen lookback window.
- The event is timestamped at the original decision time and stores the exact initial Donchian window, strategy ID/version, lookback, expiry bars and sizing/risk parameters. Older decisions without this event are never reconstructed retrospectively.
- Manual evaluation fetches public Binance 1H history and considers only candles whose full close time is at or before the evaluation timestamp. Gaps in the replay window fail closed.
- The detector tests the first `expiryBars` closed candles only and records the first close above the then-known rolling Donchian high. It never searches later candles for a better entry.
- A `missed_opportunity_detected` event is a **Donchian-only diagnostic**. It does not prove that higher-timeframe filters, risk/economics gates or execution conditions would have passed. It is not a simulated fill, does not create a shadow trade plan and is excluded from shadow P&L/learning cohorts.
- The diagnostic currently covers BTCUSDT spot-long only. Other NO_SETUP reasons, symbols, timeframes and strategies are explicitly out of scope.

## Metrics

The current learning report exposes matured candidate count, completed trade count, no-fill count, mean and median net R, win rate, mean MFE and mean MAE. Net R uses realised net P&L divided by gross entry-to-stop price risk on the filled quantity. It is not an account-level return.

These are descriptive sample statistics. They do not establish profitability, predictive accuracy or causality. Small samples must not be treated as evidence of edge. No automatic strategy tuning or promotion is enabled.

## Storage and limitations

All plans and outcomes are append-only IndexedDB events on the current browser/device. Export the Decision Journal regularly. Clearing browser data can erase the local ledger.

Historical collection currently uses one public source (Binance). A continuous series audit does not establish exchange-execution accuracy, order-book depth, queue priority, latency or real fill certainty. The simulator does not mutate the paper account and has no exchange-order adapter.


### Replay completion semantics (follow-up)

- A replay with fewer than the frozen `expiryBars` closed hourly candles is reported as pending. It is not labelled a completed no-trigger result and no terminal event is appended.
- A replay that observes all `expiryBars` closed candles without a breakout appends one immutable `no_setup_replay_completed` event with detector version, evaluation timestamp, observed bar count and explicit Donchian-only scope.
- Subsequent manual runs recognise the terminal completion event and do not fetch or append the same replay again. A detected first breakout remains represented by `missed_opportunity_detected` and takes precedence.
- This terminal event means only that the Donchian-only detector found no breakout in its frozen window; it does not prove that the full strategy was invalid or unprofitable.
