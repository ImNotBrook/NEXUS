# Market Intelligence Snapshot v1

**Module:** `src/domain/market-intelligence.ts`  
**Engine version:** `market-intelligence-v1`  
**Status:** Deterministic research baseline

## Purpose

Produce one reproducible market-context snapshot across the initial 1D / 4H / 1H / 15M hierarchy. It describes observable conditions; it does not forecast price or produce a trade signal.

## Timeframe authority

| Frame | Role | Authority |
|---|---|---|
| 1D | Macro | Highest-level trend/volatility context |
| 4H | Primary | Main swing context; must be interpreted with 1D |
| 1H | Tactical | Setup development and challenge evidence |
| 15M | Micro | Entry refinement context only |

The 1H or 15M frame cannot overwrite the 1D/4H direction. Countertrend lower-timeframe conditions are retained as divergence and increase uncertainty. Opposing 1D and 4H baselines produce a transition state, not an averaged direction.

## Causality and data quality

Candle timestamps are bar-open times. A candle is eligible only when:

`candle.timestamp + intervalMs <= evaluationTime`

The current forming candle is excluded. Future candles, including malformed future OHLC, are filtered before validation and hashing so they cannot alter historical-prefix output. Eligible candles must pass the existing OHLCV validator.

Each timeframe is independently checked for provider, fetch time, quality status, freshness and sufficient indicator warm-up. Missing, stale, future, failed, degraded or insufficient frames remain unknown. The snapshot never forward-fills missing candles or invents prices.

Each frame is limited to 5,000 candles to bound mobile memory and hashing cost. The snapshot also preserves instrument category and candle-volume units; all timeframes in one snapshot share those units. The content hash includes the engine version, fixed configuration, instrument/volume units, timeframe provenance and eligible candle prefix. Snapshot IDs change when relevant source data, configuration or evaluation time changes.

## Dimensions

- **Trend:** trailing EMA fast/slow spread; strength is the absolute spread percentage.
- **Persistence:** fraction of the latest ten known regime labels matching the current label.
- **Volatility:** ATR as a percentage of close, classified using fixed low/high thresholds.
- **Volatility rank:** current ATR percentage's empirical rank within up to 100 trailing eligible observations.
- **Participation proxy:** latest 1H volume relative to the median of the previous 20 closed 1H bars.

The volume ratio is not order-book liquidity. Depth, spread, breadth and derivatives positioning remain explicitly unknown until their own validated sources are joined.

## Phase hypothesis

The phase label is a descriptive synthesis:

- `trend`: 1D and 4H directional trends agree.
- `range`: both higher-timeframe baselines classify range.
- `compression`: aligned higher-timeframe direction with low realised volatility on both.
- `stress`: high realised volatility on either higher timeframe.
- `transition`: higher-timeframe conflict/partial alignment or lower-timeframe divergence.
- `unknown`: insufficient higher-timeframe evidence.

Trend, volatility, alignment and divergence remain separately available; the phase label does not erase them. No confidence probability is emitted. Uncertainty is categorical and increases with missing or conflicting evidence.

## Fixed v1 limitations

- EMA/ATR thresholds are fixed inputs, not fitted to the current evaluation sample.
- No HMM, change-point model, Elliott Wave, SMC, order-book, breadth or derivatives positioning integration.
- No calibrated probability, predictive claim or strategy suitability score.
- One global indicator configuration is used across timeframes; future research may justify timeframe-specific fixed configurations.
- A volume ratio is only a participation proxy and must not be described as depth or liquidity.
- Snapshot construction is not yet wired into the live workspace decision flow; integration follows separately after unit and build verification.
