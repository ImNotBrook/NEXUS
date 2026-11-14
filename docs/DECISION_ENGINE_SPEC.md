# NEXUS Evidence & Decision Engine (EDE)

**Status:** Foundation contract — approved for implementation  
**Version:** 1.0.0  
**Decision vocabulary:** ENTER, WAIT, REJECT, NO_SETUP.

## 1. Purpose

EDE converts a time-bounded market snapshot and a candidate trade hypothesis into an auditable decision. It must explain why a setup is or is not eligible. It does not forecast a guaranteed next move and does not equate indicator count with evidence strength.

**Core principle:** NEXUS does not trade predictions. It evaluates qualified hypotheses supported by independent, measurable evidence and predefined risk.

## 2. Pipeline

1. **Snapshot:** obtain immutable Market Intelligence snapshot(s), each with provenance and data-quality status.
2. **Candidate:** define symbol, side, setup family, timeframe, trigger, expiry and proposed risk plan.
3. **Normalize:** validate evidence schema, freshness, causal availability, units, timeframe and source quality.
4. **Group:** map evidence into independent families and identify correlated/redundant observations.
5. **Evaluate:** measure support, contradiction, missing evidence and uncertainty separately.
6. **Challenge:** construct the bull case, bear case, alternative explanations and thesis invalidation.
7. **Economics:** compute executable entry assumptions, stop, targets, size, costs, exposure and expected payoff.
8. **Gate:** apply deterministic data-quality and risk eligibility rules.
9. **Decide:** return ENTER, WAIT, REJECT or NO_SETUP with machine-readable reasons.
10. **Journal:** persist the exact input snapshot IDs, evidence, plan, engine version and result before any downstream paper execution.

## 3. Evidence contract

Each evidence item includes:

- stable `evidenceId`;
- `family`: macro_regime, market_structure, liquidity_location, momentum_volume, derivatives_positioning, timeframe_alignment, trade_economics or external_context;
- `claim`: concise falsifiable statement;
- `polarity`: supports, contradicts, neutral or unknown;
- `strength`: ordinal/continuous measurement with declared scale and method;
- `quality`: source/data quality, freshness and completeness metadata;
- `symbol`, timeframe and scope;
- `availableAt` and source observation time;
- source/snapshot references and calculation version;
- optional correlation key and dependency references;
- invalidation condition or expiry where applicable.

Evidence is not valid merely because an agent produced it. Deterministic validation rejects malformed values, future-dated observations, unknown units, stale data beyond configured limits and missing provenance. Unknown is not neutral support.

## 4. Independent evidence groups

Initial groups:

| Group | Typical content | Anti-double-counting rule |
|---|---|---|
| Macro/regime | BTC context, broad risk regime, volatility | Multiple regime metrics may describe one underlying condition |
| Market structure | Confirmed swings, BOS/CHoCH, trend sequence | Same pivot/level cannot be counted repeatedly |
| Liquidity/location | Prior highs/lows, sweeps, FVG/zone location | Overlapping zones from one price event are dependent |
| Momentum/volume | RSI, MACD, ADX, VWAP, volume expansion | Correlated oscillators are not independent votes |
| Derivatives/positioning | Funding, OI, account ratio | Shared provider/source and same positioning event are dependent |
| Timeframe alignment | 1D/4H/1H/15M alignment | Derived from underlying evidence; do not double-count source facts |
| Trade economics | Net reward/risk, costs, liquidity and fill assumptions | Economics is a gate/quality dimension, not directional confirmation |

Evidence groups should be scored independently before aggregation. Correlation/dependency metadata reduces duplicated influence. A group with ten correlated indicators must not outweigh one independent high-quality contradiction simply by count.

## 5. Scores are not probabilities

The engine reports distinct fields:

