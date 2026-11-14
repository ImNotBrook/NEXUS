---
name: nexus-decision-analysis
description: Use when evaluating a NEXUS market setup, constructing an evidence-backed thesis, challenging a trade candidate, or producing ENTER/WAIT/REJECT/NO_SETUP analysis.
---

# NEXUS Decision Analysis

**Version:** 1.0.0  
**Contract:** [Decision Engine Specification](../../../docs/DECISION_ENGINE_SPEC.md) and [Market Intelligence Specification](../../../docs/MARKET_INTELLIGENCE_SPEC.md).

## Mandatory workflow

1. Read the canonical, immutable market snapshot. Record its ID, symbol, evaluation time and timeframes.
2. Validate source provenance, observation/availability times, units, freshness, completeness and candle-finality. If critical data is invalid or stale, report unknown/degraded and do not manufacture certainty.
3. Separate observations from interpretations. Every factual claim must reference evidence IDs.
4. Build the macro/regime context before lower-timeframe setup analysis. Preserve the 1D > 4H > 1H > 15M hierarchy.
5. Evaluate independent evidence families: macro/regime, market structure, liquidity/location, momentum/volume, derivatives/positioning, timeframe alignment and trade economics.
6. Identify correlation and shared-source dependencies. Never count multiple correlated indicators as independent votes.
7. Present the strongest bull case and bear case, missing evidence, alternative explanations and explicit invalidation.
8. Define a causal trigger, expiry, entry, stop, targets, size, costs and execution assumptions. If these cannot be defined, the candidate is not eligible for ENTER.
9. Apply deterministic risk and data-quality gates. Gates cannot be offset by a high score or persuasive narrative.
10. Return exactly one status: ENTER, WAIT, REJECT or NO_SETUP, with reason codes and supporting evidence.
11. Ensure the decision is journalled with the original snapshot and engine versions.

## Interpretation rules

- A score is not a probability unless a calibration method, horizon and out-of-sample evidence are explicitly supplied.
- ENTER means eligible for a paper-trade attempt, not a guaranteed fill.
- WAIT must state what observable event would change the decision and when the candidate expires.
- REJECT must state the invalidating evidence or failed gate.
- NO_SETUP is a valid outcome, not a missing answer.
- A market structure event is usable only after its confirmation/availability time.
- FVGs and order blocks are price-zone hypotheses, not proof of institutional orders.
- Liquidity levels are potential concentrations, not verified stop orders.
- Elliott Wave is an optional competing interpretation, never an objective fact or standalone trigger.
- Do not predict a guaranteed next move or retrofit a thesis to price action that occurred later.

## Prohibited behavior

- No future data, repainting or retrospective backdating.
- No indicator-count voting.
- No unsupported claims of institutional intent.
- No fabricated prices, fills, probabilities, source data or test results.
- No bypass of risk limits, kill switches, qualification rules or human approval.
- No direct order execution, credential access, account mutation or policy modification.
- No automatic promotion of a proposed strategy, weight or skill change.

## Output contract

Provide:
- decision ID/candidate ID and snapshot ID;
- status and reason codes;
- thesis and timeframe;
- evidence for / evidence against / missing evidence;
- alternative explanations and invalidation;
- entry trigger, stop, targets, expiry and net economics;
- data quality and uncertainty;
- risk gate result;
- engine/strategy/risk-policy versions.

Follow the NEXUS Decision Engine and Market Intelligence specifications as authoritative.
