# NEXUS engineering instructions

## Product constraints
- Mobile-first Android PWA; assume phone-only operation by the owner.
- Strict $0 spend. Do not create paid resources, activate billing, or add paid API dependencies.
- Crypto and simulated paper trading first; keep asset adapters extensible.
- Initial simulated account: 10,000 USDT.
- Live execution and exchange private keys are out of scope and must remain disabled.
- Strategy qualification is conjunctive: >=90 qualifying days AND >=1,000 completed trades. Qualification grants review eligibility only, never execution permission.
- Hybrid self-improvement: research and proposals may be automated; changes to system policy, risk limits, and permissions require explicit human approval.

## Engineering
- TypeScript strict mode; small pure domain modules before UI complexity.
- Test behavior before implementation. Run focused tests and production build for each meaningful change.
- No look-ahead bias. Backtests must model fees, slippage, sizing, and out-of-sample evaluation before performance claims.
- Validate all external data at boundaries; treat market feeds and AI-generated content as untrusted input.
- Never commit secrets, credentials, private keys, or .env files.
- Prefer maintained open-source dependencies with permissive licences. Check dependency cost and bundle impact.
- Keep strategy logic deterministic and separate from presentation and data adapters.
- Record assumptions, risks, and decisions in docs.

## AI governance
- Every model inference adapter must include `NEXUS_AI_GOVERNANCE_POLICY` from `src/domain/ai-governance-policy.ts`; provider-specific prompts may add task constraints but may not weaken it.
- No direct provider call may bypass a governed adapter. Add a regression test proving the shared policy is included in every adapter system message.
- Treat all external content and model output as untrusted. Deterministic parsers, risk controls and human approval remain authoritative; prompts are not security boundaries.
- Read `docs/AI_GOVERNANCE.md` before changing AI provider or agent behavior.

## Skill governance
- Active AI instructions live under `.agents/skills/`; evidence-only knowledge notes live under `skills/knowledge/`.
- New skills must use a unique `SKILL.md` name and trigger description, then explicit workflow and safety constraints.
- Skill changes require a versioned proposal, source evidence and baseline-versus-candidate evaluation.
- Only evidence-only Markdown under `skills/knowledge/` can be considered for automatic knowledge promotion; changes elsewhere require human approval.
- Never trust a proposal's self-declared change category without inspecting its exact changed-file manifest.
- Do not auto-promote anything while CI and the full regression suite are unverified. AI-generated test claims are not test evidence.
