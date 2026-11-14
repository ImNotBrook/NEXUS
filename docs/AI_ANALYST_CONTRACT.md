# AI Analyst Evidence Contract — Stage 11, Increment 1

Updated: 2026-11-15

## Scope

This increment defines the untrusted model-output contract for an evidence-grounded NEXUS market analyst. It is a domain boundary only; it does not yet call a model or render an analyst panel.

## Evidence packet

The caller supplies 1–32 evidence items. Each item has:
- a unique stable ID;
- a source label;
- a non-negative observation timestamp; and
- a bounded factual statement.

The caller is responsible for constructing the packet from quality-checked NEXUS market snapshots, research results or explicitly labelled external references. Missing or failed data must not be converted into a positive fact.

## Required analyst response

Schema version 1 requires:
- directional bias: bullish, bearish, mixed or none;
- confidence: low, moderate or high;
- a concise summary;
- both bull and bear cases;
- explicit contradictions;
- claim statements with evidence IDs; and
- an abstention flag with a reason when the evidence is insufficient.

Every claim must reference an ID in the exact evidence packet supplied for that analysis. Unknown IDs, duplicate evidence IDs, malformed timestamps, unsupported fields and malformed abstention responses are rejected.

An abstaining response must use bias `none`, confidence `low`, no claims and no directional bull/bear assertions. A non-abstaining response must include both sides and at least one evidence-linked claim.

## Security and quantitative limits

- Model output is untrusted input. The parser validates shape, bounds and citation membership only.
- Citation membership does **not** prove semantic entailment. Human review and future evidence-to-claim evaluation remain required.
- This contract does not independently verify source authenticity, freshness or cross-feed agreement. The evidence-packet builder must use the existing market-data quality and trust gates.
- The analyst cannot set risk limits, approve strategies, change qualification rules or create orders.
- No generated text is executable. No arbitrary strategy code is accepted.
- The report is explanatory, not a price forecast or profitability claim.

## Tests

The domain tests cover valid balanced analysis, unknown evidence references, duplicate evidence IDs, missing bull/bear cases, explicit abstention, directional abstention rejection, unexpected fields and malformed evidence metadata.

## Remaining Stage 11 work

1. Build a deterministic evidence packet from the canonical market-intelligence snapshot and research ledger, preserving source timestamps and quality state.
2. Add a governed multi-provider analyst adapter using the existing provider configuration and fallback policy.
3. Parse every response through this contract; provider failure or invalid output must result in abstention, never fabricated analysis.
4. Render the analyst's bull/bear/contradiction/uncertainty report in the mobile workspace.
5. Add adapter-to-domain integration tests, fixed evaluation fixtures and regression checks for citation coverage and abstention.
6. Keep model calls advisory; deterministic decision gates and explicit human approvals remain authoritative.
