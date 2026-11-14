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

See [AGENTS.md](AGENTS.md) for engineering rules, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries, [docs/PAPER_TRADING.md](docs/PAPER_TRADING.md) for simulation assumptions, [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the free Android deployment path, [docs/LEARNING_AND_SKILLS.md](docs/LEARNING_AND_SKILLS.md) for skill governance, [docs/MARKET_REGIMES.md](docs/MARKET_REGIMES.md) for regime diagnostics, [docs/STRATEGY_LIBRARY.md](docs/STRATEGY_LIBRARY.md) for baseline strategies and [docs/FREE_AI_PROVIDERS.md](docs/FREE_AI_PROVIDERS.md) for the free AI provider registry.

### Decision intelligence specifications

- [Market Intelligence](docs/MARKET_INTELLIGENCE_SPEC.md) — causal market regime, structure, liquidity, derivatives and Elliott Wave contracts.
- [Evidence & Decision Engine](docs/DECISION_ENGINE_SPEC.md) — evidence normalization, contradiction handling, decision states and deterministic risk gates.
- [Decision & Learning Loop](docs/DECISION_LEARNING_LOOP_SPEC.md) — immutable journal, shadow outcomes, maturity and controlled learning.
- [Decision Workbench](docs/DECISION_WORKBENCH.md) — approved deterministic candidate generation, hard risk/economics gates and journalled decisions.
- [Shadow Outcomes & Learning](docs/SHADOW_OUTCOMES_OPERATIONS.md) — pre-registered shadow plans, causal historical replay, maturity audits and descriptive cohorts.
- [Local Backups](docs/LOCAL_BACKUPS.md) — full decision-journal export, separate paper-account backup, integrity validation and conflict-safe restore.

The initial frontend is a static TypeScript application. It must remain usable from a modern Android browser and must not depend on a permanently running backend.
