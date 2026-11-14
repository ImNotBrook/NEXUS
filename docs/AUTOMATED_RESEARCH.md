# Automated research runner

NEXUS can run a bounded daily candidate-search and walk-forward backtest on GitHub Actions.

## What it does

- Fetches up to 1,500 completed BTCUSDT 1-hour public spot candles from Binance.
- Generates 16 transparent, deterministic candidates across SMA crossover, RSI mean-reversion and Donchian breakout templates.
- Evaluates every candidate on the same expanding walk-forward folds.
- Includes configured fees, adverse slippage, half-spread, participation caps and market impact.
- Uploads a versioned JSON report as a GitHub Actions artifact for 30 days.

Run manually from **GitHub → Actions → NEXUS Automated Research → Run workflow**, or allow the daily UTC schedule to run.

## Important limitations

This is automated parameterized research, **not an LLM/AI strategy generator**. It does not infer novel trading logic, promote a winner, place paper orders, or place live orders. The report explicitly records `aiModelUsed: false`.

The execution assumptions are conservative research inputs, not verified exchange fee tiers, order-book depth or executable quotes. Candle-volume participation is only a liquidity proxy. Results remain vulnerable to strategy-selection bias; do not repeatedly tune from the same OOS folds. Nested validation and a final untouched holdout are required before human review.

GitHub-hosted scheduled jobs are best-effort and can be delayed. The uploaded report is retained for 30 days; it is not permanent app storage. No paid service, exchange credential, or billing activation is used.
