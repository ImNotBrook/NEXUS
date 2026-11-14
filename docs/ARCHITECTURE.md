# NEXUS architecture (initial baseline)

## Delivery model
A static, installable PWA is the first delivery target. It can be hosted on a free static host without a persistent server. Core calculations run locally in the browser. This is suitable for research and paper trading, not secure custody of exchange credentials or unattended execution.

## Initial modules
1. **Command Centre** — mobile dashboard and navigation.
2. **Market Data Adapters** — public market data only; provider adapters isolated from domain logic.
3. **Market Intelligence** — canonical causal snapshots for regime, structure, liquidity, technical and derivatives observations, plus optional Elliott Wave scenarios.
4. **Evidence & Decision Engine (EDE)** — evidence validation, independent evidence-family diagnostics, thesis challenge, trade economics and deterministic ENTER/WAIT/REJECT/NO_SETUP output.
5. **Decision Journal** — immutable decision-time snapshots, evidence, plans and version references.
6. **Shadow Outcome Engine** — conservative counterfactual execution simulation for entered, waiting, rejected and missed opportunities.
7. **Learning & Validation** — mature-outcome analytics, calibration research and versioned improvement proposals.
8. **Strategy Lab** — versioned strategy specifications and deterministic simulation.
9. **Backtest Engine** — chronological event processing, fees, slippage, position sizing and out-of-sample splits.
10. **Risk Engine** — exposure, drawdown, loss limits and trade validation; independent of AI.
11. **Paper Broker** — simulated fills and a 10,000 USDT starting ledger; no exchange order endpoint.
12. **Learning & Skills Governance** — AI research, proposed skill updates, evidence and version history.
13. **Qualification Guard** — independently computed evidence gate; review eligibility is not execution permission.
14. **Persistence** — browser-local IndexedDB initially; export/import for user-controlled backups.

## Trust boundaries and target data flow
Public market data -> schema validation -> normalized candles -> causal market intelligence snapshot -> evidence normalization/challenge -> deterministic EDE and risk gates -> paper broker (ENTER only) -> immutable paper ledger and decision journal -> shadow outcome evaluation -> maturity-aware learning reports.

This is the target end-to-end flow. A module existing and passing unit tests does not mean it is already wired into the live workspace or paper workflow.

AI research and analyst agents are advisory. AI output is untrusted input and cannot write directly to risk policy, qualification evidence, account ledger or execution permissions. Agents return structured evidence and arguments; they do not vote or execute. Proposed changes require tests, versioning and human approval.

Decision-time snapshots and journal entries are immutable. Later price data is used only by the outcome evaluator; it must never be merged into the original decision feature set. Actual paper fills and hypothetical shadow fills are stored separately.

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
- Ambiguous intrabar stop/target ordering must be resolved with finer data, treated conservatively, or marked ambiguous.

## Deployment and cost
The first version should be deployable as static files using a genuinely free tier, without requiring a credit card or billing activation. Hosting provider selection is deferred until current limits and account requirements are verified. No paid backend or always-on compute in phase one.

## Current implementation status
- Repository, policy baseline, mobile-first PWA shell and qualification gate: implemented.
- Public Binance and Kraken market-data adapters, normalized OHLCV validation, provider fallback, feed-quality checks and cross-provider comparison: implemented; live endpoint/device verification pending.
- Local IndexedDB stores for paper accounts, latest snapshots and provider-specific historical candles: implemented with one versioned schema.
- Deterministic long-only backtest, bounded Binance historical pagination, walk-forward folds and an out-of-sample fold runner: implemented; strategy optimisation and untouched final holdout remain pending.
- BTC/USDT paper broker with fee/slippage and risk controls: implemented; no live execution adapter or credentials.
- GitHub Pages deployment and CI workflows: implemented and latest main-branch runs verified successful at commit 15c1ef4.
- Deterministic Market Intelligence v1: implemented as a tested domain module. It builds 1D/4H/1H/15M causal snapshots, preserves instrument/volume units, reports trend/volatility/alignment/phase and explicit missing liquidity/positioning dimensions. It is not yet wired into the workspace refresh flow.
- EDE: deterministic decision kernel and journalled decision pipeline implemented and tested as domain modules; no automatic candidate generator or live workspace decision flow is connected yet.
- Decision Journal: append-only IndexedDB store and journalled decision pipeline implemented and tested; export/import backup and workspace integration remain pending.
- Shadow Outcome Engine v1: tested spot-long simulator with explicit costs, partial fills, ambiguity and horizon semantics; journal integration is implemented. No paper-account or exchange order mutation is possible.
- Learning & Validation v1: tested maturity-gated descriptive cohorts for ENTER/WAIT/REJECT, simulation-version separation and no-fill accounting. No automatic learning, parameter changes, calibrated probabilities, decision-quality labels or UI integration.
- Market structure/SMC causal event engine, derivatives-aware shadow simulation, NO_SETUP missed-opportunity detector, regime challenger models and end-to-end workspace wiring remain pending.
- AI research/skill learning remains proposal-based: generated research is untrusted, changes to risk policy or permissions require explicit approval and auditable versioning.
