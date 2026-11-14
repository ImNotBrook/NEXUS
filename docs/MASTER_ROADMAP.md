# NEXUS Master Roadmap

Updated: 2026-11-14

This is the canonical delivery tracker for NEXUS. Update this file whenever a stage changes state. A feature is **not complete** merely because its domain module exists: it must be wired into the mobile workspace, covered by tests, documented, and verified through CI/deployment where applicable.

## Product destination

NEXUS is intended to become a mobile-first AI trading intelligence and automated paper-trading platform. It must combine reliable market data, transparent deterministic decision logic, AI-assisted research, strategy creation, rigorous validation, risk-controlled paper execution and an auditable learning loop.

## Permanent constraints

- $0 operating budget: free tiers and open source only. Never enable billing or create paid resources.
- Android-first operation; the owner uses a Samsung Galaxy A55 and must be able to operate the product from a mobile browser.
- Paper trading only. No live exchange order routing or private trading credentials.
- The initial simulated account is 10,000 USDT.
- Strategy qualification remains conjunctive: at least 90 qualifying calendar days **and** 1,000 completed trades. Qualification grants human review only.
- Deterministic risk, validation and execution controls are authoritative. AI is advisory and untrusted.
- AI may research, explain and propose strategies or changes. It cannot alter risk limits, permissions, qualification rules or approved strategy configuration without explicit human approval.
- Every important decision, including WAIT, REJECT and NO_SETUP, must remain auditable.
- No performance claim without fees, slippage, position sizing, out-of-sample validation, realistic execution assumptions and explicit limitations.

## Delivery status key

- **DONE** — implemented, connected and covered by automated verification; deployment status is recorded separately.
- **PARTIAL** — some components exist, but the complete workflow or required verification is outstanding.
- **NEXT** — active delivery stage.
- **PLANNED** — not yet started.
- **BLOCKED** — cannot proceed until a named dependency is resolved.

## Stage register

| Stage | Workstream | Status | Completion target |
|---|---|---|---|
| 1 | Decision journal and audit trail | DONE | Immutable decisions/events, visible statuses, export and restore |
| 2 | Decision workbench | DONE | Candidate generation, evidence, bull/bear thesis, hard gates and human approval |
| 3 | Shadow outcomes and learning | DONE | Decision-time plans, causal replay, maturity and descriptive cohorts |
| 4 | NO_SETUP diagnostics | DONE | Frozen Donchian-only missed-opportunity replay; limitations explicit |
| 5 | Local backup and restore | DONE | Validated journal and paper-account backup/restore on device |
| 6 | Sealed final holdout | DONE | Chronological final holdout, embargo and local overlap lock |
| 7 | Statistical robustness | DONE | Confidence intervals, bootstrap, fold consistency and conservative statuses |
| 8 | Execution stress testing and best-first ranking | DONE | Adverse execution scenarios and deterministic candidate ordering |
| 9 | Global research leaderboard | PARTIAL | Ordinary and complete execution-stress family rankings are connected; nested/holdout ledgers remain separate; collective integration verification remains |
| 10 | Strategy creation studio | PLANNED | Versioned strategy specifications, reusable templates, rule composer and safe candidate generation |
| 11 | AI analyst and research agents | PARTIAL | Governed provider adapters and proposal foundations exist; complete multi-agent workflow, evidence citations, structured outputs and evaluations |
| 12 | Market intelligence expansion | PARTIAL | Core multi-timeframe technical evidence exists; complete resilient market coverage, liquidity/order-book and derivatives dimensions with source-quality controls |
| 13 | Unified risk and portfolio engine | PARTIAL | Existing paper-broker and decision gates; unify portfolio exposure, correlated risk, limits and pre-trade/post-trade checks |
| 14 | Automated paper-trading orchestration | PARTIAL | Checkpointed scheduled paper agent and protective exits exist; complete lifecycle integration, monitoring, idempotency, recovery and safe operational controls |
| 15 | Strategy evaluation and controlled improvement | PLANNED | Automated evaluation, drift detection, challenger comparisons and human-approved version changes |
| 16 | Learning and attribution | PARTIAL | Journal, shadow outcomes and diagnostics exist; add decision-quality labels, calibration and attribution without hindsight leakage |
| 17 | Platform operations and reliability | PARTIAL | Static PWA and CI/deployment exist; add health/status visibility, graceful degradation, migration/recovery tests and operational audit |
| 18 | End-to-end acceptance and release hardening | PLANNED | Phone-first acceptance of market data → AI analysis → strategy research → decision → paper execution → outcomes → learning |

