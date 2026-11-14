# NEXUS Strategy Creation Studio

## Scope

The Strategy Studio creates deterministic, machine-readable strategy definitions. It is a research authoring surface, not an execution approval surface.

## Versioned strategy contract

Each definition contains:
- schema version;
- lowercase kebab-case strategy ID;
- semantic version (MAJOR.MINOR.PATCH);
- display name and description;
- strategy family and exact family-specific parameter object;
- creation timestamp and origin (human, template or ai-proposal).

Definitions are validated and detached before being deeply frozen. A saved ID/version is append-only; changing parameters requires a new semantic version. The IndexedDB library is local to the current browser/device and is not cloud-synced.

## Available templates

| Family | Parameters | Validation |
|---|---|---|
| SMA crossover | fastPeriod, slowPeriod | Fast 2–100; slow 3–300; fast less than slow |
| RSI mean reversion | period, oversold, overbought | Period 2–100; oversold 5–45; overbought 55–95; oversold less than overbought |
| Donchian breakout | period | Period 2–300 |

These templates reuse existing deterministic baseline evaluators. They do not introduce new predictive claims or external code execution.

## Research integration

Saved human-authored definitions are reloaded from the local strategy library and included as candidates in the next historical walk-forward research batch. Candidate IDs include the exact strategy ID and version. AI-origin proposals are not included in research until a human explicitly approves them in the AI Strategy Proposal Inbox. The current import accepts the versioned JSON report emitted by the scheduled Automated Research GitHub Actions workflow.

## AI-led strategy generation and review

NEXUS, not the user, is intended to generate the strategy candidates. The scheduled **NEXUS Automated Research** workflow requests 1–4 bounded proposals from the configured provider-neutral AI route using recent BTCUSDT 1h market context. It compiles only the reviewed SMA crossover, RSI mean-reversion and Donchian breakout templates, merges them with deterministic candidates and evaluates all candidates on the same dataset and walk-forward execution-cost assumptions.

The workflow uploads `automated-research.json` as a GitHub Actions artifact for 30 days and publishes a sanitised proposal-only JSON feed to the dedicated public `ai-proposals` branch. In Strategy Studio, tap **Refresh latest AI proposals** to load the latest scheduled feed directly. The feed contains only status, timestamp, symbol/interval, provider/model and bounded proposal parameters/rationales—not the full report, raw provider response or secrets. The file-import route remains a fallback if the feed has not yet been seeded or is unavailable. The first feed is created after the next successful scheduled or manually dispatched **NEXUS Automated Research** workflow.

The inbox validates artifact schema, provider identity and every proposal's family/parameter bounds. It shows the AI rationale and parameters. Each proposal has an explicit **Approve and save strategy** action. Approval creates an immutable strategy version with `origin: human`; this is the only path by which that AI proposal enters the saved strategy library and normal historical research. Import alone does not save or approve anything.

This is currently AI-led parameter discovery inside three reviewed strategy families—not unrestricted generated code or arbitrary new strategy logic. The user reviews candidates; they do not need to invent them. The full scheduled report artifact is temporary (30 days), so download and keep it if its research metrics matter. The proposal-only feed is retained on the dedicated branch until replaced by a later successful run. Provider API credentials remain server-side in GitHub Actions secrets and are never exposed to the PWA. The proposal feed is public because this is a static GitHub Pages app; it must never contain account data, secrets or full raw model output. AI provider access is optional and can fail or be rate-limited; deterministic research continues without AI.

## Parameter trials

The buildStrategyParameterTrials function produces a deterministic Cartesian grid:
- keys are canonicalized for stable ordering;
- duplicate, non-finite and invalid combinations are rejected;
- the full trial count is known before generation;
- maximum 25 trials per call for mobile resource control;
- every trial receives a unique immutable strategy identity;
- the manifest includes generator version, base ID/version, all trial IDs and the parameter grid.

The Strategy Research console exposes this workflow: select a saved human-authored definition, edit the JSON grid, preview the generated IDs/count and then run the normal walk-forward research batch. Family-specific example grids are loaded when the selected strategy changes. The selected base candidate is replaced by its variants for that run; other baseline and human-authored candidates remain. Both legacy and execution-aware reports retain the exact trial manifest, and saved experiment history displays the trial count and base ID/version after reload.

Selecting the best of multiple trials on the same out-of-sample sample creates multiple-testing/selection bias. Use nested walk-forward selection or a fresh sealed holdout for independent confirmation. Trial generation does not automatically select or promote a winner.

## Explicit non-goals

- No paper or live orders are created by saving a definition or running research.
- No risk limit, qualification rule, approval or permission is modified.
- No AI-generated code is executed.
- No unreviewed AI proposal is admitted to research; explicit user approval is required.
- No strategy is promoted based on a leaderboard or a single historical result.

## Storage and recovery

Strategy definitions are stored in the strategyLibrary IndexedDB object store (database schema v12). They are device-local. The Strategy Studio now provides a separate strategy-library backup: download all versions, then select the matching file on another NEXUS installation and review the preview before confirming restore. Restore is additive and idempotent: identical versions are skipped, conflicting content blocks import, and no saved version is overwritten. The backup is a checksummed but unencrypted JSON file.

Research-run reports and their parameter-trial manifests are still not included in backup files. Nested research, sealed holdouts and other local ledgers also remain outside the current backup formats. Clearing browser site data can erase those unbacked-up records; keep independent backups of the strategy library and decision/paper data.