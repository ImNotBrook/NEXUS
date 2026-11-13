# NEXUS architecture (initial baseline)

## Delivery model
A static, installable PWA is the first delivery target. It can be hosted on a free static host without a persistent server. Core calculations run locally in the browser. This is suitable for research and paper trading, not secure custody of exchange credentials or unattended execution.

## Initial modules
1. **Command Centre** — mobile dashboard and navigation.
2. **Market Data Adapters** — public market data only; provider adapters isolated from domain logic.
3. **Research Workbench** — indicator definitions, market hypotheses and evidence records.
4. **Strategy Lab** — versioned strategy specifications and deterministic simulation.
5. **Backtest Engine** — chronological event processing, fees, slippage, position sizing and out-of-sample splits.
6. **Risk Engine** — exposure, drawdown, loss limits and trade validation.
7. **Paper Broker** — simulated fills and a 10,000 USDT starting ledger; no exchange order endpoint.
8. **Learning & Skills** — AI research, proposed skill updates, evidence and version history.
9. **Qualification Guard** — independently computed evidence gate; review eligibility is not execution permission.
10. **Persistence** — browser-local storage initially; export/import for user-controlled backups.

## Trust boundaries and data flow
Public market data -> schema validation -> normalized candles -> indicators -> strategy signals -> risk checks -> paper broker -> immutable trade/equity records -> evaluation.

AI research is advisory. AI output is untrusted input and cannot write directly to risk policy, qualification evidence, account ledger or execution permissions. Proposed changes require tests, versioning and human approval.

## Qualification policy
A strategy version must demonstrate both:
- at least 90 qualifying calendar days of continuous, valid evidence; and
- at least 1,000 completed trades.

The evidence must be tied to an immutable strategy version and auditable trade ledger. Missing data, invalid timestamps, duplicate trades, strategy changes or broken continuity invalidate or restart the relevant evidence window. Qualification only creates a review request. Live execution remains disabled independently of qualification.

## Backtest integrity requirements
- Chronological processing; no future candle or indicator leakage.
- Fees and conservative slippage included in every simulated fill.
- Explicit position sizing, exposure caps and risk controls.
- Train/validation/test separation with out-of-sample reporting.
- Include delisted/survivorship limitations where relevant.
- Parameter search must report trial counts and overfitting risk.
- Compare against buy-and-hold and cash baselines.

## Deployment and cost
The first version should be deployable as static files using a genuinely free tier, without requiring a credit card or billing activation. Hosting provider selection is deferred until current limits and account requirements are verified. No paid backend or always-on compute in phase one.

## Current implementation status
- Repository, policy baseline, mobile-first PWA shell and qualification gate: implemented.
- Public Binance and Kraken market-data adapters, normalized OHLCV validation, provider fallback, feed-quality checks and cross-provider comparison: implemented; live endpoint/device verification pending.
- Local IndexedDB stores for paper accounts, latest snapshots and provider-specific historical candles: implemented with one versioned schema.
- Deterministic long-only backtest, bounded Binance historical pagination, walk-forward folds and an out-of-sample fold runner: implemented; strategy optimisation and untouched final holdout remain pending.
- BTC/USDT paper broker with fee/slippage and risk controls: implemented; no live execution adapter or credentials.
- GitHub Pages workflow committed; deployment remains unverified while GitHub Actions runner allocation fails and the Pages source setting remains to be selected.
- AI research/skill learning must remain proposal-based: generated research is untrusted, changes to risk policy or permissions require explicit approval and auditable versioning.
