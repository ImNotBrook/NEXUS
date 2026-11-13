# NEXUS learning and skill governance

## Current capability

NEXUS currently contains repository-level agent skill documents and a domain-level skill proposal governance module. The static PWA does not run an LLM, train model weights or independently execute background research. The skills are reusable instructions for an AI coding/research agent working with the repository.

This distinction is deliberate: no paid model API, hosted inference service, private exchange key or always-on compute is required in the first phase.

## Skill layout

- .agents/skills/ contains active, project-authored agent instructions.
- skills/knowledge/ contains evidence-backed knowledge notes that can be updated independently of protected operating procedures.
- src/domain/skill-governance.ts validates proposals, version increments, evidence, evaluation results and changed-file manifests.

Each skill has a stable ID and semantic version. A proposal must state its base version, proposed version, exact changed files, source evidence, test result, baseline score, candidate score and regression count.

## Hybrid improvement loop

1. **Observe:** identify a repeatable research failure, missed edge case or operator correction.
2. **Research:** consult primary documentation and maintained open-source projects; record licences and provenance.
3. **Propose:** draft a minimal change against a specific skill version. Do not overwrite the active skill.
4. **Evaluate:** run the same fixed task set against baseline and candidate. Record evaluator version, task set, scores and regressions.
5. **Classify:** inspect the actual changed-file manifest. A self-declared change category is not trusted.
6. **Promote:** knowledge-only Markdown changes under skills/knowledge/ may be eligible for automatic promotion after evaluation. Skill procedures, methodology, code, system policy, risk controls, qualification gates and execution permissions require explicit human approval.
7. **Audit:** retain prior versions, proposal evidence, evaluation reports and a rollback path.

## Promotion criteria

A proposal is invalid unless:
- the semantic version increases;
- at least one evidence reference is present;
- tests pass;
- candidate evaluation score exceeds the baseline score;
- regression count is zero;
- all changed files are identified with safe repository-relative paths.

The current governance helper is a domain policy function, not a security boundary or cryptographic attestation system. A future evaluator must produce trusted test-run records; an AI cannot be allowed to assert that its own tests passed. Until GitHub Actions and the full test suite are verified, automatic promotion must remain operationally disabled.

## Protected surfaces

Human approval is mandatory for any change touching:
- risk limits, exposure, drawdown or kill-switch behavior;
- qualification requirements or evidence rules;
- system instructions and AGENTS.md;
- strategy methodology or execution semantics;
- exchange adapters, order routing or execution permissions.

No skill update can enable live trading. Qualification only grants review eligibility. Live execution remains disabled independently.

## Model learning is a separate stage

When an actual model runtime is introduced, keep these separate:
- skill/prompt versioning (instructions);
- feature and label definitions (data contract);
- model artifacts (learned weights);
- strategy versions (decision logic);
- risk policy (human-controlled);
- execution permissions (human-controlled).

Any supervised model must be trained on chronological windows, fitted only on training data, periodically retrained in historical replay, compared with a baseline and evaluated on an untouched final holdout. Model artifacts need unique identifiers and reproducible metadata. Reinforcement learning is deferred until the execution simulator and reward design can be audited.

## Research references

- Agent Skills folder and SKILL.md convention: https://github.com/anthropics/skills
- Adaptive supervised retraining and chronological backtesting: https://github.com/freqtrade/freqtrade/tree/develop/docs
- Agent evaluation harness patterns: https://github.com/harbor-framework/harbor
- Reuse and licence assessment: skills/knowledge/open-source-reuse-audit.md
- Adaptive training design notes: skills/knowledge/adaptive-model-training.md

No third-party skill code has been copied into NEXUS.
