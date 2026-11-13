---
name: nexus-skill-evolution
description: Propose, evaluate, version and safely promote NEXUS AI skill improvements without allowing autonomous policy or risk changes.
---

# NEXUS Skill Evolution

## Improvement loop

1. Identify a measurable failure, gap or repeated manual correction.
2. Research authoritative primary sources and maintained open-source implementations.
3. Create a proposal against a specific active skill version. Include source references, affected files, rationale and expected measurable improvement.
4. Change the smallest possible skill surface. Preserve the prior version.
5. Evaluate baseline and candidate on the same fixed task set. Use blind or held-out tasks where possible.
6. Require passing regression tests, no safety regressions and a higher candidate score before promotion.
7. Record the proposal, evidence, evaluation, version and decision. Keep a rollback path.

## Promotion rules

- Only markdown files under skills/knowledge/ may be considered for automatic knowledge-only promotion.
- Changes to skill procedures, strategy methodology, source code, AGENTS.md, system policy, risk limits, qualification rules or execution permissions require explicit human approval.
- The proposal's claimed change category is not trusted by itself. Inspect the actual changed-file manifest.
- A skill cannot approve its own evaluation. Candidate and baseline must be evaluated by the same independent test set and evaluator version.
- No promotion is allowed when tests fail, evidence is missing, the candidate regresses, the version does not increase or the change scope is unclear.

## Required proposal record

Include skill ID, base and proposed semantic versions, exact changed files, change category, primary evidence, baseline/candidate scores, regression count, test-run reference, author and timestamp.

## Never do

Do not rewrite system instructions, disable tests, weaken risk limits, alter qualification gates, add live execution permissions or install unreviewed third-party code as a side effect of learning.
