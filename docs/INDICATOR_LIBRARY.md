# NEXUS Indicator Library

The indicator catalogue is a governed research reference for agents and researchers. It records each indicator's category, purpose, input requirements, market contexts, interpretation, limitations and redundancy group.

## Current implementation status

The calculation engine currently implements:

| Category | Indicator | Current use |
|---|---|---|
| Trend | SMA | Slow trend context and crossover baseline |
| Trend | EMA | Faster trend context and regime classification |
| Momentum | RSI | Momentum and range mean-reversion research |
| Momentum | MACD | Trend-momentum confirmation |
| Volatility | ATR | Realized range and volatility normalization |
| Volatility | Bollinger Bands | Rolling dispersion and price location |

The catalogue also documents ADX, Stochastic, CCI, ROC, OBV, VWAP, MFI, Donchian Channels, Keltner Channels, funding rate, open interest, long/short ratio, market breadth and Fear & Greed. These entries are marked `planned`; they are not available for computation and must not be represented as calculated features until implementation and tests are merged.

## Market-context selection

| Market condition | Primary research tools | Supporting context | Main caution |
|---|---|---|---|
| Directional uptrend/downtrend | EMA | MACD, ATR | Avoid fading persistent momentum using oscillator extremes |
| Range-bound | RSI | Bollinger Bands, ATR | A range can transition into a breakout; validate regime stability |
| High volatility | ATR | Bollinger Bands | ATR measures magnitude, not direction; reduce confidence in fragile signals |
| Low volatility/compression | Bollinger Bands | ATR | Compression does not predict breakout direction |
| Unknown/warming-up | SMA, ATR | None | Do not force a regime label before sufficient history |

These are hypotheses about tool suitability, not universal laws. Timeframe, asset liquidity, venue, data quality and strategy horizon change indicator behaviour. An indicator should be selected because it measures a specific hypothesis, not because it is popular.

## Agent selection protocol

1. Read the current market-regime label and its configuration before selecting indicators.
2. Check `implementation`. Only `implemented` entries may be used as numerical features.
3. Select the smallest set that answers distinct questions: trend direction, momentum, volatility, participation or positioning.
4. Check `redundancyGroup`; avoid stacking highly correlated indicators as if they were independent evidence.
5. State the indicator's purpose, expected behaviour, market context, failure mode and invalidation condition.
6. Preserve warm-up nulls. Never forward-fill or invent indicator values.
7. Calculate only from finalized, quality-passing observations available at the decision timestamp.
8. Do not tune periods or thresholds on the final holdout. Record every trial and evaluate walk-forward and untouched out-of-sample performance.
9. Include fees, spread, slippage, market impact, funding/borrow where relevant and position sizing in strategy evaluation.
10. Indicators describe market data; they do not override risk controls, AI governance or human approval.

## Interpretation and risk notes

- No indicator predicts price with certainty or constitutes an entry/exit instruction by itself.
- RSI overbought/oversold levels are regime-dependent; strong trends can remain extreme.
- Moving averages and MACD are lagging and share substantial information.
- ATR is non-directional and raw ATR is not comparable across differently priced assets.
- Bollinger Band touches are not automatic reversals.
- Volume indicators depend on the provider's volume definition and venue coverage.
- Derivatives metrics must preserve venue, contract type, settlement interval and units.
- Market breadth must use point-in-time universe membership to avoid survivorship bias.
- Sentiment indexes are contextual and can duplicate price/volatility information already in the feature set.

## Programmatic interface

`src/domain/indicator-catalogue.ts` exports:

- `INDICATOR_CATALOGUE`: complete metadata catalogue.
- `getIndicatorById(id)`: lookup by stable identifier.
- `getImplementedIndicators()`: only indicators with calculations in the current codebase.
- `recommendIndicators({ trend, volatility })`: context-aware recommendations restricted to implemented calculations.

The recommendation function is deterministic and advisory. It never generates trading signals, modifies configuration or grants execution permission.
