# Nested walk-forward parameter selection

NEXUS can select protective stop-loss and take-profit settings using inner walk-forward folds contained entirely within each outer training window, then evaluate the frozen selection on the subsequent outer test window.

## Evaluation protocol

1. Build chronological outer train / embargo / test folds. Outer test windows are disjoint.
2. For each outer fold, discard the outer embargo and test data from the selection process. The inner sensitivity grid receives only the outer training candles.
3. Evaluate the full bounded protective-exit grid on inner walk-forward folds. The disabled baseline is always included.
4. Select parameters independently for each candidate using the highest compounded inner OOS return. Ties are resolved by lower worst-fold drawdown; exact ties preserve baseline-first grid order.
5. Scenarios below the configured minimum completed-trade count are ineligible. If none qualifies, retain the disabled baseline.
6. Freeze the selected stop/target configuration and evaluate it once on the outer test window with the same fees, spread, slippage, participation cap, market-impact assumptions, capital and allocation.
7. Aggregate outer-fold returns, drawdown, trade expectancy/profit factor, fees, completed turnover, average exposure, protective exit counts, fill events, pending quantity and parameter stability.

## Leakage controls

- Inner folds are constructed only from the outer training slice. The outer embargo and test candles are not passed to the inner sensitivity runner.
- Strategy factories in inner research receive only each inner training fold. Outer evaluation fits again using the complete outer training slice, never the outer test.
- Outer test metrics are kept separate from inner selection metrics.
- The selected parameters are candidate-specific and can vary across outer folds.
- The grid, selection objective, minimum trade threshold, candidate set and strategy design must be fixed before inspecting outer results. Repeatedly changing them after observing outer performance creates another layer of selection bias.
- Preserve a final untouched holdout for final performance claims. Nested walk-forward reduces direct tuning leakage; it does not make repeated human experimentation immune to research-process overfitting.

## Selection objective and safeguards

The current default objective is maximum compounded inner OOS return, with lower worst-fold drawdown as the tie-breaker. A minimum completed-trade threshold prevents zero-trade configurations from winning by default. This is a transparent baseline objective, not a claim that return maximization is universally optimal. Future work can add a pre-registered risk-adjusted objective without inspecting outer results.

The mobile console caps outer evaluation at eight folds. The protective-exit grid remains capped at 25 scenarios. The default console trade threshold is three completed inner trades; users can change it before running the experiment.

## Execution and market-data limitations

The selected configuration is evaluated using NEXUS's existing execution-aware historical simulator. Fees, spread, adverse slippage, participation-scaled market impact and candle-volume-limited partial fills are included. Candle volume is only a liquidity proxy; order-book depth, queue priority, latency, tick/lot constraints, exchange rejects and actual intrabar price paths are not modelled. If stop and target are both touched intrabar, the adverse stop is selected.

Results are historical paper simulations only. They do not establish live executable performance or authorize exchange connectivity or live trading.
