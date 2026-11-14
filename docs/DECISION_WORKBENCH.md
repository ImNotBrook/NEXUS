# NEXUS Decision Workbench

**Status:** Stage 2 implementation — deterministic paper-research baseline  
**Strategy:** Donchian breakout, version 1.0.0  
**Execution:** No exchange orders; decision eligibility only

## Pipeline

1. The operator enters an approver label and rationale and explicitly approves the baseline for the current browser session.
2. NEXUS refreshes public market feeds and builds a four-timeframe market-intelligence snapshot.
3. The candidate generator uses completed 1H candles only. The latest completed candle is tested against the previous 20-bar Donchian channel; the latest candle is excluded from the channel.
4. A breakout is considered only when the 4H primary trend and 1H tactical trend agree with its direction. Spot instruments cannot generate short candidates.
5. The proposed plan uses a 2 × 1H ATR stop, a 2R gross target, a $20 gross risk budget and a $2,000 notional cap. It expires after two 1H bars.
6. Deterministic hard gates evaluate risk, available paper cash, aggregate exposure, candle participation and net reward/risk after simulated execution costs.
7. The evidence engine evaluates candidate-relative market evidence. The result and immutable decision-time snapshot reference are appended to the local decision journal.

## Active paper-research gate policy

| Control | Current setting |
|---|---:|
| Maximum risk per candidate | 20 USDT |
| Maximum risk as equity fraction | 0.20% |
| Maximum notional | 2,000 USDT |
| Maximum aggregate exposure | 2,000 USDT |
| Available capital | Current simulated paper cash |
| Maximum candle participation | 5% |
| Entry/exit fee assumption | 0.10% per side |
| Baseline adverse slippage | 10 bps per side |
| Half-spread assumption | 0 bps |
| Market impact at max participation | 5 bps |
| Minimum net reward/risk | 1.40R |

The risk gate and economics gate are independent hard constraints. A directional evidence score cannot override either. The net reward/risk calculation uses adverse entry, target and stop fills and fees; it is a modelled estimate, not a guaranteed fill.

## Decision states

- **ENTER:** eligible for a paper-trade attempt under the simulation; no order is sent by this workbench.
- **WAIT:** data, history or another causal confirmation condition is not ready.
- **REJECT:** strategy governance, risk or economics hard gate failed.
- **NO_SETUP:** no qualifying breakout was present. The detector reason is preserved.

All four states are journalled. A scan with no candidate still records the snapshot reference and generator reason. Candidate scans also retain the bull/bear thesis, evidence provenance, gate results and diagnostic scores.

## Governance and limitations

- Approval is explicit and session-scoped. Refreshing the page requires re-approval.
- The approval actor, rationale and timestamp are copied into the immutable decision thesis.
- Strategy parameters are fixed in the UI. AI does not generate candidates or alter the rules.
- Diagnostic support, contradiction, coverage and uncertainty scores are not win probabilities.
- This baseline has not been promoted based on profitability. It must be backtested with fees, slippage, walk-forward folds and an untouched holdout before any future strategy selection.
- The workbench has no live-order adapter. It does not submit orders to Binance, Kraken or any exchange.
- Journal data is local to the browser/device. Export the journal regularly; browser storage is not a backup.

## Validation

The generator and orchestration have deterministic unit and integration tests. The integration path covers candidate generation, market evidence, risk/economics gates, decision evaluation, NO_SETUP journalling and persistence failure. GitHub Actions runs the full test suite, type-checks and production build on every change.
