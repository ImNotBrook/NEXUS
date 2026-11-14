# NEXUS AI Strategy Composition

Updated: 2026-11-15

## Purpose

NEXUS should generate strategy hypotheses itself. Manual strategy authoring remains a fallback. The AI provider proposes a complete, structured rule specification; deterministic NEXUS code validates, compiles and evaluates it. The model never supplies executable source code.

## Current version 1 rule DSL

The current compiler is intentionally narrow and long-only:

- Market: BTCUSDT public spot research input.
- Timeframe: 1h completed candles.
- Entry triggers:
  - SMA bullish crossover (fast 2–30, slow 5–100, fast < slow).
  - RSI recovery above an oversold threshold (period 5–50, threshold 10–40).
  - Donchian close breakout above the prior N-bar high (period 5–100; current candle excluded from the channel).
- Optional confirmations: zero to two bullish EMA alignments (fast 2–30, slow 5–100, fast < slow).
- Exit rules:
  - Opposite SMA crossover.
  - RSI at/above an overbought threshold (period 5–50, threshold 60–90).
  - Close below SMA (period 5–100).
- Every specification carries a falsifiable market hypothesis, a regime-scope label and an invalidation statement.

The parser enforces schema version, exact field sets, bounded numeric values, identifier format and text limits. Unknown indicators, extra fields, arbitrary source code and unsupported timeframes are rejected.

## Execution semantics

- The evaluator receives only the candle history available at the current close.
- Signals are generated from completed candles.
- The existing backtester queues a close-generated signal and fills at the next candle open with configured adverse slippage and fees.
- The compiler is long-only; it does not create short exposure.
- Protective stops, take-profits, sizing, risk limits and portfolio controls remain external deterministic controls.
- `regimeScope` is a hypothesis label for analysis, not a hidden entry filter. Regime scorecards remain available to inspect performance across regimes.
- No current-candle Donchian leakage: the breakout threshold uses only the preceding period.

## Automated AI workflow

When a configured eligible provider succeeds, the governed adapter returns both:
- 1–4 parameter proposals from the existing baseline families; and
- 1–2 complete composed-rule specifications.

Every field is parsed before use. The fixed compiler turns valid specifications into ordinary `ResearchCandidate` factories. Those candidates are evaluated alongside deterministic and parameter candidates on the same fetched candle dataset, walk-forward folds, fee/slippage and execution assumptions.

If a provider is missing, rate-limited or returns invalid output, the entire AI generation attempt fails closed to deterministic research. NEXUS does not quietly run a partial or malformed strategy.

The full report contains the AI specifications and research results. The public proposal feed contains only the validated parameter proposals and composed specifications plus provider/model and dataset context; it never contains credentials, raw provider response bodies or account data. A scheduled run with no successful AI generation skips publication, preserving the last valid feed rather than replacing it with an empty deterministic fallback.

## Human approval and storage

Strategy Studio displays each composed specification's trigger, confirmations, exit, market hypothesis, regime label and invalidation. A separate approval action creates a content-addressed, immutable `composed-rule` strategy version with original AI provider/model/time/symbol provenance.

Approved definitions are stored append-only in the device-local strategy library and can enter ordinary walk-forward research after reload. Approval does not approve paper execution. Normal strategy qualification, independent holdout, stress testing, risk gates and separate paper configuration approval remain mandatory.

## Testing

- Parser unit tests cover accepted schema, unknown fields, unsupported code/rules/timeframes, parameter bounds, filter limits and text validation.
- Compiler tests cover deterministic candidate identity, close-confirmed entry, opposite-rule exit, no look-ahead and no mutation of source candles.
- Adapter tests cover provider response validation and deterministic fallback when a composed rule is malformed.
- Integration tests cover artifact parsing → human approval → immutable strategy library persistence/reload → compiled candidate → walk-forward research.

## Known limitations and next work

- Only 1h long-only spot strategies and the listed trigger/filter/exit atoms are implemented.
- Volume, order-book, derivatives, multi-timeframe and short-side rule atoms are not yet supported by this compiler.
- The regime label is descriptive; regime-conditioned strategy execution is not yet implemented.
- AI proposals are hypotheses, not validated edges. Candidate counts increase multiple-testing risk; use nested walk-forward selection and a fresh sealed holdout before any promotion.
- The scheduled automated-research feed requires at least one eligible owner-configured AI provider secret. Deterministic research still runs without it.
- The rule compiler is a first safe composition layer. Subsequent work should expand the tested atom catalogue, attach evidence/provenance to each hypothesis, evaluate challengers against stable baselines, and add controlled AI iteration without self-approval or self-modification.
