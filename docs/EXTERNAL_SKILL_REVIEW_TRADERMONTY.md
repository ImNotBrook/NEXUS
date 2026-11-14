# External skill review: tradermonty/claude-trading-skills

Review date: 2026-11-14  
Repository: https://github.com/tradermonty/claude-trading-skills  
Reviewed branch: `main`  
Observed commit: latest default-branch commit dated 2026-11-14 (metadata snapshot)  
GitHub licence: MIT  
Observed metadata: 4,181 stars, 866 forks, 81 open issues; Python; repository size 73,963 KB.

## Verdict

**Do not install or vendor the repository wholesale. Do not add it as a runtime dependency or submodule.** It is a substantial Claude-oriented Python skill/workflow ecosystem, not a lightweight TypeScript module or drop-in crypto trading engine. Its size, Python dependencies, CLI conventions and Claude-specific integration would add operational and maintenance cost to NEXUS's Android-first static PWA.

The project is nevertheless a strong source of methods and workflow ideas. It explicitly treats trading as a repeatable decision process rather than handing buy/sell decisions to AI. Its canonical `skills-index.yaml` and YAML workflow manifests make dependencies, gates and artifacts explicit. MIT permits reuse subject to licence notices, but no source code has been copied.

Stars and recent commits are maintenance/popularity signals, not evidence of profitability or correctness. The upstream README also describes a toolkit for long-term equity investors and swing traders, not fully automated crypto trading. Some workflows depend on paid FMP/FINVIZ or broker integrations.

## Useful ideas and NEXUS fit

| Upstream capability | What is valuable | Existing NEXUS overlap | Decision |
|---|---|---|---|
| `strategy-pivot-designer` | Detects parameter-tuning plateaus, overfit, cost defeat or tail-risk problems; proposes structural alternatives using assumption inversion, archetype switch and objective reframing | NEXUS has bounded AI parameter proposals and research/backtest pipelines, but currently only three strategy families | **High-value future port.** Add a small deterministic stagnation detector and structured pivot proposals after the current research evidence loop is operational. Do not import Python scripts. |
| `crypto-regime-analyzer` | Six-factor crypto posture: BTC trend, alt breadth, BTC dominance, perp funding, drawdown/volatility and momentum | NEXUS has market-regime logic and BTC market data, but does not yet establish broad alt breadth/dominance/funding coverage | **Potentially valuable, later.** First add provenance-checked public data adapters and missing-component handling. Do not add an unvalidated heuristic score directly to trading permissions. |
| `drawdown-circuit-breaker` | Daily/weekly/monthly loss controls, consecutive-loss cooldowns, data-quality halts and explicit recovery windows | NEXUS paper agent currently has a daily loss lock and position cap | **Strong risk backlog item.** Review weekly/monthly drawdown and losing-streak controls. Any changes require deterministic tests and human approval. |
| `pre-trade-discipline-gate` | Written plan, predefined stop, sizing and upstream regime/circuit-breaker checks | NEXUS already requires human approval of exact paper strategy/risk configuration and uses deterministic broker validation | **Do not duplicate now.** Revisit if a manual trade-planning workflow is added. |
| `trader-memory-core` + `trade-memory-loop` | Thesis lifecycle, postmortems, MAE/MFE, closed-trade lessons and monthly review | NEXUS already has research hypothesis, run, config and paper-ledger stores; trade journal/postmortem lifecycle is not yet complete | **Selective future port.** Reuse lifecycle/artifact concepts, not YAML/Python state machinery. |
| `dual-axis-skill-reviewer` | Deterministic quality scoring plus optional LLM review, with the deterministic axis assessing structure, workflow, execution safety, artifacts and tests | NEXUS has skill intelligence metadata, quarantine and approval governance, but no complete automated skill quality scorecard | **Good lightweight candidate.** Add a deterministic metadata/test/security score first; make LLM review optional and advisory. |
| Workflow manifests + canonical index | Explicit required/optional skills, ordered steps, decision gates, produced/consumed artifacts, replay fixtures | NEXUS currently has task-specific GitHub workflows and docs, but no general skill workflow manifest system | **Adopt the schema concept only if multi-step agents expand.** Avoid building a second orchestration engine now. |
| Data-quality checker | Deterministic validation of output documents and market-data assumptions | NEXUS has OHLCV schema and market-data quality gates | **No immediate import.** Extend existing validators rather than create a parallel checker. |

