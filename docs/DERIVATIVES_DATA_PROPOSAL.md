# Derivatives Data Persistence — Change Proposal and Evaluation

## Proposal

- Change: provider-neutral derivatives observation model and device-local history store
- Schema: IndexedDB version 9
- Scope: market-data persistence only
- Motivation: preserve funding, open-interest and account-ratio observations independently from OHLCV and paper-account state.

## Baseline versus candidate evaluation

| Dimension | Baseline | Candidate | Acceptance evidence |
|---|---|---|---|
| Data semantics | Bybit adapter types local to provider | Shared discriminated union with explicit metric and units | Domain validation tests |
| Provenance | Provider response only | Provider timestamp plus ingestion timestamp | Store round-trip tests |
| Isolation | No derivatives history store | Separate series by provider, symbol, category and metric | IndexedDB store tests |
| Deduplication | Not persisted | Same-series timestamp upsert | Store tests |
| Retention | No local pruning interface | Explicit cutoff-based pruning | Prune tests |
| Safety | Metrics could be misinterpreted downstream | Account-share and contract-unit semantics are enforced | Validation and agent skill requirements |

## Acceptance criteria

1. No derivative metric is stored as an OHLCV candle.
2. All persisted observations pass deterministic schema validation.
3. Provider, symbol, contract category and metric remain isolated.
4. Ingestion time is distinct from exchange observation time.
5. Duplicate observations upsert deterministically.
6. Retention pruning runs inside an active IndexedDB transaction.
7. No new external dependency or paid service is introduced.
8. Existing paper account and candle stores remain unchanged.

## Limitations

The IndexedDB store is device-local and is not a cloud backup. This change does not activate scheduled collection, cross-device sync, strategy features or paper-trading signals. Derivatives metrics remain research context until the scheduled collection and quality pipeline is completed.

## Rollback

Remove the new store adapter and its schema creation after confirming no dependent client data needs migration. Existing stores and paper state are not modified or deleted.
