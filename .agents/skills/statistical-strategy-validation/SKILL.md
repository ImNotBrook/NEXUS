---
name: statistical-strategy-validation
description: Design falsifiable trading hypotheses and evaluate whether apparent strategy edge survives null tests, chronological validation, costs and path perturbations.
---

# Statistical Strategy Validation

## Objective

Reject weak strategy ideas cheaply before parameter search or paper trading. A profitable historical equity curve is not sufficient evidence of edge.

## Required workflow

1. State the economic hypothesis, market, timeframe, holding horizon, entry/exit rules and expected mechanism before looking at results.
2. Define one primary metric and guardrails before running the experiment. Guardrails should include drawdown, trade count, turnover, exposure and net expectancy after fees/slippage.
3. Freeze a timestamped dataset snapshot and record provider, symbol, interval, start/end timestamps, missing bars and data-quality checks.
4. Establish simple baselines: buy-and-hold where meaningful, no-trade/cash, and a simple strategy with similar exposure.
5. Use chronological train/validation/test partitions. Tune only on training/validation data. Keep a final holdout untouched until the design is frozen.
6. Model execution costs: maker/taker fees where applicable, spread, adverse slippage, fill timing, partial fills and market impact sensitivity. Do not assume fills at the same close that generated the signal.
7. Compare the strategy to a null model. For an entry-rule hypothesis, generate random entries under matched exposure, holding horizon and trade-count constraints. Use repeated seeds and report the null distribution and percentile, not a single lucky random path.
8. Perturb trade order and market paths. Bootstrap/shuffle trade outcomes to estimate path dependence; use block/bootstrap or candle perturbations that preserve serial dependence where possible. State the assumptions and limitations of each resampling method.
9. Run walk-forward folds and report fold dispersion, worst fold, positive-fold share, trade count and stability by market regime. Do not aggregate overlapping OOS windows as independent evidence.
10. Account for multiple testing. Record every attempted candidate and parameter trial, including failed runs. Do not report only the best run.
11. Require reproducible evidence and an untouched final holdout before any strategy can request promotion.

## Failure conditions

Reject or mark inconclusive if:
- Data has look-ahead, survivorship or timestamp alignment errors.
- Strategy logic sees future candles or uses revised data unavailable at decision time.
- Costs or next-bar fill assumptions are missing.
- There are too few independent trades/folds for the claim being made.
- The edge disappears under modest cost, parameter or path perturbations.
- Results depend on one symbol, one regime or one short interval without a predeclared reason.
- The final holdout has been used repeatedly to tune the strategy.

## Reporting contract

Report dataset fingerprint and provenance, exact strategy version, parameter set, train/test dates, all costs, fold-level outcomes, completed trades, net expectancy, drawdown, benchmark/null comparisons, trial count and limitations. Distinguish statistical evidence from economic significance.

## Safety boundary

This skill is advisory research methodology only. It cannot approve a strategy, change risk limits, grant exchange permissions or place orders.

## Upstream research

- Jesse: https://github.com/jesse-ai/jesse (rule-significance testing, Monte Carlo analysis and research API concepts; independently re-implement and test).
- NEXUS walk-forward and scorecard modules are the execution/evaluation source of truth.
