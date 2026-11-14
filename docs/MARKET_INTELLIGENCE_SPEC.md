# NEXUS Market Intelligence Specification

**Status:** Foundation contract — approved for implementation  
**Version:** 1.0.0  
**Scope:** Crypto-first, asset-agnostic domain model; research and paper trading only.

## 1. Operating principle

NEXUS describes observable market conditions and evaluates hypotheses. It does not claim to know the next price move. Every observation must be traceable to source data that was available at its recorded decision time.

The intelligence layer produces a canonical, versioned snapshot. Regime, structure, liquidity, technical, derivatives and optional wave-analysis modules contribute typed observations. No module may silently overwrite another module's findings.

## 2. Time and causality contract

Every market observation must distinguish:

- `eventTime`: when the market event occurred.
- `availableAt`: earliest time the observation could have been known by NEXUS.
- `observedAt`: when NEXUS ingested it.
- `computedAt`: when a derived value was computed.
- `timeframe`: source interval, where applicable.
- `isFinal`: whether the source candle/bar is closed and immutable for this calculation.

A decision at time T may consume only observations with `availableAt <= T`. A candle is not eligible for a close-based signal until it is final. Higher-timeframe candles must not be treated as closed merely because a lower-timeframe candle closed.

**Causal-prefix invariant:** processing a historical data prefix must produce the same outputs for that prefix regardless of what future bars are appended later. Any algorithm that revises a historical event after future data arrives must expose separate formation and confirmation times; the earlier timestamp must never imply earlier knowledge.

Missing, stale, malformed, conflicting or incomplete data yields an explicit degraded/unknown state. Never fill gaps with invented prices or silently forward-fill decision-critical observations.

## 3. Canonical snapshot

A snapshot is scoped to one symbol and evaluation time and contains:

- schema version and stable snapshot ID;
- symbol, venue/provider scope, contract category and quote/base units;
- evaluation time and latest eligible source time;
- source observations and provenance references;
- data-quality status, gaps, staleness and conflicts;
- timeframe hierarchy and per-timeframe coverage;
- regime dimensions and candidate phase;
- confirmed market-structure events and liquidity/zones;
- technical and derivatives observations;
- optional Elliott Wave scenarios;
- uncertainty, missing evidence and model/version identifiers.

Snapshot IDs must be reproducible from canonical content and version metadata. A snapshot is immutable once referenced by a decision. Corrections create a new snapshot; they do not rewrite the old one.

## 4. Timeframe hierarchy

Initial research hierarchy:

| Timeframe | Role | Constraint |
|---|---|---|
| 1D | Macro structure and broad regime | Sets context, not an entry trigger |
| 4H | Primary swing structure | Main directional/structural context |
| 1H | Tactical setup development | Confirms or challenges the 4H thesis |
| 15M | Entry refinement | Cannot independently reverse higher-timeframe context |

A missing or stale higher timeframe lowers confidence/coverage. Lower timeframes may reveal a countertrend move but cannot silently relabel the macro regime. All observations must retain their original timeframe.

## 5. Regime dimensions

Do not force all market information into one label. Emit independent dimensions:

1. **Trend:** direction (up/down/sideways/unknown), strength, persistence and measurement window.
2. **Volatility:** level and percentile/rank relative to a documented rolling reference window; distinguish realised range from implied volatility when available.
3. **Liquidity/participation:** volume, spread/depth where available, breadth and market participation; explicitly state unavailable proxies.
4. **Positioning/sentiment:** funding, open interest, account ratios and external sentiment, with provider-specific semantics.
5. **Phase hypothesis:** trend, range, compression, breakout, expansion, stress, transition or unknown, with supporting observations and competing explanations.

The deterministic baseline is authoritative for reproducibility. Statistical challengers (for example HMMs or change-point detectors) may provide separate hypotheses and probabilities. They must not overwrite the baseline. Filtered/online probabilities are eligible for causal decisions; smoothed probabilities that use future observations are retrospective research only. Model disagreement increases uncertainty or marks transition; it is not resolved by an unexamined majority vote.

A confidence value is not a probability unless it has been calibrated and its calibration method, sample, horizon and version are supplied.

