# Development status

Updated: 2026-11-14

## Completed
- Empty NEXUS repository inspected and confirmed.
- Product constraints, safety boundaries and architecture baseline documented.
- TypeScript/Vite project skeleton added.
- First mobile-first command-centre screen added.
- Strategy qualification rule implemented: 90 qualifying days AND 1,000 completed trades.
- Validated OHLCV candle domain model with strict timestamp ordering and OHLC/volume validation.
- Keyless Binance public spot OHLCV adapter; excludes incomplete candles and validates payloads.
- Deterministic SMA, EMA, Wilder RSI, Wilder ATR, MACD and Bollinger Bands.
- Dashboard BTC/USDT public market snapshot with RSI(14) and manual refresh.
- Deterministic long-only spot backtest engine with next-bar-open fills, configurable fees, adverse slippage, allocation sizing, trade ledger and marked-to-market equity curve.
- Qualification result only grants review eligibility; live execution is hard-coded false.
- Vitest specifications added for qualification, OHLCV validation, indicators, public adapter and backtest scenarios.
- PWA manifest, icon and static-shell service worker added.
- GitHub Actions workflow configured for tests and production build.

## Verification
- Local Node.js test harness: 5 qualification assertions passed.
- Local Node.js test harness: 15 candle/indicator assertions passed.
- Local Node.js test harness: 8 public market adapter assertions passed.
- Local Node.js test harness: 5 backtest scenario assertions passed.
- Global TypeScript 5.8.3 strict compile of candle, indicator, adapter and backtest modules: passed.
- Vitest specifications added for qualification, candle validation, indicators and Binance adapter; the full Vitest suite is still pending because GitHub Actions runners are failing before job steps execute.
- GitHub Actions: runs are created but fail before any runner starts (runner name empty; zero steps executed). The CI suite and production build therefore remain unverified in GitHub Actions.
- Full Vite production build and Vitest suite have not yet been run in a dependency-installed project environment.

## Current limitations
- Live endpoint connectivity has not been verified; the public Binance adapter is implemented and the dashboard attempts a public snapshot.
- No persistent backend or cloud database.
- No deployment configured or claimed.
- No live trading or exchange private credentials.
- CI runner availability must be resolved before relying on automated GitHub verification.

## Next implementation tasks
1. Resolve CI execution without enabling paid billing, then run the complete Vitest/build pipeline.
2. Expose historical backfill and candle-history inspection in the mobile dashboard, with bounded progress and resumable requests.
3. Build the strategy library and connect walk-forward evaluation/scorecard to reproducible strategy experiments.
4. Add spread, partial-fill and market-impact execution models, parameter-search trial accounting and a final untouched holdout.
5. Persist the research evidence and skill-proposal ledger; keep automatic promotion disabled until trusted evaluation is available.

## Paper trading increment

- Added a deterministic BTC/USDT spot paper broker with a 10,000 USDT default simulated balance.
- Added adverse slippage, two-sided fees, fee-inclusive entry cost basis, per-symbol exposure limits, daily drawdown controls, and a fill ledger.
- Daily drawdown lock blocks new buys but explicitly permits sells to reduce risk.
- Added local IndexedDB persistence for the paper account and a dashboard order desk. Risk settings are frozen into each account snapshot; repeated clicks are serialized; account state is updated in memory only after a successful persistence transaction.
- Added 10 paper broker and 2 IndexedDB adapter Vitest specifications. Separate local Node harnesses passed 9 paper broker scenarios and 4 persistence assertions; strict TypeScript compilation passed for the paper broker and IndexedDB adapter modules.
- Full repository Vitest and Vite production build remain unverified because GitHub Actions jobs are failing before runner allocation (runner ID 0, empty runner name, no job steps). The latest workflow run must be checked again after this commit.
- IndexedDB browser integration and the full mobile UI have not yet been exercised in a real browser.
- Market orders use the latest completed candle close as a reference; the dashboard rejects orders when its fetched snapshot is older than five minutes. Spread, order-book depth, latency, partial fills, and market impact are not modelled.


## Deployment preparation

- Added a GitHub Pages deployment workflow gated by the complete test suite and production build.
- Deployment is not live or verified. GitHub Pages must be set to use GitHub Actions once in repository Settings → Pages; the available GitHub connection cannot change that setting.
- Current GitHub Actions runs continue to fail before hosted runner allocation, with runner ID 0 and no steps executed. This blocks both CI verification and deployment; no paid runner or hosting resource has been created.

## Provider-neutral market data increment

- Added a provider-neutral market snapshot contract and ordered provider resolver with strict shared OHLCV validation.
- Added independent public Kraken hourly OHLC fallback for BTC/USD and BTC/USDT. The current uncommitted Kraken row is excluded; unsupported pairs/intervals fail closed.
- Added the IndexedDB market snapshot cache, keyed by symbol and interval, sharing the paper-account database. The shared schema has since been upgraded to version 3 and also stores historical candles.
- Resolver uses cache only after all providers fail, rejects cache entries older than 24 hours or with future timestamps, and marks cache fallback stale. The dashboard identifies the source and blocks paper orders for stale data.
- Local strict TypeScript compilation passed for the provider resolver, Kraken adapter and IndexedDB cache. Local deterministic harness passed 4 resolver assertions, 3 Kraken adapter assertions and 4 IndexedDB cache assertions.
- Added 5 market resolver, 4 Kraken adapter and 2 cache Vitest specifications. The repository Vitest suite and production build remain unverified because GitHub-hosted runner allocation has been failing before steps execute.
- No live API connectivity or Android browser integration has been claimed; public endpoint behavior still requires a real browser/device test.


