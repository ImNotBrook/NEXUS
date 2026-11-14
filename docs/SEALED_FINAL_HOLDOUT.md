# Sealed final holdout operations

## Purpose

The final holdout is a one-shot, chronological evaluation after ordinary walk-forward and nested walk-forward research. It is intended to provide a last check against a recent contiguous segment that was not used for fitting within this run.

## Workflow

1. Run the normal Strategy Research batch to fetch completed public candles and establish the current development experiment.
2. Inspect ordinary and nested walk-forward results. Decide whether the candidate definitions and execution assumptions are sufficiently frozen for a final evaluation.
3. Select **Run sealed final holdout once**. Confirm the warning. NEXUS partitions the current dataset chronologically:
   - oldest 80%: development sample used by candidate factories;
   - next 2 candles: embargo, excluded from fitting and final scoring;
   - newest 20%: final holdout, evaluated as exactly one test fold.
4. NEXUS fingerprints the full dataset, development sample, holdout sample, candidate IDs and factory source, and effective execution/research configuration.
5. NEXUS reserves the symbol/interval/time range in a device-local ledger before persisting or displaying results. A completed or incomplete reservation blocks any overlapping period for the same symbol and interval, even if a later attempt changes the strategy or configuration.
6. Review the final report once. Do not tune, select, remove or redesign candidates based on the final holdout result. Any strategy change invalidates the final claim and requires a genuinely new future holdout period.

## Guardrails and limitations

- The holdout is the newest contiguous 20% of the currently fetched history; it is not a random split.
- Candidate factories receive only development candles. The explicit embargo candles are not passed to candidate fitting or the test path. The holdout is used only as the single final test fold.
- The current console uses the reviewed baseline candidate factories and the execution assumptions from the current research form. It does not automatically convert fold-specific nested-walk-forward parameter selections into a new global strategy.
- The ledger rejects overlapping time ranges for the same symbol and interval. It is stored in this browser's IndexedDB only. It is an operational guard, not a cryptographic enforcement mechanism: clearing site data, using another browser/device, or modifying local application state can bypass it.
- Keep normal browser storage intact. Export/restore of this ledger is not currently part of the local backup package.
- Dataset and code fingerprints use FNV-1a 32-bit hashes for reproducibility checks, not cryptographic integrity or authentication.
- The ledger stores the manifest and completed report, not a copy of every raw candle.
- Public exchange data can be revised or differ by provider. The recorded provider and dataset fingerprints make the exact evaluated input auditable within the limits of the available source.
- A positive result is not proof of future profitability or statistical significance. The holdout may still be affected by multiple testing, regime dependence, market impact, survivorship and data-source limitations.
- Paper-only. No exchange orders, private credentials or live execution are involved.

## Recovery

An interrupted run can leave a SEALED ledger entry without a report. This is deliberately fail-closed: NEXUS will not silently rerun the same period. Treat the period as consumed. A new final claim requires a later non-overlapping period.

## Mobile use

The workflow runs in the NEXUS static PWA in Android Chrome. It requires no laptop, paid API, subscription or billing activation. The final report is stored locally and should be reviewed before any future strategy change.
