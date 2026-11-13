---
name: nexus-backtest-audit
description: Audit trading simulations for look-ahead bias, overfitting, execution realism, statistical weakness and reproducibility.
---

# NEXUS Backtest Audit

## Audit sequence

1. Validate candle order, interval continuity, timestamp alignment, OHLC consistency and completed-bar status.
2. Trace every feature and signal to the exact information available at decision time.
3. Confirm next-bar execution or another explicitly justified fill model.
4. Apply fees on every executed side, adverse slippage, spread and position sizing. Model funding/borrow where relevant.
5. Check cash, quantity, notional, exposure, leverage, rounding and minimum order constraints.
6. Inspect trade ledger reconciliation against the equity curve.
7. Compare with cash and buy-and-hold baselines.
8. Evaluate chronological walk-forward folds with disjoint test windows and embargo where needed.
9. Reserve a final untouched holdout. Do not tune after viewing it.
10. Record all tested parameter combinations and failed experiments.

## Required metrics

Report total and annualised return only when the sample supports it; max drawdown; volatility; Sharpe/Sortino with stated risk-free assumptions; exposure; turnover; trade count; win rate; average win/loss; profit factor; expectancy; fees; and fold-level results. Do not report a metric without defining its calculation.

## Robustness

- Test parameter neighborhoods, not only the optimum.
- Test different market regimes and, where possible, different assets/venues.
- Use block bootstrap or another time-series-aware uncertainty method when appropriate.
- Account for multiple testing and selection bias.
- Check whether performance is concentrated in a small number of trades or dates.
- Compare gross and net results; reject strategies whose edge disappears under plausible cost increases.

## Audit verdict

Classify each result as invalid, fragile, promising, or robust-under-tested-conditions. Explain the evidence and the limitations. Never describe a strategy as proven or guaranteed. Walk-forward testing reduces temporal leakage but does not remove data snooping, survivorship bias, regime shift or the need for an untouched holdout.
