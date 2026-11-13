---
name: nexus-quant-research
description: Research market hypotheses, quantify evidence, distinguish signal from noise, and produce reproducible research briefs for NEXUS.
---

# NEXUS Quant Research

## Mission

Turn a market observation into a falsifiable, reproducible hypothesis. Do not turn a plausible narrative into a trading recommendation without measurable evidence.

## Required workflow

1. **Define the question.** Specify asset, venue, timeframe, sample period, holding horizon and decision being studied.
2. **Establish provenance.** Record provider, symbol mapping, timezone, candle convention, missing-data policy, retrieval time and licensing/usage constraints.
3. **State the hypothesis before analysis.** Include expected direction, mechanism, measurable outcome, null hypothesis and conditions that would falsify it.
4. **Build a baseline.** Compare with buy-and-hold, cash, and a simple non-optimised benchmark. Include a no-signal baseline.
5. **Inspect regimes.** Separate trend, range, volatility and liquidity conditions. Do not assume one regime generalises.
6. **Measure uncertainty.** Report sample size, dispersion, confidence intervals where appropriate, and sensitivity to reasonable parameter changes.
7. **Record negative results.** Failed hypotheses and rejected variants are evidence; do not delete them from the research ledger.

## Quantitative standards

- Never use future data, revised labels, survivorship-filtered universes or information unavailable at decision time.
- Distinguish correlation, predictive association and causal mechanism.
- Use point-in-time data where possible. Explicitly disclose when it is unavailable.
- Do not treat technical indicators as independent evidence when they are transformations of the same price/volume series.
- Correct for multiple comparisons and repeated parameter searches. Report the number of trials.
- Prefer robust effect sizes and stability across assets/timeframes over the best in-sample Sharpe ratio.
- Separate discovery, model selection, validation and final holdout periods.

## Required research brief

Return:
- hypothesis and null;
- data source and limitations;
- sample window and market regime;
- method and parameter choices;
- benchmark comparison;
- results with sample size and uncertainty;
- robustness and sensitivity checks;
- failure conditions;
- reproducible next experiment.

## Prohibited shortcuts

Do not cherry-pick dates, assets, indicators or metrics. Do not silently remove losing trades, missing bars or outliers. Do not infer live profitability from a backtest or paper result.