## Market data quality increment

- Added snapshot quality diagnostics for invalid OHLCV, empty feeds, missing hourly intervals, invalid/future/stale fetch timestamps, incomplete latest candles, stale last-completed candles and zero-volume warnings. Gaps and stale/invalid snapshots fail the quality gate; zero-volume candles warn without being rewritten.
- Added timestamp-aligned Binance/Kraken close-price comparison using symmetric midpoint basis-point deviation. Feeds are never merged or averaged; deviations above 50 bps are flagged.
- Paper orders now require a quality-passing snapshot and a successful within-tolerance cross-provider check. A missing secondary feed, insufficient timestamp overlap, stale cache, candle gap or >50 bps discrepancy blocks orders.
- Provider resolution now enforces a configurable minimum candle count and fails over when a source returns insufficient history. The BTC dashboard requires at least 15 candles before accepting a provider response.
- Added 12 Vitest specifications for market-data quality/comparison and one resolver test for minimum-history failover. Cross-feed confirmation requires the latest candle timestamp to match, not merely older overlap. Local strict TypeScript compilation passed for the quality module; deterministic Node harnesses passed 12 quality/comparison assertions and 2 minimum-history resolver assertions.
- The Vitest suite and production build remain unverified. GitHub Actions runner allocation and Android browser/device integration are still outstanding; no live endpoint or deployment success is claimed.

## Market-data integrity follow-up

- Centralized IndexedDB schema creation in `src/adapters/nexus-database.ts` (version 2). Paper-account and market-cache adapters now use the same schema owner and close connections on version changes.
- Added regression specifications for both stores existing in the shared schema and concurrent opens.
- Added a market-quality rule and regression specification rejecting candle timestamps not aligned to the requested UTC interval.
- Local verification: strict TypeScript compilation passed for the shared database and both persistence adapters; an in-memory IndexedDB integration harness passed paper-account round-trip, market-cache round-trip and shared schema-version checks; a separate quality harness passed aligned/misaligned timestamp scenarios.
- Full Vitest and browser IndexedDB verification remain pending because the repository's GitHub Actions runner is not allocating a hosted runner.

## Walk-forward validation increment

- Added an expanding/rolling chronological fold generator with fixed out-of-sample test windows, configurable step size and embargo bars.
- Training, embargo and test segments are disjoint and ordered; only complete test windows are emitted. Input candles are validated and returned fold arrays/candle objects are frozen.
- Added 4 Vitest specifications covering expanding windows, rolling windows, invalid/short inputs, and immutability.
- Local TypeScript strict compilation passed for the fold generator. A deterministic Node harness passed 12 assertions.
- The fold generator partitions data only; strategy selection, parameter tuning, fold-level backtests and untouched final holdout evaluation remain future work. It does not eliminate data snooping, survivorship bias or regime shift.
- Full Vitest suite and production build remain unverified while GitHub Actions jobs fail before runner allocation.

- Walk-forward follow-up: added a regression check rejecting `stepBars < testBars`; overlapping out-of-sample windows would otherwise reuse test observations and overstate the number of independent evaluation windows. Local strict TypeScript compile passed and the updated deterministic harness passed 13 assertions.

## Walk-forward backtest integration

- Added `evaluateWalkForward`: each fold's strategy factory receives training candles only, then its returned evaluator is run against that fold's subsequent test candles using the existing next-open-fill backtester, fees, slippage and position sizing.
- Reports per-fold results plus mean fold return, sequentially compounded fold return, worst fold drawdown, completed trade count, total fees and trade-weighted win rate.
- Added 3 Vitest specifications for training/test separation, aggregate metrics and invalid strategy factories.
- Local strict TypeScript compilation passed for candles, backtest, fold generation and evaluation modules. A deterministic Node integration harness passed 10 assertions.
- The evaluation uses independent capital resets per test fold; compounded return is a summary, not a continuous pooled-account simulation. It remains long-only spot and does not model funding, borrow, partial fills, market impact, or cross-asset concurrency.
- GitHub Actions remains blocked before runner allocation. No hosted Vitest run, production build or deployment is claimed.

## Historical market-data storage increment

- Added bounded sequential Binance historical pagination using start/end timestamps, fixed-duration interval cursors, duplicate/non-progress protection and a hard per-call candle budget. Calendar-month pagination is excluded because month lengths vary; HTTP/rate-limit failures surface without retry loops.
- Added a dedicated IndexedDB historical candle store partitioned by symbol, interval and provider, with indexed series reads, timestamp upserts and inclusive time-range filtering.
- Upgraded the single shared IndexedDB schema to version 3, creating paper accounts, latest market snapshots and historical candles together.
- Added 4 Binance history pagination specifications, 4 candle-history store specifications and expanded shared-schema tests.
- Local verification: strict TypeScript compile passed for the shared database, paper-account store, market-snapshot cache and candle-history store. Deterministic Node harnesses passed 4 backfill scenarios and candle-history append/range/series-isolation checks.
- The backfill and storage functions are not yet exposed in a dashboard workflow. Full Vitest, Vite build, and real browser IndexedDB testing remain blocked/unverified.

## Walk-forward out-of-sample execution increment

