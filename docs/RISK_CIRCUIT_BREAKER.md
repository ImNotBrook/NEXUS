# Risk Circuit Breaker

## Current scope

`src/domain/risk-circuit-breaker.ts` is a pure, deterministic policy engine. It currently provides the reusable decision logic; it is **not yet wired into the persistent paper-trading worker**. Existing paper trading therefore continues to use only its previously approved daily-loss control.

No new risk threshold is enabled by this change. The caller must supply an explicitly reviewed configuration:

- Weekly loss from UTC week-start equity.
- Weekly peak-to-trough drawdown.
- Monthly loss from UTC month-start equity.
- Monthly peak-to-trough drawdown.
- Consecutive completed losing trades and cooldown duration.
- A data-quality health flag.

## Behaviour

- UTC weeks begin Monday at 00:00 UTC; UTC months begin on the first day at 00:00 UTC.
- Weekly and monthly loss/drawdown breaches latch until the corresponding UTC period rolls over. A temporary equity recovery does not silently re-enable entries.
- A winning completed trade resets the consecutive-loss count. A neutral trade leaves it unchanged.
- Reaching the configured loss streak starts a timestamp-based cooldown and resets the streak counter for the next sequence.
- Data-quality failure blocks new entries. It clears only after a later observation explicitly reports healthy data.
- Risk-reducing exits are always permitted. The engine does not itself submit, cancel, or route orders.

## Integration contract

The caller must:
1. Persist the returned state atomically with the paper ledger.
2. Advance it exactly once per newly processed, closed market observation.
3. Pass marked-to-market equity after accounting for fees and fills.
4. Pass each newly completed trade's net P&L exactly once, after fees and execution costs.
5. Set data quality to unhealthy whenever source validation, freshness, continuity, or candle integrity checks fail.
6. Gate only new entries; never block stop-losses, take-profits, or other risk-reducing exits.

Timestamps must be monotonically increasing safe integer Unix milliseconds. State validation fails closed on malformed or stale updates.

## Safety and rollout

This module is deliberately separate from the paper worker so that risk thresholds are not silently changed as part of a code deployment. Before integration, the owner must approve exact thresholds and cooldown duration. The integration change must add persisted-state migration/recovery tests, prove that the existing daily loss lock remains effective, and prove that exit orders continue through every entry halt.

This remains paper-only. It adds no exchange credentials, live order routing, paid dependencies, or autonomous risk-limit changes.
