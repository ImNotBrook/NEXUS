# Execution Stress Testing

Stage 8 adds a deterministic execution stress replay to Strategy Research.

## Scenarios

For the exact same candles, candidate factories and chronological walk-forward schedule, NEXUS runs:

- Baseline execution assumptions (1×).
- 1.5× fees, base slippage, half-spread and market impact.
- 2× fees, base slippage, half-spread and market impact.
- 3× fees, base slippage, half-spread and market impact.
- 50% of baseline maximum candle-volume participation capacity, with baseline cost rates.

The backtest fee and slippage settings are kept synchronized with the execution model. The engine rejects legacy pipelines without an execution-aware model, mismatched fee/slippage configuration, invalid multipliers and stressed costs that violate the execution model's bounds.

## Interpretation

Compare out-of-sample return, worst fold drawdown, expectancy, completed trades, fees, partial fills and pending quantity across scenarios. The tool deliberately does not rank scenarios, select a preferred cost level, tune parameters or change strategy configuration.

A result that collapses under modest cost increases is execution-fragile. A result that survives these fixed stresses is only more resilient to the modeled assumptions; it is not proof of future profitability.

## Limitations

- Candle-volume participation is a simplified liquidity proxy.
- The model does not include live order-book depth, queue priority, latency, market outages, venue-specific fee tiers, funding, borrow costs or adverse selection.
- The 1.5×/2×/3× multipliers are deterministic stress assumptions, not calibrated probability distributions.
- Reduced participation capacity may increase partial fills and unfilled residuals; these are surfaced, not silently assumed filled.
- The same historical sample is reused across scenarios. This is a robustness diagnostic, not independent validation or a new holdout.
- Do not use sealed final holdout results to tune assumptions.

## Safety

No orders are sent. No strategy is promoted. The stress report does not alter the existing 90 qualifying days plus 1,000 completed trades policy, and no qualification state enables live execution. Research remains local, public-data-only and paper-only.