- Extended the backtest engine with warm-up bars that provide historical indicator context but cannot generate/fill trades and are excluded from OOS equity curves.
- Extended the canonical `evaluateWalkForward` runner: a fresh strategy factory receives only each fold's training candles; embargo and training bars are warm-up only; each disjoint test window is independently backtested with a reset initial capital.
- Reports per-fold results, mean and sequentially compounded fold returns, worst fold drawdown, total fees/trades and pooled win rate. The separate strategy scorecard reports median/best/worst fold return, dispersion and trade-level net PnL; no result is presented as a continuous pooled-account equity curve.
- Added warm-up isolation coverage to the backtest and walk-forward evaluation specifications. Local strict TypeScript compile passed for backtest and walk-forward evaluation modules; deterministic harness passed warm-up isolation and 2 independent OOS folds.
- This is an evaluation framework, not an optimizer. Strategy selection and parameter search, multiple-testing accounting, and an untouched final holdout remain future work; walk-forward alone does not eliminate overfitting or regime shift.
- Full Vitest/build and hosted browser verification remain unverified because GitHub Actions still fails before runner allocation.

- Additional local verification after the warm-up edge-case fix: strict TypeScript compilation passed; deterministic walk-forward harness passed warm-up isolation, invalid empty-dataset warm-up rejection and three independent out-of-sample folds.

## Hybrid AI skill system increment

- Added six original agent skills for quant research, strategy engineering, backtest auditing, risk governance, skill evolution and market-data quality under `.agents/skills/`.
- Added evidence notes on supervised adaptive model training and an open-source reuse/licence audit. FreqAI's chronological retraining, versioned artifacts, warm-up and backtest replay are treated as design references only; no GPL code is copied.
- Added a hybrid learning/skill-governance policy: evidence-backed knowledge notes are the only potential auto-promotion scope; methodology, code, system, risk, qualification and execution changes require human approval.
- Added a typed governance module and 9 Vitest specifications for semantic version progression, evidence, score improvement, regression checks, changed-file classification, path traversal, immutable promotion and human approval.
- Local strict TypeScript compilation passed for the governance module; a deterministic Node harness passed 7 governance scenarios.
- This is an instruction and proposal framework, not an on-device LLM or self-training model. No model API or paid inference service is connected. Automatic promotion remains operationally disabled until a trusted evaluation runner and full CI suite are verified.


## Out-of-sample strategy scorecard increment

- Added a scorecard for chronological walk-forward evaluation: positive-fold share, mean/median/best/worst fold returns, fold-return dispersion, worst fold drawdown, completed-trade win rate, gross profit/loss, profit factor, net expectancy and fees.
- Profit factor is null when no losing trades exist; trade metrics are null when no completed trades exist. Open positions are excluded from completed-trade statistics. Fee-inclusive net PnL is not charged a second time.
- Added 4 Vitest specifications covering ordinary results, no-loss samples, no-trade samples and malformed trade values.
- Local strict TypeScript compilation passed for the scorecard and its backtest/walk-forward dependencies. A deterministic Node harness passed 12 assertions.
- This scorecard does not claim statistical significance or produce Sharpe/Sortino without a defined periodic return series and risk-free-rate convention. It does not remove multiple-testing, survivorship, market-impact or regime-shift risks.
- Full Vitest, production build, hosted CI and deployment remain unverified while GitHub Actions runner allocation is blocked by the account's failed payment authorization warning; no billing changes have been made.


## Causal market-regime research increment

- Added a causal trend/volatility classifier using SMA-seeded fast/slow EMA spread and Wilder ATR as a percentage of close. Warm-up values are explicitly unknown; thresholds are supplied configuration and are not fitted on the reported test window.
- Added regime-level walk-forward trade attribution. Because exits fill at the next candle open, each completed trade is attributed to the prior candle's regime, avoiding use of the exit candle's not-yet-known close/high/low. Missing exit timestamps fail closed; warm-up trades are counted as unclassified.
- Regime scorecard reports completed trades, win rate, fee/slippage-inclusive net PnL, gross profit/loss, profit factor and expectancy by trend × volatility bucket.
- Added 5 Vitest specifications for warm-up, causal prefix invariance, range classification, threshold validation, exit-regime attribution, and missing timestamps.
- No universal thresholds are assumed: values are instrument/timeframe-dependent and must be selected using training data only. The classifier is a research diagnostic, not a strategy signal or execution authorization.
- Full Vitest, production build and hosted CI remain unverified because GitHub Actions has not allocated runners; no billing settings or payment methods have been changed.

## Baseline strategy library increment

- Added deterministic SMA crossover, incremental Wilder RSI mean-reversion and prior-window Donchian breakout evaluators.
- Signals are close-based and contain no order-routing code; the existing backtester controls next-open fills, fees, adverse slippage and position sizing.
- Donchian thresholds explicitly exclude the current candle. RSI state updates incrementally and requires stable chronological history prefixes.
- Added 4 Vitest specifications for crossover behavior, RSI threshold crossings, Donchian look-ahead protection and parameter validation.
- Local strict TypeScript compilation passed for the strategy module; a deterministic harness passed SMA buy/sell, RSI buy/sell and Donchian breakout scenarios.
- These are unoptimized research baselines. No strategy is auto-selected or connected to paper execution.


## Reproducible multi-strategy research pipeline increment

