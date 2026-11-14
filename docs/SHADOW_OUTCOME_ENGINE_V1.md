# Shadow Outcome Engine v1

**Status:** Research-only implementation slice  
**Module:** src/domain/shadow-outcome-engine.ts  
**Simulation version:** Caller-supplied and stored in every result

## Scope

Version 1 simulates a decision-time plan against subsequent OHLCV candles. It is separate from the paper account and cannot create paper fills, live orders or account mutations.

The plan fixes, before the outcome window:

- decision, earliest entry, entry expiry and outcome horizon timestamps;
- symbol and spot instrument category;
- long side, entry order type, reference/limit price and quantity;
- stop and one target price;
- limit penetration threshold;
- fee, spread, slippage, impact and maximum participation assumptions;
- same-bar collision policy and simulation version.

Candles must be strictly ordered, valid OHLC and use **base-asset volume**. Candle timestamps are interpreted as the bar's opening timestamp. Candles at or before decision time and beyond the declared horizon cannot create fills.

## Fill assumptions

- Market entry and stop exits use the shared market execution model: fees, half-spread, adverse base slippage, volume-proportional impact and volume participation.
- Limit entry/target orders require price penetration beyond the declared threshold. A simple touch is not treated as a fill.
- Limit fills execute at the limit or better on an opening gap; fees are still charged.
- Per-candle participation is capped in aggregate across entry and exit fills.
- Partial fills are carried forward. A triggered stop remains a market exit; a target remains a limit exit.
- Residual entry quantity is cancelled after an exit trigger or when the entry expires.
- A market entry that gaps outside the original stop/target corridor is invalidated rather than filled.
- Stops and targets are inactive on the entry candle because OHLC cannot establish the intrabar sequence after an entry fill.
- If stop and target are both first touched intrabar and the path is unknowable, the plan either resolves adverse stop-first or returns ambiguous, as declared by the plan.

## Output semantics

| Status | Meaning |
|---|---|
| pending | No entry fill yet; the declared entry window has not been observed to expire |
| expired | No entry fill before expiry |
| invalidated | Entry price gapped outside the original risk corridor |
| open | Some quantity filled and remains open |
| completed | All filled quantity exited |
| ambiguous | Same-bar stop/target ordering could not be resolved under the selected policy |

horizonReached indicates whether the supplied candles reach or pass the declared horizon. An open outcome at a reached horizon is unresolved and must not enter mature-outcome calibration. Version 1 does not fabricate a closing fill at the horizon.

Net P&L is realised only on exited quantity and includes allocated entry fees plus exit fees. Entry/exit fees are also exposed separately. MFE/MAE are reported in basis points relative to the weighted average entry price, using post-entry candles only.

## Explicit v1 limitations

- **Spot long only.** Spot shorts are rejected until borrow availability and borrow costs are modelled.
- **No perpetual/inverse derivatives.** They are rejected until funding and contract-specific P&L semantics are implemented.
- One stop and one target only; no target ladder or scale-out allocation yet.
- No forced time-based market close. Open positions at the horizon remain unresolved.
- No order-book depth, queue priority or latency data. Limit penetration is a conservative proxy, not a guaranteed fill.
- No funding, borrow, liquidation or exchange-specific tick/lot constraints.
- OHLC cannot recover intrabar order. Ambiguous cases remain ambiguous or resolve under the declared adverse policy.

These limitations must remain visible in any UI or report. Do not describe this simulator as a profitability predictor or as exchange-accurate execution.

## Validation and tests

The test suite covers causal timestamp boundaries, limit penetration, gap invalidation, fees, adverse market costs, partial entry/exit fills, aggregate candle participation, long stop/target handling, same-bar ambiguity, MFE/MAE, expiry, horizon maturity, invalid candles and unsupported instrument semantics.
