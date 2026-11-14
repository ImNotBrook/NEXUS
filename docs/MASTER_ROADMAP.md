# NEXUS Master Roadmap

Updated: 2026-11-15

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
| 9 | Global research leaderboard | DONE | Ordinary, complete execution-stress family, nested and sealed-holdout views remain distinct; phone workflow accepted |
| 10 | AI-led strategy factory and creation studio | ACTIVE | Scheduled AI proposal generation, deterministic candidate compilation, human-reviewed strategy inbox, reproducible research, parameter trials and versioned library |
| 11 | AI analyst and research agents | PARTIAL | Governed provider adapters and proposal foundations exist; complete multi-agent workflow, evidence citations, structured outputs and evaluations |
| 12 | Market intelligence expansion | PARTIAL | Core multi-timeframe technical evidence exists; complete resilient market coverage, liquidity/order-book and derivatives dimensions with source-quality controls |
| 13 | Unified risk and portfolio engine | PARTIAL | Existing paper-broker and decision gates; unify portfolio exposure, correlated risk, limits and pre-trade/post-trade checks |
| 14 | Automated paper-trading orchestration | PARTIAL | Checkpointed scheduled paper agent and protective exits exist; complete lifecycle integration, monitoring, idempotency, recovery and safe operational controls |
| 15 | Strategy evaluation and controlled improvement | PLANNED | Automated evaluation, drift detection, challenger comparisons and human-approved version changes |
| 16 | Learning and attribution | PARTIAL | Journal, shadow outcomes and diagnostics exist; add decision-quality labels, calibration and attribution without hindsight leakage |
| 17 | Platform operations and reliability | PARTIAL | Static PWA and CI/deployment exist; add health/status visibility, graceful degradation, migration/recovery tests and operational audit |
| 18 | End-to-end acceptance and release hardening | PLANNED | Phone-first acceptance of market data → AI analysis → strategy research → decision → paper execution → outcomes → learning |

## Completed stage: 9 — Global Research Leaderboard

The ordinary and execution-stress family leaderboards are connected to persisted local research records. Nested walk-forward and sealed holdout remain separate research views/ledgers and are not mixed into unlike metric groups. The user confirmed the Strategy Research → Execution-stress survivors workflow on the Galaxy A55 after running a fresh stress experiment. Details and CI/deployment records are in [RESEARCH_LEADERBOARD.md](RESEARCH_LEADERBOARD.md) and [STATUS.md](STATUS.md).

## Active stage: 10 — AI-led Strategy Factory and Creation Studio

### Product direction correction
NEXUS must generate strategies itself. The Strategy Studio is primarily a review, governance and research surface—not a form that requires the user to invent strategies. The AI research workflow proposes candidates automatically from market context; deterministic compilers restrict proposals to reviewed strategy families; the research pipeline evaluates them; the user reviews and explicitly approves promising definitions. Manual authoring remains an optional fallback, not the main strategy-generation path.

### AI proposal review bridge (current increment)
- The existing scheduled `NEXUS Automated Research` workflow calls the provider-neutral, governed AI generator when owner-configured free-tier provider credentials are present; it otherwise uses deterministic automated candidates.
- AI output remains a bounded proposal set for the existing SMA crossover, RSI mean-reversion and Donchian breakout families. It is compiled to reviewed deterministic factories and evaluated alongside deterministic candidates on the same historical dataset, walk-forward folds and execution-cost assumptions.
- The workflow emits `artifacts/automated-research.json` containing provider/model provenance, proposal rationale, parameters, research report, assumptions and safety flags. GitHub Actions uploads it as a 30-day artifact.
- A separate least-purpose `publish-proposals` job has `contents: write` only after research succeeds. It downloads the report, publishes only a sanitised proposal payload (schema, timestamp, symbol/interval, provider/model, status and validated proposals) to the dedicated `ai-proposals` branch, and does not publish raw responses, the full research report or credentials.
- Strategy Studio can refresh the latest public proposal feed directly from that branch. File import remains available as a fallback. The first feed is created after the next successful scheduled or manually dispatched Automated Research workflow.
- Strategy Studio now imports that artifact, validates its schema/provider/proposals and presents each proposal with rationale. Only an explicit **Approve and save strategy** action converts a proposal into an immutable `origin: human` library version. The AI cannot save itself, approve itself, promote a candidate or authorize paper execution.
- Approved strategies become eligible for ordinary historical research. Paper qualification and the separate human paper-configuration approval remain unchanged.
- AI generation now includes bounded complete rule compositions from the versioned whitelist in [AI Strategy Composition](AI_STRATEGY_COMPOSITION.md), in addition to parameter-level discovery. The latest feed is a public proposal-only branch and must contain no private or sensitive data. Richer multi-timeframe hypotheses, volume/order-book/derivatives atoms, explainability and autonomous iteration remain future work.