- Added `runResearchBatch`, which validates candidate identities and runs each candidate through identical chronological walk-forward folds, execution assumptions and regime configuration.
- Each candidate receives a fresh factory invocation per training fold. The output includes the full walk-forward evaluation, aggregate scorecard and regime scorecard, plus dataset timestamp bounds and the shared experiment configuration.
- Added a baseline candidate catalog for SMA crossover, Wilder RSI mean reversion and Donchian breakout. Parameter values are explicit and encoded into candidate IDs; evaluator state is recreated per fold.
- Added 5 Vitest specifications covering candidate comparability, separate results, non-mutation, duplicate IDs and baseline catalog validation.
- Added `docs/RESEARCH_PIPELINE.md` with architecture, controls and illustrative usage. The pipeline deliberately does not rank, optimize, auto-select, promote or execute strategies.
- No curated historical experiment has been run yet. The example parameters are illustrative, not calibrated or evidence of an edge. Dashboard integration, final untouched holdout and expanded execution-cost modelling remain outstanding.
- Full Vitest and production build remain unverified because GitHub Actions still fails before runner allocation; no billing or payment settings have been changed.

## Reproducible multi-strategy research pipeline increment

- Added a research-batch runner that evaluates multiple candidate strategy factories on identical chronological walk-forward folds, warm-up rules, costs, slippage and sizing assumptions.
- Each candidate returns a walk-forward evaluation, trade/fold scorecard and regime attribution. Candidate factories are re-created per fold and receive training data only.
- Candidate IDs must be versioned when logic or parameters change. Dataset metadata now includes a deterministic 32-bit FNV-1a fingerprint for reproducibility (not cryptographic integrity).
- The pipeline does not rank, tune, select, promote or execute candidates.
- Added 3 Vitest specifications for identical fold windows, candidate validation, input immutability and dataset fingerprint sensitivity.
- Local strict TypeScript compilation passed for the research pipeline and all imported domain modules. Full Vitest and production build remain unverified because hosted Actions runners are not allocated.


## Mobile research console increment

- Added a dashboard console for symbol, interval, history length, training/test window, fee and slippage configuration. It fetches bounded completed public Binance spot candles and runs the three baseline candidates through the reproducible research pipeline.
- Results display per-candidate out-of-sample returns, worst fold drawdown, trade count, win rate, profit factor, net expectancy, positive-fold share, fees, regime breakdowns and individual fold details.
- Added a dataset fingerprint to help identify repeat experiments. It uses non-cryptographic FNV-1a and is not an authenticity or integrity security control.
- Added validation tests for research-run settings and a maximum 40-fold workload cap to limit CPU/memory use on mobile devices. Historical requests are bounded to 5,000 candles; no API keys are required.
- Console currently runs experiments in memory and does not persist reports. No curated dataset, live market fetch, browser runtime, full Vitest suite or production build has been verified in this environment.
- GitHub Actions account billing warning remains unresolved; no payment method, paid runner or spending limit changes were made.


## Research persistence and strategy-config governance increment

- Upgraded the shared IndexedDB schema to version 5 with a research-run store and strategy configuration ledger; existing paper account, market snapshot and candle history stores are retained.
- Added local research report persistence, newest-first history listing, reopening and deletion. Saved reports preserve full fold results, metrics, regime attribution, dataset fingerprint and execution configuration.
- Added a typed strategy-config proposal validator. Proposals require semantic version progression, finite explicit parameters, source-backed evidence, a named improved evaluation metric, passing tests and zero regressions.
- Added immutable approved strategy-config version records requiring an explicit human identity, rationale and timestamp. Proposal and approved version entries are append-only IndexedDB records; duplicate record IDs fail instead of overwriting.
- Added 3 research-run store tests, 2 strategy config ledger store tests, 4 governance tests and shared schema assertions. These specifications are committed but not executed in a dependency-installed environment.
- No LLM is connected to generate recommendations, no approved configuration is automatically applied to strategy code or paper trading, and no live execution permission can be granted by this workflow. Browser-local data has no cloud backup and may be lost if site data is cleared.
- Full Vitest, production build, hosted CI and Android browser integration remain unverified because GitHub Actions runner allocation is blocked by the account billing authorization warning. No payment method, paid runner or spending limit changes were made.


## Research history comparison and provenance follow-up

- Added two-run comparison by stable candidate ID, including deltas in compounded out-of-sample return, worst-fold drawdown, trade count, win rate and positive-fold share.
- Comparisons are certified as apples-to-apples only when dataset fingerprint, candle count, timestamp bounds, market symbol, interval, provider and complete walk-forward/execution configuration match. Legacy reports without market provenance fail closed.
- Research reports now record market symbol, interval and public data provider in their dataset metadata. The fingerprint remains a non-cryptographic FNV-1a identifier and is not proof of data authenticity.
- Added 4 comparison specifications including market mismatch and missing-provenance rejection. These tests are committed but not run because the dependency-installed test environment is unavailable.


## Evidence-led research agent foundation

- Added a typed hypothesis model that requires a falsifiable question, rationale, target strategy, explicit experimental variables, a primary metric, guardrail metrics and source-backed claims.
- Evidence provenance supports experiment, paper, documentation, code, exchange-data, community and opinion. Opinions are retained but do not count toward readiness; at least two distinct non-opinion evidence types are required before a hypothesis is marked ready for experiment design. This is a provenance floor, not automated source validation.
- Hypotheses encode mandatory same-data control/candidate comparison, walk-forward testing, fees/slippage, untouched final holdout and no automatic promotion.
- Added an append-only local IndexedDB hypothesis ledger and schema version 6; added domain and storage test specifications. Tests remain unexecuted due unavailable CI runner.
- No autonomous web research, LLM inference, GitHub skill installation or automatic experiment execution is connected. The dashboard does not yet expose hypothesis creation. No paid APIs or credentials are used.


## Skill Intelligence foundation

