# NEXUS AI Trading Intelligence

NEXUS is a mobile-first, research-led trading intelligence platform. The initial release focuses on crypto market research, deterministic strategy testing and simulated paper trading.

## Non-negotiable safety boundaries

- Paper trading only; initial simulated equity is 10,000 USDT.
- No exchange API keys, private trading permissions or live order routing in the initial development phase.
- Strategy qualification requires **both** at least 90 qualifying calendar days and at least 1,000 completed trades.
- Qualification only permits a request for human review. It never enables live trading.
- Backtests must account for fees, slippage, position sizing, look-ahead bias and out-of-sample validation.
- AI may research and propose improvements. Changes to system rules, risk limits and permissions require explicit human approval.
- $0 budget: no paid APIs, hosted databases, subscriptions or services requiring billing activation.

## Development

See [AGENTS.md](AGENTS.md) for engineering rules, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries, [docs/PAPER_TRADING.md](docs/PAPER_TRADING.md) for simulation assumptions, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the free Android deployment path, and [docs/LEARNING_AND_SKILLS.md](docs/LEARNING_AND_SKILLS.md) for the hybrid skill-learning and approval model, and [docs/MARKET_REGIMES.md](docs/MARKET_REGIMES.md) for causal market regime diagnostics, and [docs/STRATEGY_LIBRARY.md](docs/STRATEGY_LIBRARY.md) for baseline strategies.

The initial frontend is a static TypeScript application. It must remain usable from a modern Android browser and must not depend on a permanently running backend.


---

# NEXUS Paper Trading Ledger

This branch stores only the simulated paper-trading configuration and checkpoint.

- `data/paper-trading-config.json` is human-controlled and disabled by default.
- `data/paper-trading-state.json` is updated by the scheduled GitHub Actions paper-trading worker.
- The ledger is public because this repository is public. It must contain simulated balances and market-derived results only.
- Never put API keys, exchange credentials, personal information or real account data here.

To enable paper trading, first review a candidate's nested walk-forward report and final untouched holdout. Then update the config with an explicit strategy ID, exact parameters, approval timestamp (Unix milliseconds), approver and rationale, and set `enabled` to true. The worker rejects unapproved or mismatched strategy configurations.
