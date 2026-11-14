# Indicator Selection Skill — Change Proposal and Evaluation

## Proposal

- Skill: `nexus-indicator-selection`
- Version: 1.0.0
- Scope: research methodology
- Motivation: prevent agents from selecting indicators without regard to market regime, calculation availability, data requirements, redundancy or known failure modes.

## Evidence and design basis

The skill is grounded in NEXUS's existing deterministic implementations of SMA, EMA, RSI, ATR, MACD and Bollinger Bands, plus the causal trend/volatility classifier in `src/domain/market-regimes.ts`. The catalogue documents additional technical, derivatives, breadth and sentiment measures but explicitly marks them as planned.

The skill does not import third-party trading logic or add runtime dependencies. It is a project-authored selection protocol and a metadata catalogue.

## Baseline versus candidate evaluation

| Evaluation dimension | Baseline agent behaviour | Candidate skill requirement | Acceptance evidence |
|---|---|---|---|
| Implementation honesty | May discuss indicators generically | Must check implementation status | Unit test: recommendations exclude planned indicators |
| Regime suitability | No canonical selection map | Select by trend and volatility regime | Deterministic recommendation tests |
| Redundancy | May stack correlated indicators | Check redundancy groups | Catalogue completeness tests |
| Data integrity | May overlook warm-up/finalized bars | Preserve nulls; finalized bars only | Existing indicator and market-data tests plus explicit skill rules |
| Research integrity | May tune parameters opportunistically | Untouched holdout and trial accounting | Explicit skill rules and existing backtest audit requirements |
| Safety | Indicator language can sound like trade instruction | Advisory only; risk controls remain authoritative | Skill constraints and existing AI governance |

## Acceptance criteria

1. Catalogue entries contain purpose, inputs, market contexts, interpretation, limitations and redundancy group.
2. Implemented and planned indicators are unambiguously separated.
3. Regime recommendation tests are deterministic.
4. No external dependency is introduced.
5. Full CI, typecheck, tests and production build pass before merge.
6. The skill remains subordinate to universal AI governance and risk controls.

## Rollback

Remove the skill registry entry and its directory, catalogue module/tests and documentation if it causes unsafe or misleading agent recommendations. No persisted trading state or live execution path is affected.