- Added a typed external-skill catalogue with repository/version/licence/maintenance/engagement/capability/test/documentation/security/provenance metadata.
- Newly discovered entries are quarantined by default. Review eligibility requires an allowlisted MIT/Apache-2.0/BSD licence, a commit within 365 days, valid metadata, documented capabilities, verified tests and documentation, a completed security review and source provenance.
- Added explicit human approval with reviewer identity, rationale and timestamp. Approval creates a separate versioned record; the original discovery record is not overwritten.
- Added IndexedDB skill registry storage in shared schema version 7. The adapter accepts only non-executable review records and rejects duplicate IDs.
- Hard boundary: even approved catalogue entries remain non-executable. No external source is downloaded, installed, imported or run. Automated GitHub discovery, isolated code testing, LLM skill authoring and UI controls remain future work.
- Added domain specifications for quarantine defaults, licence/security eligibility, invalid metadata and human approval. The tests are committed but not run; GitHub Actions runner allocation remains unresolved and the dependency-installed full test/build pipeline is still unverified.
- See `docs/SKILL_INTELLIGENCE.md` for trust boundaries and review checklist.


## External trading research and curated skill catalogue

- Queried GitHub repository metadata and default-branch commit history for nine trading systems/libraries: FinRL-X, Jesse, LEAN, Hummingbot, FinRL, Freqtrade, NautilusTrader, vectorbt and backtesting.py. Recorded observed licence, stars, open issues and latest commit date in `src/domain/skill-catalogue.ts`; snapshot date 2026-11-14.
- Added nine source-pinned, metadata-only catalogue entries. All remain quarantined; tests, documentation verification and security review are deliberately unset until the exact revisions and dependency trees are inspected. No external source code was cloned, installed or executed.
- Licence policy currently excludes GPL-3.0, LGPL-3.0 and AGPL-3.0 from code adoption; vectorbt remains quarantined because GitHub reports NOASSERTION. These remain research references only, not trusted dependencies.
- FinRL-X (Apache-2.0) is the strongest architecture reference for composable selection/allocation/timing/risk overlays and target-weight contracts. Jesse (MIT) is the strongest crypto-research reference for rule significance testing, Monte Carlo analysis and research API workflows. LEAN (Apache-2.0) is a reference for modular event-driven system boundaries. No framework is imported wholesale.
- Added original NEXUS agent skills: statistical-strategy-validation and portfolio-intent-architecture. Both are advisory methodology; neither can change risk rules or execute trades.
- Added `docs/EXTERNAL_TRADING_RESEARCH.md` with the candidate matrix, adoption decisions, limitations and source links.
- Added catalogue tests for quarantine defaults, licence retention and unverified test/docs/security state. Tests are committed but not executed; full CI and build remain unverified due runner allocation restrictions.


## Mobile skill review console increment

- Integrated the curated external trading catalogue into the dashboard with a mobile-responsive registry view showing repository, pinned revision, reported licence, maintenance date, stars, open issues and claimed capability areas.
- Added local IndexedDB seeding that skips existing source IDs, preserving reviewed records. The console supports human approval only after the reviewer explicitly attests that they inspected the pinned revision's tests, documentation and security/dependency posture; reviewer identity and rationale are required.
- Added explicit rejection records with reviewer identity, rationale and timestamp. Original discovery entries are retained; decisions create separate versioned records.
- Added the missing FinRL-X catalogue candidate (Apache-2.0, pinned metadata snapshot) to reconcile the nine-project research inventory with the seed catalogue and existing catalogue test.
- Approval and rejection remain metadata-only. Every record has `executable: false`; the app never clones, installs, imports or runs external repository code. A checkbox attestation is a human assertion, not independent verification by NEXUS.
- Added rejection-governance tests. Existing catalogue test already checks FinRL-X inclusion. Tests, full Vitest suite, production build and Android browser interaction have not been executed in this environment. GitHub Actions runner allocation remains the verification blocker; no billing changes have been made.


## Pinned upstream source review and causal regression tests

- Inspected Jesse at `9afc357a5675a44b31dbf5d7c5244112a2c262cb`: selected backtest/exchange code and tests for candle execution cutoffs, gap-through stop/take-profit fills, fee-inclusive PnL, signal significance and moving-block bootstrap candle validity. Findings and limitations are recorded in `docs/EXTERNAL_SOURCE_REVIEW_2026-11-14.md`.
- Inspected FinRL-X at `4409abe925c904e570be78ebfb5e77ac3491dff8`: target-weight backtest interface, proportional commissions, point-in-time data slicing, walk-forward runner and stop-loss manager. Critical finding: the inspected walk-forward runner generates strategy outputs from training slices but does not itself execute the subsequent test windows; the backtest wrapper does not explicitly lag target weights to next-bar execution. This is not accepted as NEXUS OOS proof.
- Upgraded Jesse and FinRL-X catalogue revision pins to full immutable commit SHAs. Both remain quarantined; no upstream code or dependencies were copied, installed or executed.
- Added NEXUS regression specifications asserting that strategy evaluators receive only immutable history through the current close, and that walk-forward train/embargo timestamps remain strictly before each test window.
- Existing NEXUS tests already specify next-candle-open fills and two-sided fee/adverse-slippage accounting. Gap-through-stop execution is not yet a NEXUS feature; it requires a separately designed stop-order model rather than pretending a simple close-signal engine supports it.
- Tests are committed but have not been executed. Full Vitest, production build, browser integration and CI remain unverified; no paid runner or billing change was made.


