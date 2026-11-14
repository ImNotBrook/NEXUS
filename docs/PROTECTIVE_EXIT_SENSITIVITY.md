# Protective-exit sensitivity research

NEXUS can evaluate a bounded Cartesian grid of optional long-only stop-loss and take-profit settings against one historical candle dataset and one fixed walk-forward schedule.

## Contract

- The disabled baseline is always included.
- Each stop-loss value is crossed with each take-profit value, including the disabled value on each axis.
- Stop-loss percentages must be greater than 0 and below 100. Take-profit percentages must be greater than 0.
- Duplicate axis values are rejected.
- The grid is capped at 25 total scenarios to bound browser/mobile CPU and memory use.
- Every scenario reuses the same candidate definitions, market candles, train/embargo/test windows, starting capital, allocation, fees, spread, slippage, participation cap and market-impact assumptions.
- Strategy factories receive training candles only. Each scenario is evaluated on subsequent out-of-sample folds.
- The execution-aware model is passed into each fold; market stops use market-fill costs and target limits retain limit-fill semantics.
- Reports retain the protective-order configuration and dataset fingerprint. Existing scorecards expose fold return dispersion, worst-fold drawdown, trade expectancy/profit factor, fees, fill events, pending quantity and exit reasons.

## Interpretation and selection bias

This grid is a sensitivity/robustness diagnostic, not an optimizer. It does not rank or select a best configuration.

Looking at the same out-of-sample folds across many parameter combinations and then choosing the best result creates multiple-testing and selection bias. The chosen result is no longer an unbiased estimate of future performance. Use nested walk-forward selection (parameter choice occurs only inside each outer training window) or reserve a final untouched holdout that is not used to choose parameters.

Compare the distribution across folds and neighboring parameter settings. A single high-return cell with weak neighboring cells, poor worst-fold drawdown or low trade count is not robust evidence.

## Execution and market-data limitations

The execution-aware simulator models fees, adverse spread/slippage, participation-scaled market impact and candle-volume-limited partial fills. Candle volume is only a liquidity proxy: it does not reveal order-book depth, queue priority, latency, tick/lot constraints, exchange rejects or actual intrabar path. If stop and target are both touched in one candle, the simulator selects the adverse stop. These results remain historical paper simulations and must not be interpreted as executable live performance.

No exchange credentials, paid services or live-order routing are used.
