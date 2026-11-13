# NEXUS research agent foundation

## Purpose

The research agent begins with a hypothesis workflow, not unconstrained parameter search. It turns an observed market or experiment result into a falsifiable question, names the strategy and experimental variables, records evidence, and specifies a primary metric plus risk/sample-size guardrails.

## Evidence requirements

Evidence records include a source type, reference and a specific claim. Recognized types are experiment, paper, documentation, code, exchange data, community and opinion. An opinion can be retained as context but does not count toward experiment readiness. A hypothesis is ready for experiment design only when it has at least two distinct non-opinion evidence types. This is a minimum provenance check, not a claim that sources are correct or independent in the academic sense; source quality and conflicts still require review.

## Experiment protocol

Every future experiment derived from a hypothesis must:
- Compare control and candidate on the same data and chronological folds.
- Include realistic fees and adverse slippage.
- Use walk-forward out-of-sample evaluation.
- Retain an untouched final holdout.
- Report risk and sample-size guardrails, not only returns.
- Preserve negative and inconclusive results.
- Never automatically promote a strategy or change execution permissions.

## Current implementation boundary

The research-agent domain validates and creates immutable draft hypotheses. The adapter persists them in the device-local IndexedDB ledger. This is the research agent foundation only: no autonomous web crawler, LLM inference, GitHub skill installer, source verification or automatic experiment execution is connected yet. The UI does not yet expose hypothesis creation; the typed domain and persistence interfaces are ready for that next integration.

The ledger is local to the browser profile and can be lost when site data is cleared. No API keys or paid services are required.
