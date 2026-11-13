---
name: nexus-risk-governance
description: Apply independent trading risk checks and preserve NEXUS's human-controlled policy and execution boundaries.
---

# NEXUS Risk Governance

## Non-negotiable boundaries

- Initial operation is research and paper trading only.
- No exchange private keys, signing credentials or live order endpoints are permitted in the initial build.
- Qualification is conjunctive: at least 90 qualifying days AND 1,000 completed trades. It creates review eligibility only.
- No AI agent, strategy, skill or qualification result may grant live execution permission.
- Risk limits, system policy and execution permissions cannot be changed by an AI-generated proposal.

## Risk review

For each strategy, evaluate:
- per-trade risk and position sizing;
- aggregate symbol and portfolio exposure;
- correlated positions and concentration;
- daily and peak-to-trough drawdown;
- gap, liquidity, spread and slippage risk;
- fees, funding, borrow and liquidation mechanics where applicable;
- data outages, stale feeds, duplicate signals and broker failures;
- kill-switch and risk-reducing exit behavior.

## Approval protocol

Any change to risk policy, system policy, qualification rules, execution permissions or order-routing code requires explicit human approval, tests, a versioned diff and a rollback path.

When a risk control is breached, fail closed for new exposure. Do not block risk-reducing exits. Log the event and the data used to make the decision.

## Reporting

State the maximum plausible loss under the model, unmodelled tail risks, assumptions and the exact conditions under which trading is blocked. Never use a profitable backtest as a reason to relax safeguards.
