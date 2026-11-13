# Strategy scorecard

The scorecard summarises chronological out-of-sample walk-forward results. It is a reporting layer, not an optimizer or a trade authorization mechanism.

## Fold metrics

- Positive-fold percentage: share of test folds with return strictly above zero.
- Mean and median fold return: central tendency across disjoint OOS folds.
- Best and worst fold return: exposes dependence on a small number of periods.
- Population standard deviation of fold returns: descriptive dispersion, not a Sharpe ratio.
- Worst fold drawdown: maximum of the per-fold maximum drawdowns.

## Trade metrics

- Win rate: winning completed trades divided by all completed trades.
- Gross profit and gross loss: sums of positive and absolute negative net trade PnL.
- Profit factor: gross profit divided by gross loss. It is null when there are no losing trades; a null value must not be interpreted as infinite strategy quality.
- Expectancy: average net PnL per completed trade.
- Fees: total fees reported by the walk-forward evaluation.

Trade PnL is already net of entry and exit fees in the backtest ledger. Do not subtract fees from expectancy a second time. Open positions are not completed trades and are excluded from trade statistics.

## Interpretation limits

- A positive fold is not evidence of statistical significance.
- Fold return dispersion is not a risk-adjusted performance ratio. No Sharpe or Sortino value is produced because this layer does not define a periodic return series or risk-free-rate convention.
- The scorecard does not correct survivorship bias, data snooping, multiple testing, market impact, partial fills, funding, or regime shift.
- Compare candidate strategies on the same market data, timestamps, execution assumptions and untouched final holdout.
- Do not select a strategy solely on win rate or profit factor. Review net expectancy, drawdown, fold consistency, trade count, fees and tail losses together.

The 90-day and 1,000-completed-trade gate remains a separate minimum-evidence rule. Passing it grants review eligibility only; live execution remains disabled.
