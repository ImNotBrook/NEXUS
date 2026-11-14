# Statistical Robustness & Qualification Diagnostics

Stage 7 adds a descriptive statistical review panel to each Strategy Research walk-forward report.

## Measures

- Completed out-of-sample trades and chronological test-fold count.
- Win-rate 95% Wilson interval. This is a binomial uncertainty interval; trade outcomes may not be independent.
- Net trade expectancy and a deterministic 95% circular moving-block bootstrap interval. The block length is `ceil(sqrt(n))` and 1,000 resamples are used. The seed is derived from the observed PnL sequence so the report is reproducible.
- Positive-fold percentage, median and worst fold return, worst fold drawdown.
- Number of folds ending with an open position or pending order.
- Multiple-candidate warning to make selection bias visible.

## Review states

- `INSUFFICIENT_SAMPLE`: fewer than 30 completed OOS trades or fewer than five OOS folds.
- `FRAGILE`: sample threshold met, but net expectancy is non-positive, fewer than 60% of folds are positive, or unresolved exposure remains.
- `REVIEW_FOR_PAPER`: the basic sample, expectancy, fold-consistency and execution-completion gates pass. This is permission for controlled paper observation only, not strategy promotion.

These are conservative triage rules, not a universal statistical qualification standard. Thresholds are explicit and should not be tuned to make a strategy pass.

## Interpretation and limitations

- The Wilson interval is descriptive; serially dependent trades violate the simplest binomial independence assumption.
- The moving-block bootstrap preserves short-range order within resampled blocks, but it does not prove stationarity, eliminate regime shift, correct for multiple testing, or provide a formal p-value.
- Bootstrap bounds are not used as an automatic pass/fail criterion. A positive lower bound is not proof of future profitability.
- Fold returns and trade PnL are not independent observations when folds overlap or when strategies share market exposure. The existing walk-forward configuration requires disjoint test windows, but multiple candidates still create selection bias.
- Expectancy is expressed in the backtest's account currency (currently USDT) and inherits its sizing and execution assumptions.
- The report is calculated from completed OOS trades only. Open positions and pending orders are surfaced separately, not silently treated as completed trades.
- Market-regime tables remain descriptive and may contain small subgroup counts; do not infer robust regime edge from a handful of observations.
- A sealed final holdout remains untouched. Do not use this panel to tune against the sealed holdout.

## Safety

No orders are created. No strategy is automatically promoted. The panel does not alter the strategy qualification rule (90 qualifying days and 1,000 completed trades), and neither that rule nor this report enables live trading. Research remains paper-only and uses the existing public market-data path.