- Latest Pages workflow run for commit `1bc618a324927b591c0a7087e59cf680608c2e9f` (run `43513945778`) completed with failure before exposing any job steps or logs. Deployment remains unverified; the failure cause cannot be diagnosed from the available GitHub job metadata.

## Gap-aware protective-order backtest increment

- Added optional long-only stop-loss and take-profit orders to the deterministic spot backtester; disabled unless explicitly configured.
- Protective orders activate only from the candle after entry, avoiding ambiguous entry-candle high/low ordering.
- Stop-market gaps fill at the opening price with adverse slippage and fees. Intrabar stop fills use the stop level plus adverse slippage. Take-profit limits fill at target or a better opening price on a gap up; fees apply and adverse market slippage does not.
- When both stop and target are touched intrabar, the simulator selects the adverse stop because OHLC data cannot reveal the path. Strategy-generated next-open exits retain priority.
- Trade ledger now records whether the exit was a strategy signal, stop-loss or take-profit.
- Added focused resolver and backtest integration specifications for intrabar triggers, stop gaps, target gaps, both-level ambiguity, fee/slippage treatment and entry-candle exclusion.
- Added `docs/PROTECTIVE_ORDER_MODEL.md` describing assumptions and execution-model limitations.
- These tests have been committed but not executed. Full Vitest, production build, hosted CI and deployment remain unverified. No billing changes or live execution capability were introduced.
## Protective-order verification update

- Local strict TypeScript compilation passed for the candle, protective-order and backtest domain modules.
- A standalone deterministic Node harness passed 9 assertions covering stop/target trigger resolution, stop and target gaps, adverse intrabar ambiguity, fee/slippage accounting, entry-candle exclusion and invalid configuration rejection.
- The first harness pass exposed a floating-point equality issue in the 10% target calculation; the level calculation was corrected and the harness then passed. The integration test's expected stop fill was also corrected to include both entry and exit slippage.
- This is not a Vitest or full-project build result. GitHub Actions runs 43517203022 (CI) and 43517203000 (Pages) failed before runner allocation: runner ID 0, empty runner name, zero steps. Cause remains unknown; no billing changes were made.


## Dependency security and execution-cost model increment

- Upgraded Vitest from the vulnerable 3.x line to 5.1.0. GitHub Actions npm audit reports zero vulnerabilities; CI and Pages workflows now enforce `npm audit --audit-level=moderate` before tests/build.
- Added a deterministic, pure execution-cost resolver that estimates adverse half-spread, baseline slippage and linear participation-scaled market impact; caps one-candle fill quantity at configured participation of candle volume; and reports partial/unfilled quantity and fee only on executed notional.
- Added tests for buy/sell price direction, partial fills, zero liquidity, fee treatment, impact scaling and invalid inputs.
- Added `docs/EXECUTION_COST_MODEL.md` with the assumptions and explicit boundaries.
- This is a standalone domain increment only. The existing backtest and paper broker are not yet wired to it; integrating residual-order lifecycle and partial position accounting is a separate follow-up.


## Partial-fill execution lifecycle integration

- Added a canonical open-order list to the paper account contract and a separate paper broker lifecycle API: submit, execute against subsequent candles, carry residual quantities and explicitly cancel remaining quantity.
- The paper broker shares the spread/slippage/impact resolver, caps aggregate per-symbol candle participation, charges fees only on fills, updates fee-inclusive weighted-average entries, and realizes P&L only on executed sell quantity. Existing IndexedDB snapshots naturally persist the new order list; legacy accounts without it should be initialized through the account migration/recreation path before calling the new API.
- Added paper lifecycle tests for pending orders, partial entries, partial exits, zero-volume candles and cancellation. Paper broker integration passed the 170-test suite and strict production build before merge.
- Added `runExecutionAwareBacktest`, preserving the existing `runBacktest` API. The new mode executes next-candle-open orders against candle volume, carries partial fills, accounts for fees and average entry cost, and only records completed trades when the position is fully closed.
- Added 4 execution-aware backtest specifications. Latest PR CI passed 174 tests across 35 files, npm audit (0 vulnerabilities) and strict TypeScript/Vite production build.
- Both changes remain paper/historical simulation only. The legacy backtest and existing UI/research console have not yet been switched to the new execution-aware function; protective stop/target orders are not yet supported in that mode. See `docs/PAPER_PARTIAL_FILL_LIFECYCLE.md` and `docs/EXECUTION_AWARE_BACKTEST.md`.


## Research pipeline execution-model integration

- Walk-forward evaluation can now explicitly select the shared execution-aware backtester per fold. Legacy behavior remains the default when no execution model is configured.
- Research reports persist the full execution model, allowing comparison logic to detect different fill assumptions.
- Mobile research console runs each candidate set twice on the same fetched candles and fold schedule: legacy immediate fills and execution-aware partial fills. Results are rendered side by side and both reports are saved locally.
- Execution assumptions are configurable in the console: fees, base slippage, half-spread, maximum candle-volume participation and market impact at the cap.
- Strategy scorecards expose fill events, partial-fill events, folds with open positions, folds with pending orders and aggregate unfilled quantity. Open inventory and pending remainder are explicitly not completed trades.
- Full CI verification on the feature branch: 35 test files passed, npm audit reported 0 vulnerabilities, and strict TypeScript/Vite production build passed.
- Remaining limitations: UI layout has build/unit verification but no real-device browser E2E verification in this change; candle-volume liquidity is a coarse proxy, the model is long-only, and protective stop/target orders are not yet supported by the execution-aware path.


## Execution-aware protective-order integration