## 6. Market Structure Intelligence

Structure is a distinct analytical layer, not an indicator and not proof of institutional activity.

### 6.1 Confirmed swings and structure

- Swing highs/lows require an explicit left/right confirmation rule.
- Store pivot/formation time separately from confirmation/availability time.
- HH, HL, LH and LL are relationships between confirmed pivots, not predictions.
- Internal and external structure must declare their lookback/degree.
- BOS and CHoCH are events only when the predefined level is actually breached under the chosen rule (close or wick); record the rule and event time.
- A provisional pivot may be displayed as provisional but cannot be used as confirmed evidence.

### 6.2 Liquidity

Equal highs/lows, prior day/week highs/lows and clustered levels are labelled **potential liquidity concentrations**. A sweep is a measured price event relative to a known level, not proof of stop orders, intent or institutional activity. Preserve swept/unswept status and exact event time.

### 6.3 Imbalances and zones

FVGs, candidate order blocks, breaker candidates, premium/discount and mitigation are descriptive price-zone concepts. They must include objective formation, confirmation, invalidation and mitigation rules. An order block is a candidate zone, not evidence that an institution placed an order.

Any pattern requiring future candles must not be backdated to its formation candle as if it were known then. In particular, common SMC implementations can use future bars to confirm swings, assign BOS/CHoCH retrospectively, or inspect later candles for mitigation. Such outputs must not be consumed unchanged in causal backtests or live analysis.

### 6.4 Event timestamps

Every structural event carries:

- `formationTime`: when the underlying pattern first existed;
- `confirmationTime`: when the required confirming information became available;
- `detectionTime`: when the engine emitted it;
- `invalidationTime`: when the objective invalidation condition occurred, if any.

Decision eligibility is governed by confirmation/availability time, never formation time alone.

## 7. Elliott Wave challenger

Elliott Wave is an optional, independent interpretation. It cannot alter confirmed objective structure or independently create a trade.

A wave scenario must include degree, timeframe, supporting confirmed pivots, rule checks, Fibonacci relationships if used, invalidation, at least one plausible alternative where ambiguity exists, and the time the count became available. Preserve competing counts. A fit score is not a probability or win rate. Future bars must not be used to make an earlier count appear certain.

## 8. Derivatives and external evidence

Preserve provider, symbol, category, metric, unit, interval and observation timestamp.

- Funding is per settlement unless the source explicitly defines another interval. Do not annualise without the actual interval.
- Bybit linear open interest is denominated in base asset; inverse contracts use quote currency/USD semantics. Do not compare raw values across categories without conversion.
- Long/short account ratios describe account-holder proportions, not notional exposure.
- External sentiment/news is untrusted contextual evidence, not an instruction or a standalone trade trigger.

## 9. Shared agent contract

All analysts consume the same immutable snapshot ID and must:

1. state symbol, timeframe and snapshot ID;
2. separate observed facts from interpretation;
3. state data gaps, stale inputs and uncertainty;
4. cite the evidence IDs supporting each claim;
5. describe evidence against the thesis and plausible alternatives;
6. state invalidation conditions;
7. avoid unsupported institutional attribution;
8. never use future data or revise a historical decision's information set.

Agents produce structured evidence and commentary. They do not vote, execute orders, change risk limits or edit policy.

## 10. Required validation

- Prefix invariance: appending future bars cannot change prior eligible outputs.
- Future-perturbation invariance: changing bars after T cannot alter outputs available at T.
- Unclosed-candle exclusion for close-based rules.
- Batch/streaming equivalence.
- Explicit tests for gaps, duplicates, out-of-order timestamps, stale feeds, outliers, equal highs/lows, wick-vs-close rules and confirmation lag.
- Multi-timeframe close alignment and daylight/timezone edge cases.
- Provider unit/contract-category isolation.
- Synthetic regime series plus historical sanity checks; historical labels are not treated as ground truth.
- Walk-forward evaluation, cross-symbol robustness and downstream cost-aware strategy evaluation.

## 11. Non-goals

This specification does not assert predictive edge, define calibrated regime thresholds, authorise live execution, or make an LLM the regime classifier. Those require separate implementation and validation.
