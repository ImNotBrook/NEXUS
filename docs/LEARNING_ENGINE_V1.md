# Learning & Validation Engine v1

**Module:** `src/domain/learning-engine.ts`  
**Status:** Research-only descriptive evaluator  
**Version:** `learning-cohorts-v1`

## Purpose

Turn immutable decision records and journalled shadow outcomes into descriptive, maturity-gated cohorts. This module does not train a model, tune parameters, change evidence weights, or approve strategy changes.

## Eligibility gates

An observation is included only when all conditions hold:

1. The decision record and shadow plan pass their domain validators.
2. The plan, candidate and outcome refer to the same decision, candidate, symbol, timeframe and simulation version.
3. The plan's entry, stop, target, quantity and expiry match the original decision candidate.
4. The upstream market-data quality audit reports `pass`.
5. The predeclared horizon is reached, the horizon-proof timestamp is present, and the event was recorded no earlier than the horizon or observed-through timestamp.
6. The path is resolved. `open`, `pending` and `ambiguous` outcomes are excluded.
7. A completed trade has fully matched entry/exit quantity and finite accounting. Mature expired or invalidated plans are counted as no-fill candidates, not zero-R trades.

The outcome journal stores only causal candles at or before the declared horizon. A timestamp-only `observedThrough` value records the first candle timestamp that proves the horizon has been observed; later OHLC values are not included.

## Cohort dimensions and metrics

v1 groups by:

- symbol;
- timeframe;
- original decision status (ENTER, WAIT, REJECT);
- setup family.

Each cohort reports its first/last decision timestamps, matured candidate count, completed trade count, no-fill candidate count, mean/median net R, win rate, and mean MFE/MAE for completed trades.

Net R is:

`netPnl / ((weightedAverageEntryPrice - stopPrice) * exitedQuantity)`

This is cost-adjusted net P&L divided by gross price risk for the actually filled quantity. Fees are included in net P&L. The denominator excludes fees and is not a full account-level risk budget.

Only the latest mature observation for each decision/candidate/simulation version is counted. Earlier mature snapshots are listed as superseded. This prevents evolving journal snapshots from inflating sample sizes.

## Exclusions

The report explicitly lists excluded observations, including invalid records, duplicate IDs, missing candidates, identity mismatches, data-quality failures, early/future timestamps, incomplete horizons, ambiguous paths, unresolved positions, invalid fill accounting and superseded snapshots.

`NO_SETUP` records are excluded. Missed-opportunity discovery must be implemented as a separate causal, versioned detector; it cannot select attractive historical entries retrospectively.

## v1 limitations

- Descriptive cohort analysis only; no calibrated probabilities, confidence intervals, causal attribution or automated improvement proposals.
- No analytical-accuracy or decision-quality scoring. Those require independently labelled outcomes and a rubric that does not reduce decision quality to trade P&L.
- No actual paper execution quality analysis yet.
- No regime dimension until a regime reference is frozen in the decision record and validated.
- No funding, borrow, derivatives, shorts, multi-target or strategy-specific risk budget support.
- The upstream data-quality audit is supplied by the caller; this module does not infer quality from price movement.
- Small samples are displayed as counts and descriptive statistics only. They are not evidence of profitability.

Any future parameter or skill change must follow the proposal lifecycle in `DECISION_LEARNING_LOOP_SPEC.md`, including chronological walk-forward and untouched out-of-sample validation, realistic costs, multiple-testing disclosure, regression tests and explicit human approval.
