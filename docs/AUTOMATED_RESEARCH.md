# Automated research runner

NEXUS can run a bounded daily candidate-search and walk-forward backtest on GitHub Actions.

## What it does

- Optionally calls Groq's free inference tier to propose up to four bounded parameter candidates. Configure the repository Actions secret `GROQ_API_KEY` to enable this; `GROQ_MODEL` is an optional repository variable and defaults to `openai/gpt-oss-120b`.
- Generated output is parsed as strict JSON and compiled only into the reviewed SMA, RSI and Donchian strategy factories. Arbitrary code, new strategy implementations, orders and execution settings are rejected.
- Without the secret, the workflow uses the deterministic candidate set and remains fully operational.
- Fetches up to 1,500 completed BTCUSDT 1-hour public spot candles from Binance.
- Generates 16 transparent, deterministic candidates across SMA crossover, RSI mean-reversion and Donchian breakout templates.
- Evaluates every candidate on the same expanding walk-forward folds.
- Includes configured fees, adverse slippage, half-spread, participation caps and market impact.
- Uploads a versioned JSON report as a GitHub Actions artifact for 30 days.

Run manually from **GitHub → Actions → NEXUS Automated Research → Run workflow**, or allow the daily UTC schedule to run.

## Important limitations

Without `GROQ_API_KEY`, this is deterministic parameterized research, not AI generation. With the optional Groq key, the model proposes parameterized hypotheses within a fixed strategy-template whitelist; it still cannot write or execute strategy code. The report records whether AI was actually used. Neither mode automatically promotes a winner, places paper orders, or places live orders.

The execution assumptions are conservative research inputs, not verified exchange fee tiers, order-book depth or executable quotes. Candle-volume participation is only a liquidity proxy. Results remain vulnerable to strategy-selection bias; do not repeatedly tune from the same OOS folds. Nested validation and a final untouched holdout are required before human review.

GitHub-hosted scheduled jobs are best-effort and can be delayed. The uploaded report is retained for 30 days; it is not permanent app storage. No paid service, exchange credential, or billing activation is used.
