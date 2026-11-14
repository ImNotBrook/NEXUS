# Best-first research result ordering

NEXUS orders strategy research results deterministically so the strongest evidence appears first rather than relying on source-array order.

## Single research batch

Candidate ordering is lexicographic, not a weighted score:

1. `REVIEW_FOR_PAPER` before `FRAGILE` before `INSUFFICIENT_SAMPLE`.
2. More completed trades, capped at the 30-trade sufficiency threshold.
3. More out-of-sample folds, capped at five.
4. Higher positive-fold percentage.
5. Higher worst-fold return.
6. Higher net expectancy.
7. Lower worst-fold drawdown.
8. Higher compounded out-of-sample return.
9. Stable candidate ID as final tie-breaker.

The robustness status and thresholds are inherited from the existing Stage 7 methodology. Ranking does not change status, metrics, qualification policy or strategy configuration.

## Execution stress shortlist

The stress report separately orders candidates by sample sufficiency across every scenario (at least 30 completed trades and five folds), highest worst-case out-of-sample return, median scenario return, lowest worst-case drawdown, highest worst-case expectancy, then stable candidate ID.

The detailed scenario table remains available below the shortlist. Every scenario is still saved to experiment history.

## Safety and interpretation

- This is deterministic display ordering, not random selection.
- No candidate is automatically promoted, paper-traded or live-traded.
- The ranking does not use the sealed final holdout to choose a strategy.
- Tuning after inspecting the same walk-forward or stress results creates selection bias. Preserve the final holdout for a one-shot evaluation.
- `REVIEW_FOR_PAPER` is a research review state, not a profitability claim.