---
name: nexus-strategy-engineering
description: Convert validated trading hypotheses into deterministic, causal, testable strategy specifications and implementations.
---

# NEXUS Strategy Engineering

## Strategy specification

Before implementation, write a versioned specification containing:
- market, venue, asset universe and timeframe;
- entry and exit conditions in exact boolean terms;
- indicator formulas, periods, seeds and warm-up requirements;
- signal evaluation time and earliest permitted fill time;
- position sizing and exposure constraints;
- fees, spread, slippage and order assumptions;
- invalidation, no-trade and missing-data behavior;
- benchmark and evaluation protocol.

## Causality rules

- A signal evaluated at candle close cannot fill at that same close unless the data model explicitly proves the order was executable before the close.
- Default simulation: close signal, next candle open fill, with adverse costs.
- Shift rolling extrema and breakout levels so the current bar cannot contaminate its own prior threshold.
- Never use centered rolling windows, negative shifts, future labels or full-sample normalisation.
- Fit scalers, feature selectors and model parameters on training data only.
- Warm-up bars may provide historical context but must not create test-period trades or appear in OOS metrics.

## Implementation rules

- Separate pure strategy logic from data providers, UI and broker adapters.
- Use deterministic inputs and outputs. Seed stochastic experiments and record the seed.
- Validate indicator warm-up and edge cases: flat prices, gaps, zero volume, missing candles and extreme values.
- Keep strategy parameters explicit and versioned. Never mutate an active strategy in place.
- Reject invalid or stale market data rather than inventing values.

## Delivery requirements

Provide the formal strategy spec, source changes, unit tests, baseline comparison, realistic-cost backtest and out-of-sample report. State what is not modelled. No strategy is eligible for paper automation solely because it has a positive in-sample return.