- Integrated optional long-only stop-loss and take-profit orders into `runExecutionAwareBacktest`; the legacy `runBacktest` API remains unchanged.
- Stop exits use the shared market execution resolver, including participation-scaled impact, adverse spread/slippage and fees. Stop residuals continue as market orders.
- Take-profit exits use limit semantics. Partial residuals retain their original limit price and cannot fill on a later candle unless its high reaches the limit; opening gaps above the target receive price improvement. Fees apply to executed quantity.
- Once a protective exit is triggered, an opposing strategy signal cannot cancel its residual order. Protective exits are not retriggered while an exit remainder is pending.
- When both protective levels are touched in one candle, the existing resolver selects the adverse stop. Protective orders activate only after the entry candle.
- Added integration tests for stop execution costs, target limit fills, partial stop/target exits, untouched target limits, target gap improvement, stop/target collisions and protection against strategy-signal cancellation.
- The branch has a successful full CI run on commit `882355b`: 183 tests, zero reported dependency vulnerabilities, and strict TypeScript/Vite production build. A subsequent regression test for strategy-signal cancellation has been added and requires a fresh passing CI run before merge.
- Historical simulation only. Candle volume is a liquidity proxy; queue position, order-book depth, latency and actual intrabar price paths are not modelled. No live order routing is enabled.


## Protective exits integrated into research (2026-11-14)

- Propagated optional protective stop-loss and take-profit settings from walk-forward research configuration into the execution-aware backtester for every out-of-sample fold; removed the previous unsupported-combination rejection.
- Extended the mobile research console with independent optional stop-loss and take-profit percentage inputs. Empty fields disable that order; values are validated before research starts.
- Preserved protective-order settings in each run's stored configuration. Strict research-run comparison treats changes to stop/target assumptions as non-comparable.
- Added stop-loss and take-profit exit counts to candidate result metrics.
- Added regression tests for walk-forward protective execution, console configuration, report configuration persistence and mismatch rejection.
- GitHub Actions verification for PR #14: dependency installation, dependency security audit, full Vitest suite and production build completed successfully. Final workflow completion is pending.
- Historical research only; no exchange routing or live execution introduced.


## Protective-exit sensitivity research (2026-11-14)

- Added a bounded Cartesian stop-loss/take-profit sensitivity runner. It always includes a disabled baseline, rejects invalid/duplicate values, and caps the grid at 25 scenarios for mobile resource control.
- Every scenario reuses the same candle dataset, candidate definitions, walk-forward folds, allocation and execution assumptions. It does not rank or automatically select parameters.
- Exposed the grid in the mobile research console using the last fetched dataset. Each scenario report is saved locally and displays OOS return, worst-fold drawdown, profit factor, completed trades, fees, positive-fold share, stop/target exit counts and pending quantity.
- Added an explicit selection-bias warning: choosing the best parameter on these same OOS folds invalidates an unbiased performance claim. Nested walk-forward selection or a final untouched holdout is required.
- Corrected a pipeline defect discovered during integration: the research batch stored the execution model in its report but did not pass it to walk-forward evaluation; execution-aware research now uses the configured fill model in every fold.
- Historical paper research only. Candle volume remains a liquidity proxy; no live routing or paid services added.


## Nested walk-forward parameter selection (2026-11-14)

- Added candidate-specific nested selection for protective stop-loss/take-profit settings. Each outer fold performs its bounded parameter grid only on the outer training slice, then freezes the chosen settings before evaluating the untouched outer test window.
- Inner selection uses compounded inner OOS return, with lower worst-fold drawdown as a tie-breaker. Exact ties preserve the disabled-baseline-first scenario order.
- Added a minimum inner completed-trade eligibility threshold. If no scenario meets it, the disabled protective-exit baseline is retained rather than selecting a no-trade or under-sampled configuration.
- Reports separate inner selection metrics from outer test metrics, selected parameters per outer fold, aggregate outer returns/drawdown/trades, profit factor, expectancy, fees, completed turnover, average exposure, stop/target exits, fill events, pending quantity and parameter stability.
- Added a mobile console action with an eight-outer-fold cap, existing 25-scenario grid cap and configurable minimum inner trade count.
- Added regression specifications for training/test separation, invariance of a fold's selection to changes in that fold's outer test data, baseline fallback, invalid fold geometry and separation of inner/outer metrics.
- See `docs/NESTED_WALK_FORWARD_SELECTION.md` for the protocol and limits.
- GitHub Actions run #104 passed on commit `d6c1ca6563545997571d9ceb3864d35cf558e55b`: 198 tests across 37 files, dependency audit with 0 vulnerabilities, strict TypeScript compilation and Vite production build. PR #16 is ready for merge. No live trading, exchange credentials, paid services or billing changes introduced.


## Nested research report persistence (2026-11-14)

- Added a dedicated IndexedDB object store `nestedResearchRuns` under schema version 8; existing research batch history remains isolated and unchanged.
- Nested runs now persist the complete outer-fold report, selected settings, parameter-stability data, inner/outer metrics, market metadata and exact nested configuration.
- The mobile research console saves successful nested runs automatically, lists the newest 50, supports reopening a full report after reload and allows individual deletion.
- Records remain local to the device/browser profile. Clearing site data or browser storage can remove them; this is not cloud backup or cross-device sync.
- Added adapter tests for complete round-trip persistence, newest-first ordering, immutable read copies, deletion isolation and invalid payload rejection, plus database schema tests.
- PR #17 merged into `main`; PR CI passed 203 tests across 38 files, dependency audit reported 0 vulnerabilities, and strict TypeScript/Vite production build passed. Main CI #110 and Pages deployment #27 also passed.
- No paid services, billing changes, exchange credentials or live execution introduced.


