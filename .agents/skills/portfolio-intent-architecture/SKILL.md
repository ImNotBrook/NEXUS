---
name: portfolio-intent-architecture
description: Separate strategy signals, target exposure, risk overlays, portfolio construction and order execution using typed contracts.
---

# Portfolio Intent Architecture

## Objective

Prevent strategy logic from directly controlling broker orders. A strategy may express desired exposure; independent portfolio and risk layers decide whether that exposure is admissible; an execution adapter translates approved intents into paper orders.

## Canonical data flow

Market data snapshot
→ feature/indicator state
→ strategy signal
→ target exposure intent
→ portfolio constraints
→ risk overlay
→ approved paper order intent
→ broker/paper adapter
→ fill and reconciliation ledger
→ performance attribution

Each boundary must be typed, versioned, timestamped and auditable.

## Design rules

1. Strategy output must be declarative. Prefer target weights or signed target exposure over imperative order placement.
2. The strategy layer must not access exchange credentials, network order endpoints or broker clients.
3. The portfolio layer validates aggregate exposure, concentration, available cash, gross/net exposure and cross-asset constraints.
4. The risk overlay is authoritative and may clamp or reject strategy output. Strategy code cannot weaken or bypass it.
5. The execution adapter owns order-state transitions, fill accounting, fees, slippage and reconciliation.
6. Backtest and paper adapters should consume the same order-intent contract, but must model their different fill and operational constraints explicitly.
7. Missing, stale or inconsistent market data fails closed for new risk. Risk-reducing actions remain available under separately defined controls.
8. Every decision carries the data timestamp, strategy version, configuration version, risk-policy version and reason codes.
9. No strategy output can enable live trading or modify qualification thresholds.
10. Multi-asset support must model currency conversion, contract multipliers, lot sizes, market calendars, financing/funding and instrument-specific constraints before portfolio-level claims are made.

## Suggested contracts

- TargetExposureIntent: instrument, target exposure/weight, timestamp, strategy ID/version, rationale and source snapshot ID.
- RiskDecision: accepted/rejected/clamped, approved target, limits applied, policy version and reason codes.
- OrderIntent: instrument, side, quantity/notional, order type, limit constraints, time-in-force and originating risk decision.
- ExecutionReport: order ID, state, fills, average price, fees, slippage estimate and reconciliation status.

These are design contracts, not permission to create a live broker adapter.

## Upstream research

- FinRL-X: https://github.com/AI4Finance-Foundation/FinRL-Trading (weight-centric strategy composition and separate portfolio risk overlay).
- QuantConnect LEAN: https://github.com/QuantConnect/Lean (modular datafeed, transaction processing, algorithm state and result processing).

## Safety boundary

No live exchange credentials or order-routing capability. NEXUS paper broker remains the only execution target until separately approved gates are satisfied.