### Current increment — AI-composed strategy rules
- Extend the governed provider response with 1–2 complete structured strategy specifications in addition to existing parameter proposals.
- Use a strict versioned DSL, not generated code: long-only 1h entry trigger, up to two confirmations, explicit exit, falsifiable hypothesis, regime-scope label and invalidation.
- Compile only whitelisted indicator/rule atoms into deterministic `ResearchCandidate` factories. Signals use completed candles and next-open backtester execution; the existing risk/execution layers remain authoritative.
- Evaluate AI-composed candidates alongside deterministic candidates on the same dataset, walk-forward folds and cost assumptions.
- Expose each complete strategy in Strategy Studio for explicit human approval, immutable library storage and provenance retention. Approved strategies enter normal historical research only.
- Unit, provider-adapter and library-to-research integration tests are required. Full contract and limitations: [AI Strategy Composition](AI_STRATEGY_COMPOSITION.md).

### First increment
- Define a strict, machine-readable strategy contract with schema version, semantic strategy version, stable ID, family, parameters, origin and creation timestamp.
- Provide reusable deterministic templates for SMA crossover, RSI mean reversion and Donchian breakout.
- Validate family-specific parameter keys/ranges and return detached immutable definitions.
- Convert saved human-authored definitions into existing ResearchCandidate factories without execution side effects.
- Generate deterministic Cartesian parameter trials with a 25-combination mobile cap, unique trial identities, a full trial manifest and explicit multiple-testing warning.
- Persist strategy versions append-only in a new local IndexedDB store; duplicate ID/version writes must fail rather than overwrite.
- Add a mobile-first Strategy Studio page. Saved human-authored definitions and explicitly human-approved AI proposals become eligible for historical walk-forward research; unreviewed AI proposals remain excluded.
- No automatic selection, approval, paper execution, qualification changes or live routing.

### Current increment — parameter-trial workflow
- Strategy Research now lets the user select a saved human-authored definition and enter a JSON parameter grid. Family-specific examples are prefilled when the selection changes.
- The UI previews the deterministic Cartesian trial count and full candidate identities before running research; the 25-trial cap and strict family validation remain authoritative.
- The selected base candidate is excluded from that batch and replaced by the exact generated trial candidates. Baseline and other saved human strategies remain in the batch.
- Both legacy and execution-aware research reports persist the exact trial manifest in `ResearchRunStore`; saved history displays the base strategy and trial count after reload.
- The manifest records generator version, base strategy ID/version, parameter grid, trial count, all trial IDs and the selection-bias warning.

### Acceptance criteria
- Unit tests cover schema/version/parameter validation, immutability, stable candidate identity, deterministic grid order, trial caps and invalid combinations.
- Adapter tests cover append-only persistence, reload, duplicate-version rejection and migration from existing IndexedDB state.
- Integration test proves a saved strategy can be reloaded, converted to a candidate and evaluated by the existing walk-forward research pipeline.
- Mobile UI supports AI artifact import, rationale review, explicit proposal approval, immutable save and library reload; manual template authoring remains available as a fallback.
- Trial count and selection-bias manifest are retained with parameter-search research reports; no unrecorded tuning.
- Existing strategy, research, holdout, stress, decision and paper workflows remain unchanged.
- CI, dependency audit, TypeScript and production build pass before deployment.


## Stage 10 — Strategy parameter trials (implementation increment)

