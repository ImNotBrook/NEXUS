# Global Research Leaderboard

## Purpose

The leaderboard surfaces the strongest saved walk-forward research observations without mixing incompatible market data or simulation assumptions. It is a descriptive index, not a strategy selector or promotion mechanism.

## Current scope

- Reads **all** existing `ResearchRunStore` records from local IndexedDB via `listAll()`; it does not duplicate or migrate experiment history. The separate saved-history panel remains limited to the newest 50 for mobile usability.\n- Execution-stress runs persist a versioned family manifest alongside each scenario report: family ID, scenario ID/order, expected scenario list, label, cost multiplier and participation multiplier. Complete families are reconstructed from those same stored reports; there is no second source of truth.
- Groups records only when the full dataset fingerprint, candle count, first/last timestamps, symbol, interval, provider and complete research/execution configuration match exactly.
- A run missing valid market provenance is placed in its own isolated group and listed as non-comparable. No missing metadata is inferred.
- Within each compatibility group, every saved run/candidate observation is retained.
- Two rankings are displayed separately:
  - **Best historical return:** highest compounded out-of-sample return, then lower drawdown, expectancy and stable run/candidate IDs.
  - **Most robust:** statistical review state first, then capped completed-trade and fold counts, worst-fold return, expectancy, drawdown and stable IDs.
- Robustness state uses the existing statistical robustness report. `REVIEW_FOR_PAPER` means only that baseline sample/consistency diagnostics passed; it is not qualification or permission to trade.
- The UI displays the top five observations per ranking and compatibility group. All saved records remain in experiment history.

## Explicit exclusions and limitations

- Nested walk-forward reports remain in their own store and view; they are not mixed with ordinary reports.
- Sealed final holdout results remain in the sealed ledger and are not used for leaderboard ranking.
- Incomplete, duplicated or internally inconsistent execution-stress families are excluded from the survivor ranking. Legacy reports without family metadata remain unassigned; membership is never inferred.\n- Nested walk-forward reports and sealed holdout results remain in their own dedicated research-console sections and ledgers. They are deliberately not numerically mixed with ordinary walk-forward or stress-family rankings.
- The store is device-local. Records do not sync between browsers/devices and remain subject to local browser storage loss.
- Dataset fingerprints are reproducibility identifiers, not cryptographic proofs. Identical fingerprints do not prove that a market data provider has never revised its source history.
- Historical rankings are subject to multiple-testing and selection bias. They do not establish future profitability or statistical significance.

## Verification contract

- Unit tests cover exact compatibility grouping, different datasets, symbols and execution assumptions, missing provenance isolation, deterministic tie ordering and empty history.
- UI reads the same saved-run store as experiment history and refreshes the leaderboard after saves/deletes.
- No research run, candidate, strategy configuration, holdout seal, account balance or order is changed by leaderboard rendering.
- Full repository CI and production build must pass before release.


## Execution-stress family aggregation

- Each newly completed execution-stress run writes the same versioned family manifest alongside every scenario report in `ResearchRunStore`.
- The leaderboard reconstructs a family only when every expected scenario exists exactly once and shares the same dataset identity, market provenance, date range and ordered candidate manifest.
- Candidate ranking reuses `rankExecutionStressCandidates`: sample sufficiency across scenarios, worst-case OOS return, median scenario return, worst drawdown, worst expectancy and stable candidate ID.
- Partial writes caused by interruption are retained in history but excluded from ranking. Re-running creates a new family ID; it does not silently complete or overwrite an older partial family.
- Older scenario reports remain valid ordinary history and are not retroactively grouped.
- Nested research and sealed holdout retain their own separate ledgers and report views. No cross-type ranking is performed.