- `supportScore`: strength of valid supporting evidence.
- `contradictionScore`: strength of valid opposing evidence.
- `coverageScore`: proportion/quality of expected evidence available.
- `uncertaintyScore`: unresolved ambiguity, disagreement and data limitations.
- `thesisScore`: calibrated aggregate only after a documented calibration process.
- `tradeQualityScore`: economics and execution feasibility, separate from thesis direction.
- `riskEligible`: deterministic pass/fail result from the risk gate.

Raw score scales and aggregation methods must be versioned and documented. Until calibrated on mature, out-of-sample observations, all scores are ranking/diagnostic measures only. Never label them win probability, confidence of profit or probability of direction.

No arbitrary default weights are to be treated as validated. Start with transparent group-level diagnostics and explicit rules; calibrate only after the Decision & Learning Loop has sufficient mature observations.

## 6. Thesis construction and challenge

Every candidate contains:

- thesis statement and direction;
- strongest supporting facts;
- strongest opposing facts;
- missing/unknown evidence;
- alternative explanations;
- structural and price invalidation;
- trigger condition and expiry;
- expected holding horizon;
- proposed entry, stop and target levels;
- assumptions and provenance.

Bull Advocate and Bear Advocate are independent challenge roles, not voting agents. The Decision Analyst reconciles arguments against the structured evidence. The deterministic engine owns final status and hard gates. AI narrative cannot override evidence validation or risk policy.

## 7. Decision semantics

### ENTER
All required data-quality, trigger, economic and risk gates pass. ENTER means eligible for a paper-trade attempt under the configured simulation, not a guaranteed fill.

### WAIT
A candidate exists, but one or more explicitly named confirmation conditions remain unmet, or the entry is not yet efficient. The candidate must include a causal trigger, expiry and proposed invalidation so the shadow engine can evaluate it without hindsight.

### REJECT
The candidate is invalid, the thesis is materially contradicted, economics are unacceptable, or a hard gate fails. Record a reason code and the original candidate plan where one existed.

### NO_SETUP
No qualifying candidate was generated at the evaluation time. This is a first-class observation, not missing data. A separate, causal opportunity-discovery process may later identify missed candidates; it must use rules available at that historical time and must not select perfect entries retrospectively.

## 8. Hard gates

Hard gates are not averaged into a score. Any required gate failure prevents ENTER:

- stale, incomplete, conflicting or invalid decision-critical data;
- trigger not confirmed;
- invalid/missing stop or sizing inputs;
- position/exposure/drawdown/loss limit breach;
- unacceptable net economics after fees, spread and slippage;
- unsupported instrument or timeframe;
- missing causal timestamp/provenance;
- strategy/version not approved for paper use.

A risk gate may block entries regardless of any AI recommendation or thesis score. No model may modify limits, disable a kill switch or grant execution permission.

## 9. Economics

For every plan, specify:

- entry type and reference price;
- stop and target levels;
- risk budget and size calculation;
- fees on entry and exit;
- spread and adverse slippage;
- funding/borrow costs where applicable;
- expected net reward/risk and payoff assumptions;
- exposure, concentration and portfolio constraints;
- expiry and maximum holding horizon.

A touch is not automatically a fill. Fill simulation assumptions are defined by the Shadow Outcome Engine specification. If net economics cannot be computed, the plan is ineligible rather than assigned a fabricated score.

## 10. Deterministic output

The decision record must include schema version, decision ID/time, snapshot IDs, candidate ID, decision status, reason codes, evidence IDs, group diagnostics, score versions, bull/bear cases, alternatives, invalidation, trade plan, gate results and engine/strategy/risk-policy versions.

Every decision, including WAIT, REJECT and NO_SETUP, is journalled. A missing AI provider must not disable deterministic protection or prevent recording a decision.

## 11. Validation

Test causal evidence rejection, stale data, missing provenance, correlated evidence, contradictions, incomplete coverage, score scale boundaries, hard-gate precedence, deterministic replay, stable IDs and all four decision statuses. Property tests must prove that evidence available after decision time cannot affect the decision.

No EDE output is a live-trading authorisation.
