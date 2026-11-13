---
name: nexus-market-data
description: Validate, reconcile and maintain multi-provider OHLCV data for reproducible trading research.
---

# NEXUS Market Data

## Provider ingestion

- Keep provider-specific HTTP, symbols, intervals, pagination and response parsing inside adapters.
- Normalize to millisecond OHLCV candles and validate every external payload.
- Record provider, market, interval, retrieval time and stale status.
- Exclude unclosed candles from indicators, backtests and signals.
- Treat rate limits, API errors, malformed rows and unsupported pairs as explicit failures.

## Quality controls

- Strictly increasing timestamps; no duplicate or reordered bars.
- UTC interval alignment and expected continuity.
- Valid OHLC relationships and finite, non-negative volume.
- Detect future/stale snapshots and incomplete or stale final candles.
- Zero volume is a warning unless instrument-specific semantics prove it invalid.
- Compare independent feeds only on identical timestamps and matching instruments. Never average venue prices into a synthetic execution price.

## Historical data

- Paginate sequentially with bounded page sizes, candle budgets and resumable cursors.
- Do not retry indefinitely on HTTP 429 or provider outages.
- Keep each provider series separate. Preserve raw provenance and do not silently fill gaps.
- Record data retention, licensing, rate limits and timezone assumptions.

## Fail-closed behavior

If the data is stale, misaligned, discontinuous, untrusted or insufficient for the requested calculation, block the dependent strategy action and report the reason. Never substitute a guessed price.
