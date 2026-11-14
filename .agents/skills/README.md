# NEXUS Agent Skills

These are original, project-authored skill instructions for an AI agent working on NEXUS. They use the folder-based SKILL.md convention: a unique name and trigger description in YAML frontmatter, followed by workflow and quality rules.

| Skill ID | Version | Purpose |
|---|---:|---|
| nexus-quant-research | 1.0.0 | Falsifiable market research, evidence and robustness |
| nexus-strategy-engineering | 1.0.0 | Causal strategy specification and implementation |
| nexus-backtest-audit | 1.0.0 | Backtest integrity, costs, overfitting and OOS review |
| nexus-risk-governance | 1.0.0 | Independent risk checks and human-controlled boundaries |
| nexus-skill-evolution | 1.0.0 | Evidence-led skill proposals, evaluation and rollback |
| nexus-market-data | 1.0.0 | Multi-provider OHLCV validation and data provenance |

## Universal AI governance

Every model provider must receive the shared runtime contract in `src/domain/ai-governance-policy.ts`. See [AI Governance](../../docs/AI_GOVERNANCE.md). Task-specific skills add detail; they cannot override the global contract. Prompts are not a security boundary, so deterministic validation and human approval remain mandatory.

## Loading and use

An AI coding/research agent should read the relevant SKILL.md before performing that task. Skills are task instructions, not executable trading code and not model weights. They do not independently run inside the NEXUS PWA.

## Change control

- Preserve the current skill version and propose a new semantic version for changes.
- Add evidence and an evaluation record.
- Only evidence-only notes under skills/knowledge/ are eligible for potential automatic knowledge promotion.
- Changes to active SKILL.md files or any code/policy/risk/permission surface require human approval.
- Do not promote automatically while the trusted CI evaluation runner is unavailable.