## Mobile workspace sidebar and help (2026-11-14)

- Fixed a rendering defect where the grouped navigation element was created but never appended to the sidebar.
- Sidebar now exposes all seven workspace destinations across Workspace, Research, Automation and Controls groups.
- Page-level and panel-level question-mark buttons open touch-friendly explanatory popovers with accessible expanded state.
- PR #21 merged to main. CI passed 207 tests across 39 files, dependency audit, strict TypeScript and production build. GitHub Pages deployment run #43535990267 for PR #21 merge commit `761c4667208b356f56213ef5d54e29dfa344c169` completed successfully. The later PR #22 automation and PR #23 paper-agent changes are now included in Pages deployment run #43537370072 on main commit `b4ec6b4da288283190fdfdd35ace48b5f6d7b9a2`.
- No real-device Android browser E2E suite exists yet; manual Galaxy A55 verification is still required.


## Scheduled and AI-assisted candidate research (2026-11-14)

- Added a daily 00:15 UTC GitHub Actions research workflow plus manual dispatch. It fetches up to 1,500 completed BTCUSDT 1-hour candles and evaluates candidates using expanding walk-forward folds with a 2-bar embargo.
- Generates 16 deterministic variants across SMA crossover, RSI mean-reversion and Donchian breakout families. Optional Groq inference can propose up to four more bounded parameter candidates using strict JSON schema output; no generated code is executed.
- Candidate backtests include configurable fee, slippage, half-spread, participation and market-impact assumptions. The full versioned report is uploaded as a 30-day GitHub Actions artifact.
- AI inference is optional and requires the user to create a Groq API key and add it as the repository Actions secret `GROQ_API_KEY`. Without it, deterministic research still runs.
- PR #22 merged to main as `5aee08405babd25266bd4834c105f5515f1cb89e`. PR CI passed 217 tests across 43 files, dependency audit, TypeScript checking of the scheduled runner and production build.
- This phase does not auto-promote strategies, place paper orders or enable live trading. The automation workflow's first manual/scheduled run still needs to be executed and its artifact inspected. No paid plan or billing activation is required.


## Persistent automated paper trading (2026-11-14)

- Added a checkpointed long-only paper account engine. It processes only candles newer than the persisted checkpoint, reconstructs stateful strategy evaluators from available history, and is idempotent on replay.
- Signal orders fill at the next candle open with fee, adverse slippage, spread, market impact and candle-volume participation limits. Partial fills and pending orders persist between runs.
- Added bounded fill/trade/equity history, persisted-state validation, max position allocation and a daily loss lockout for new entries. The loss lockout does not force liquidation.
- Added hourly GitHub Actions workflow at five minutes past each UTC hour. It writes checkpoints to a separate `nexus-paper-ledger` branch and uploads a 30-day report artifact.
- The ledger config is disabled by default. It requires a human approver, rationale, approval timestamp, exact reviewed strategy ID and parameters. No strategy is auto-selected or promoted.
- PR #23 merged as `b4ec6b4da288283190fdfdd35ace48b5f6d7b9a2`. CI passed 224 tests across 44 files, dependency audit, strict TypeScript checks for both scheduled runners and production build. Pages deployment run #43537370072 passed.
- The paper workflow has not yet been manually dispatched. Its first run will report disabled and place no simulated orders until a human-approved config is supplied.
- PR #25 adds optional protective stop/target exits to the continuous paper agent, including adverse stop execution, persistent target limits, partial remainders and adverse stop/target collision resolution. No live exchange routing, exchange keys, paid services or billing activation.


## Paper-ledger configuration fingerprint (2026-11-14)

- Persisted paper checkpoints now include a SHA-256 fingerprint covering market, interval, human approval metadata, strategy parameters and all risk/execution settings.
- Any configuration drift halts the worker rather than silently changing strategy or risk assumptions mid-run.
- PR #24 merged as `9e90e36840bfaaef36b8891c0fcb1dcf7b8d4b88`; CI passed 225 tests across 44 files, strict TypeScript checks and production build.


## Protective exits in automated paper trading (2026-11-14)

- Added optional stop-loss and take-profit support to the checkpointed paper agent.
- Stop-losses use adverse market execution; partial stop remainders continue as market orders.
- Take-profit exits use limit semantics, retain target price across partial fills and receive opening-gap price improvement.
- Stop/target collisions resolve to the adverse stop; protective orders activate only after the entry candle and block same-candle re-entry.
- PR #25 merged as `19bce2448fa08c98d005e8086d7185f15f62b03f`; CI passed 229 tests across 44 files, dependency audit, strict TypeScript checks and production build.
- Pages deployment run #43537960917 for main commit `339ca4359c56eeef6c17c0aeec9767bef0f94a3b` includes the PR #25 paper-agent UI. PR #26 help-copy fix is deployed in run #43538234649 on main commit `e13e62c91a2c39719d3db8af0c2d01e11958ca86`.


## Automation help copy (2026-11-14)

- PR #26 updated the Automation page help text to accurately describe optional Groq AI proposal generation, human approval for paper trading and disabled live trading.
- CI passed 230 tests across 44 files, dependency audit, TypeScript checks for both scheduled runners and production build.
- PR #26 merged as `e13e62c91a2c39719d3db8af0c2d01e11958ca86`; GitHub Pages deployment run #43538234649 completed successfully.