## Active stage: 9 — Global Research Leaderboard

Implementation note: the ordinary leaderboard reads all `ResearchRunStore` records. Newly run execution-stress scenarios carry a versioned family manifest and are aggregated only when every expected scenario is present and consistent; legacy or interrupted families are excluded rather than inferred. Nested research and sealed holdout remain in their own ledgers and dedicated views. See [RESEARCH_LEADERBOARD.md](RESEARCH_LEADERBOARD.md).

### Scope
- Read existing locally persisted research runs; do not create a second source of truth.
- Compare runs only when dataset identity/provenance, symbol, interval, date range, fold design, strategy identity/version and execution assumptions are compatible.
- If key metadata is absent, mark a run non-comparable rather than guessing.
- Show separate views for: best raw historical result, most robust research candidate, and strongest complete execution-stress survivor; keep nested research and sealed holdout in their own separate views.
- Display sample size, fold count, worst-fold return/drawdown, expectancy, costs, unresolved exposure and statistical review state.
- Preserve all runs. No automatic deletion, tuning, promotion or paper-order placement.
- Keep rankings deterministic with explicit tie-breaks and explain why entries are grouped or excluded.

### Acceptance criteria
- Unit tests cover compatibility, missing metadata, config mismatches, candidate identity, stable ordering and empty history.
- Integration tests load persisted ordinary and stress-family runs and produce the same rankings after refresh/reopen; incomplete or inconsistent stress families are excluded.
- Mobile UI clearly separates incomparable groups and warns that historical ranking is not a profitability guarantee.
- Existing research, stress, holdout and paper workflows remain unchanged.
- CI, dependency audit, TypeScript and production build pass before deployment.

## Remaining platform work — definition of done

### Strategy creation
- Strategy definitions are immutable, versioned and machine-readable.
- Templates and generated candidates are deterministic and reproducible.
- Every parameter search records the full trial count and guards against selection bias.
- No AI-generated strategy can bypass the normal backtest, holdout, stress and paper qualification path.

### AI intelligence
- Every model call passes through the shared AI governance policy.
- AI outputs use validated schemas and cite the data/evidence used.
- The analyst must present bull and bear cases, contradictions, uncertainty and reasons to abstain.
- AI cannot invent prices, fills, indicators or evidence; missing inputs must be explicit.
- Model output cannot directly place orders or change policy.

### Automated paper trading
- Scheduled scans are idempotent and checkpointed.
- Signals are revalidated against fresh, quality-approved data immediately before simulated execution.
- Risk checks run before every entry and after every fill.
- Partial fills, rejected orders, stale data, gaps, restarts, duplicate events and broker reconciliation are tested.
- Kill switch, pause/resume, maximum exposure and daily loss limits are visible and enforceable.
- The scheduled workflow must remain disabled until an explicit human-approved paper configuration is present.
- No live order adapter is part of this roadmap.

### Platform and operations
- Android mobile UI remains the primary operating surface.
- Local data loss and backup limitations are clearly explained; restore paths are tested.
- No secrets are stored in browser storage or committed to Git.
- CI must test domain logic, adapters, integration workflows and production build.
- A stage is not called complete until the user-facing workflow is connected and its limitations are documented.

## Change control

For each stage, maintain:
1. Scope and explicit non-goals.
2. Dependencies and data contracts.
3. Test-first implementation plan.
4. Unit, adapter/integration and end-to-end tests.
5. CI and deployment links plus exact commit.
6. Known limitations and remaining work.
7. Updated status in this file and `docs/STATUS.md`.

When scope changes, update this roadmap before starting unrelated feature work. Do not silently drop unfinished work.
