---
name: nexus-indicator-selection
description: Select, interpret and combine NEXUS technical and market indicators according to market regime, data quality and research purpose.
---

# NEXUS Indicator Selection

## Required references

Before selecting features, read:
- `docs/INDICATOR_LIBRARY.md`
- `src/domain/indicator-catalogue.ts`
- `docs/MARKET_REGIMES.md`
- `docs/MARKET_DATA.md`
- `docs/AI_GOVERNANCE.md`

## Workflow

1. Establish instrument, venue, timeframe, strategy horizon and finalized observation timestamp.
2. Confirm market-data quality and identify the trend and volatility regime. If either is unknown, state that limitation.
3. Consult the canonical indicator catalogue. Never invent an indicator's implementation status, formula or input availability.
4. Use only `implemented` indicators as computed features. Planned catalogue entries may be discussed as research opportunities but must not be fabricated or simulated.
5. State the purpose of each selected indicator and why it is suitable for the current regime.
6. Prefer a compact set of non-redundant features. Indicators sharing a redundancy group are not independent confirmations.
7. Explain interpretation, failure modes, warm-up requirements, parameter assumptions and invalidation conditions.
8. Use only completed candles and data known at the decision time. Preserve null warm-up values; never fill missing observations with guesses.
9. Treat volume, funding, open interest, breadth and sentiment as provider-specific data with provenance and units.
10. Propose new indicators only with a falsifiable hypothesis, a baseline comparison and a defined out-of-sample test.

## Regime guidance

- Directional trend: EMA for direction; MACD may provide supporting momentum context; ATR describes realized range. Avoid blindly fading RSI extremes.
- Range: RSI and Bollinger Bands can frame stretch and dispersion; ATR helps detect range expansion. Do not assume a range will persist.
- High volatility: ATR is primary for range magnitude; Bollinger Bands add dispersion context. High volatility is not a directional signal.
- Low volatility: Bollinger Band width and ATR can describe compression. Compression does not predict breakout direction.
- Unknown/warm-up: use descriptive baselines only and do not force a regime classification.

## Prohibited practices

- Do not present an indicator as a guaranteed predictor or standalone trading instruction.
- Do not claim planned indicators are implemented.
- Do not stack correlated indicators and count each as independent evidence.
- Do not optimize periods on the final holdout or select indicators after inspecting holdout results.
- Do not use future, incomplete, stale, malformed or survivorship-biased data without explicit treatment.
- Do not modify risk limits, kill switches, strategy permissions or execution settings.
- Never let model output override deterministic validation or NEXUS AI governance.
