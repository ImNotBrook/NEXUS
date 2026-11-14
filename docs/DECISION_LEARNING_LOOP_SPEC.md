# NEXUS Decision & Learning Loop

**Status:** Foundation contract — approved for implementation  
**Version:** 1.0.0  
**Purpose:** Preserve decisions and evaluate actual and counterfactual outcomes without hindsight leakage.

## 1. Core principle

Every decision creates an immutable evidence record. Every subsequent market outcome creates a separate evaluation observation. Learning produces research hypotheses; it does not silently change strategy, risk policy or execution permissions.

A losing trade can be a good decision. A winning trade can be a bad decision. Outcome alone does not establish decision quality.

## 2. Three components

1. **Decision Journal:** immutable record of the information, candidate, thesis, plan, scores, decision and software/policy versions at decision time.
2. **Shadow Outcome Engine:** causal simulation of the original candidate plan and explicitly defined alternatives, whether or not a paper trade was taken.
3. **Learning & Validation Engine:** evaluates mature outcomes, calibrates diagnostics, analyses misses and proposes changes for controlled testing.

These are separate domain modules with versioned contracts. The first implementation is local-first and must not require a server or paid database.

## 3. Decision journal

A journal entry is append-only and contains:

- `decisionId`, candidate ID and schema version;
- decision timestamp and timezone/clock source;
- symbol, venue, contract category and timeframe;
- immutable market snapshot IDs and content hashes;
- evidence items, provenance and data-quality state;
- bull/bear thesis, alternatives and invalidation;
- decision status (ENTER, WAIT, REJECT, NO_SETUP) and reason codes;
- scores plus score/calibration version;
- original entry trigger, entry/stop/targets, sizing and expiry;
- fee, spread, slippage and fill-model assumptions;
- regime, structure, strategy and risk-policy versions;
- actual paper execution reference, if any;
- outcome horizon and maturity status.

Decision-time content is immutable. Later evidence, corrections, fills and outcomes are appended as linked events. Never update an old decision's snapshot or insert future knowledge into its evidence list.

Stable IDs must be collision-resistant and generated without relying on client wall-clock time alone. Records should be exportable and replayable. Local browser storage is not a backup; export/import and schema migration must be planned.

## 4. Counterfactual categories

Every decision class has explicit evaluation semantics:

| Decision | Evaluation |
|---|---|
| ENTER | Actual paper fills and P&L, plus separately labelled shadow alternatives where relevant |
| WAIT | Whether the stated trigger later occurred, entry efficiency, missed move, or avoided invalidation |
| REJECT | Whether the original plan's trigger/stop/targets would have resolved under the declared fill model |
| NO_SETUP | Whether a separate causal discovery process identifies a qualifying opportunity that the original system failed to surface |

A rejected setup reaching a target is not automatically a bad rejection. Evaluate whether the original stop was breached first, whether the setup was valid at decision time, and whether the rejection reason was justified using contemporaneous evidence.

NO_SETUP cannot be evaluated by choosing the best-looking historical candle after the fact. The discovery detector must be independently specified, causal, versioned and run on historical prefixes.

## 5. Shadow trade contract

A shadow trade is created only from a plan that existed at decision time or from a separately versioned causal discovery event. It must contain:

- candidate and decision references;
- side, symbol and instrument semantics;
- trigger type, trigger price/condition and earliest eligible time;
- entry order type and price/limit assumptions;
- stop, target ladder and sizing method;
- expiry and maximum holding horizon;
- fees, spread, slippage and funding assumptions;
- fill model and simulation version;
- status: pending, triggered, partially_filled, filled, expired, invalidated, ambiguous or completed.

Do not create a shadow trade with an entry price selected using subsequent market movement. If no causal trigger is defined, record the candidate as non-simulatable and state why.

## 6. Fill and path simulation

A candle touching a limit price does not guarantee a fill. Fill models must declare assumptions about spread, available volume/depth, queue priority, latency, partial fills and gaps. Where those inputs are unavailable, use conservative documented assumptions and mark the limitation.

For OHLC candles where both stop and target are touched inside the same bar and intrabar order is unknown, either:
- resolve with finer-grained data that was actually available to the simulator; or
- apply a conservative adverse ordering; or
- mark the outcome ambiguous and exclude it from metrics requiring a resolved path.

Never choose the favourable ordering silently.