## Specific observations

### Strategy pivots are the most distinctive research idea

The upstream skill does not simply ask an LLM to tweak parameters. It first diagnoses whether iteration has stagnated, then considers changing the strategy's structure. This addresses a real weakness in NEXUS's current candidate generator: parameter variants within SMA/RSI/Donchian can explore a narrow region while repeatedly optimising the same premise.

A future NEXUS port should:
1. Diagnose plateau, unstable folds, high in-sample/low out-of-sample gap, transaction-cost defeat, tail-risk breach and insufficient sample size.
2. Return `review_required` when metrics or trial history are incomplete.
3. Generate at most a small number of typed structural hypotheses from a reviewed catalogue.
4. Preserve the original strategy and trial history.
5. Send every pivot through the same walk-forward, cost, multiple-testing and untouched-holdout pipeline.
6. Never promote a pivot or alter risk policy automatically.

### Crypto regime analysis is useful but not yet a trading gate

The upstream six-factor score has good breadth of inputs, but it is a heuristic composite. Missing components are reweighted, and its own documentation describes regime bands as heuristic rather than validated allocation rules. NEXUS should first establish reliable source coverage, timestamps, venue definitions and fallback behaviour. The result may inform a research report; it must not directly increase leverage or position size.

### Risk circuit-breaker concepts are worth strengthening

The upstream breaker is stronger than a simple daily stop because it combines daily, weekly and monthly loss thresholds, consecutive losses, cooldowns and malformed-state halts. NEXUS should evaluate those controls against its own paper ledger and UTC/session semantics before implementation. It must continue allowing risk-reducing exits while blocking new exposure.

### Skill quality review should remain mostly deterministic

The dual-axis approach is a good fit for NEXUS's hybrid self-improvement policy. Static checks should determine whether a skill has valid metadata, explicit inputs/outputs, workflow gates, failure handling, tests and safe execution boundaries. An LLM can provide a second opinion but cannot approve its own work or override deterministic failures.

## Proposed adoption order

1. Finish and verify the universal AI governance contract.
2. Build a compact deterministic strategy-stagnation diagnosis and pivot proposal spec.
3. Extend paper risk controls with weekly/monthly loss and losing-streak analysis after ledger semantics are audited.
4. Add a deterministic skill quality scorecard to the existing Skill Intelligence page.
5. Add multi-factor crypto regime components only after their free public data sources and provenance are verified.
6. Add general workflow manifests only when a second or third real agent workflow needs them.

No new dependency is required for these ideas. Each should be a small, separately reviewed TypeScript domain module with unit tests, not a large Python package.

## Sources

- [Upstream repository](https://github.com/tradermonty/claude-trading-skills)
- [Upstream README and project scope](https://github.com/tradermonty/claude-trading-skills/blob/main/README.md)
- [Canonical skill index](https://github.com/tradermonty/claude-trading-skills/blob/main/skills-index.yaml)
- [Strategy Pivot Designer](https://github.com/tradermonty/claude-trading-skills/tree/main/skills/strategy-pivot-designer)
- [Crypto Regime Analyzer](https://github.com/tradermonty/claude-trading-skills/tree/main/skills/crypto-regime-analyzer)
- [Drawdown Circuit Breaker](https://github.com/tradermonty/claude-trading-skills/tree/main/skills/drawdown-circuit-breaker)
- [Dual Axis Skill Reviewer](https://github.com/tradermonty/claude-trading-skills/tree/main/skills/dual-axis-skill-reviewer)