- Added a mobile Strategy Research parameter-trial panel. It loads saved human-authored strategies, prefills family-specific parameter-grid examples, parses user JSON and previews deterministic trial IDs/count before execution.
- The selected base strategy is replaced by its generated variants for that run; other baseline and saved human strategies remain. Maximum 25 variants; family parameter validation rejects invalid combinations.
- Both legacy and execution-aware reports persist the exact trial manifest alongside the report. Saved experiment history shows trial count and base strategy identity after reload. Existing legacy records remain readable without metadata.
- Adapter tests verify exact manifest round-trip and reject inconsistent trial counts/IDs. The complete CI suite passed 83 test files / 532 tests, dependency audit (0 vulnerabilities), scheduled-runner checks, derivatives checks and production build on commit `4a055dff5713534ee50f75adb15941b19b60f082` (CI [43581981951](https://github.com/ImNotBrook/NEXUS/actions/runs/43581981951)).
- A follow-up UI correction prefills the correct parameter names for SMA, RSI or Donchian when the selected family changes; this is in commit `d5312c9ef6e78c2d143bac900ebe5910205a0bca` and CI [43582070135](https://github.com/ImNotBrook/NEXUS/actions/runs/43582070135) has now passed all 83 test files / 532 tests, scheduled-runner checks, derivatives checks, dependency audit and production build. Deployment was superseded by documentation commits and will be verified on the final documentation commit.
- Strategy-library backup is now available as a third independent JSON backup type. Strategy versions restore additively with conflict detection; research-run reports and their trial manifests are still not included in the local backup envelope. Parameter trials are exploratory; selecting the best on the same OOS data is biased. No promotion, paper approval or live trading is introduced.

## Stage 10 — Strategy library backup and restore (implementation increment)

- Added a third versioned local backup kind for the complete immutable strategy library. The Strategy Studio can export every saved version and restore from a downloaded JSON file.
- Restore validates each definition and its ID/version/timestamp identity, rejects duplicate entries in a backup, skips identical local versions, and blocks any same-ID/version content conflict. Missing records are inserted additively in one IndexedDB transaction; existing strategy versions are never overwritten.
- Added adapter tests for full export, restore into an empty store, idempotent repeat restore, conflict refusal and malformed/duplicate records; backup-envelope tests cover the new backup type.
- CI passed 83 test files / 536 tests, dependency audit (0 vulnerabilities), scheduled-runner checks, derivatives checks and production build on commit `6f586c6719d2969eb506c8f351f3058f1772fcb5` (CI [43582449928](https://github.com/ImNotBrook/NEXUS/actions/runs/43582449928)).
- Remaining: research-run reports and trial manifests are not yet backed up; nested research, sealed holdouts and other local ledgers also remain outside the current backup formats. This increment does not claim a full-device backup.

- AI-composed rule-engine verification: commit `06b20bc446e11c95d338de9b00eb6edd69669fec`, CI [43641802771](https://github.com/ImNotBrook/NEXUS/actions/runs/43641802771) passed 85 test files / 550 tests plus security audit, runner checks and production build; deployment [43641802814](https://github.com/ImNotBrook/NEXUS/actions/runs/43641802814) succeeded. The first public AI feed still requires a successful run of the updated Automated Research workflow to seed its branch.

## Stage 11 — AI analyst evidence contract (first increment)

- Added `src/domain/ai-market-analysis.ts`, a strict parser for untrusted model analysis. It requires bullish/bearish/mixed/none bias, bounded confidence, a summary, both bull and bear cases, contradictions, evidence-linked claims and explicit abstention.
- The exact supplied evidence packet is validated for unique IDs, source labels, observation timestamps and bounded factual statements. Claims citing unknown IDs are rejected; non-abstaining output must include both cases and at least one cited claim.
- Abstention requires bias `none`, low confidence, no claims and a reason. Unknown fields and malformed evidence are rejected.
- Tests cover valid output, unknown citations, duplicate evidence IDs, missing counter-case, valid/invalid abstention and malformed metadata.
- This is a contract foundation only. It does not yet call an AI provider or render an analyst panel. Citation membership is not semantic entailment; source authenticity/freshness must be established by the future evidence-packet builder. See [AI Analyst Evidence Contract](AI_ANALYST_CONTRACT.md).

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