Model:
- entry and exit fees;
- bid/ask spread;
- adverse slippage and gap-through stops;
- partial fills and unfilled orders where supported;
- funding/borrow costs when applicable;
- stop/target ordering;
- expiry and time-based exits;
- missing bars and market-data outages.

Simulation output is always labelled hypothetical. It never creates a paper-account fill or changes the actual account ledger.

## 7. Outcome measurements

For every mature actual or shadow observation, calculate where applicable:

- maximum favourable excursion (MFE);
- maximum adverse excursion (MAE);
- realised net P&L and R multiple;
- time to trigger, fill, target, stop or expiry;
- entry efficiency versus original reference;
- maximum adverse drawdown while open;
- target attainment and stop-first status;
- avoided loss / missed opportunity under the declared plan;
- structural/thesis evolution;
- cost attribution (fees, spread, slippage, funding).

MFE/MAE must be computed only over the defined evaluation horizon and with explicit price-side assumptions. Net R uses the original risk budget and all applicable costs. Do not compare an actual fill and a hypothetical fill as if their execution conditions were identical.

## 8. Maturity and leakage control

An outcome is not eligible for calibration/training until its predeclared horizon has closed and all required data-quality checks pass. A pending or ambiguous outcome remains unresolved.

The decision's original features, score and model version are frozen. Outcome data is stored in a separate namespace. Training/calibration joins must be keyed by decision ID and must enforce strict timestamp boundaries.

Never:
- feed outcome fields back into the original decision features;
- revise historical decisions using later data;
- tune thresholds on the same sample used to report validation performance;
- split individual trades randomly when they share overlapping market periods or candidate lineage;
- treat repeated/correlated candidates as independent observations without adjustment.

Use chronological splits, walk-forward validation and an untouched final holdout. Record all trials and multiple-testing exposure.

## 9. Four separate learning dimensions

1. **Analytical accuracy:** did the market/structure/regime description match subsequent observable development?
2. **Decision quality:** was ENTER/WAIT/REJECT/NO_SETUP defensible given the information available then?
3. **Execution quality:** did the actual or simulated fill/exit process follow the declared plan?
4. **Economic performance:** did the strategy generate positive net expectancy after realistic costs?

Report these independently. Do not collapse them into a single win rate.

## 10. Learning reports

Segment only where sample size and data quality support it:

- regime and volatility state;
- symbol and instrument category;
- timeframe and setup family;
- strategy and version;
- decision class;
- evidence family and data-quality state;
- entry/exit method.

Track net expectancy, distribution of R, drawdown, MFE/MAE, false positives/negatives, missed opportunities, avoided losses, calibration error, coverage, maturity and ambiguity rates. Always include sample sizes, confidence intervals where appropriate, date ranges and selection limitations.

Do not claim that a rejected setup was missed alpha solely because its target was later reached. Compare the full path against its original invalidation and execution assumptions.

## 11. Improvement proposal lifecycle

The learning engine may propose:
- evidence reliability or weight changes;
- new/removed setup filters;
- indicator or regime threshold changes;
- revised trigger/entry rules;
- skill/knowledge improvements.

Every proposal must include hypothesis, baseline, candidate, exact data window, trial count, costs, out-of-sample results, robustness, known regressions, affected versions and rollback plan.

Promotion requires:
1. reproducible historical replay;
2. walk-forward and untouched out-of-sample validation;
3. realistic costs and conservative fill assumptions;
4. comparison against current baseline and simple benchmarks;
5. robustness/sensitivity analysis and multiple-testing disclosure;
6. regression suite pass;
7. versioned proposal and explicit human approval.

No automatic weight changes in the first release. No learning process may alter risk limits, kill switches, qualification requirements, governance policy or execution permissions. Model output cannot approve its own proposal.

## 12. Persistence and operational constraints

Initial storage is local IndexedDB with explicit schema versioning, append-only decision/outcome events and user-controlled export. Storage failure must fail closed: do not claim a decision was journalled if persistence failed. The system must detect duplicate IDs/events and make ingestion idempotent.

A local-only ledger can be lost with browser data. Until a verified backup/export exists, display that limitation clearly. GitHub Actions market-data history is not a substitute for the user's private decision journal.

## 13. Release stages

1. Contracts and immutable decision records.
2. Deterministic shadow outcome simulation with conservative candle handling.
3. Maturity-aware analytics and reports.
4. Causal NO_SETUP discovery and missed-opportunity evaluation.
5. Calibration research and proposal workflow.
6. Optional governed AI explanation of reports.

The first release is research/paper only. No real-money execution.
