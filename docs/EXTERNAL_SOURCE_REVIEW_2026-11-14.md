# External source-level review: Jesse and FinRL-X

Review date: 2026-11-14  
Scope: read-only source inspection at immutable upstream commits. No repository was cloned, installed, executed or imported into NEXUS.

## Pinned revisions and metadata

| Project | Commit | GitHub SPDX | Stars snapshot | Open issues snapshot |
|---|---|---|---:|---:|
| Jesse | [9afc357a5675a44b31dbf5d7c5244112a2c262cb](https://github.com/jesse-ai/jesse/commit/9afc357a5675a44b31dbf5d7c5244112a2c262cb) | MIT | 8,803 | 4 |
| FinRL-X | [4409abe925c904e570be78ebfb5e77ac3491dff8](https://github.com/AI4Finance-Foundation/FinRL-Trading/commit/4409abe925c904e570be78ebfb5e77ac3491dff8) | Apache-2.0 | 3,939 | 53 |

Metadata is a point-in-time GitHub API snapshot, not a quality score.

## Jesse: source review

Reviewed source/test files:

- [Backtest runner](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/jesse/modes/backtest_mode.py)
- [Exchange abstraction](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/jesse/exchanges/exchange.py)
- [Candle execution cutoff tests](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/tests/test_candle_execution_cutoff.py)
- [Price-gap execution tests](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/tests/test_price_gap_backtest.py)
- [Rule-significance tests](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/tests/test_rule_significance_testing.py)
- [Moving-block bootstrap tests](https://github.com/jesse-ai/jesse/blob/9afc357a5675a44b31dbf5d7c5244112a2c262cb/tests/test_moving_block_bootstrap.py)

### What the inspected code demonstrates

1. **Execution-boundary protection:** candle cutoff tests assert that strategy reads exclude a candle opening at the execution boundary, while still permitting a larger timeframe candle that is genuinely forming at that boundary. The tests also cover thread-local cutoff behavior and trades updating the forming candle.
2. **Gap-aware order handling:** price-gap tests explicitly construct market gaps across stop-loss and take-profit levels and assert fills at the next available opening price rather than the stale requested trigger. The tests assert fee-inclusive PnL and fee totals; the test configuration uses a 0.1% fee. The tests exercise both standard and fast simulation modes.
3. **Research diagnostics:** rule-significance tests compare a random signal against a structured trend signal, use deterministic seeds, check reproducibility across worker counts, and verify runtime/input cleanup on failure.
4. **Synthetic path sanity:** moving-block bootstrap tests check deterministic seeds, positive price paths, valid OHLC relationships and preservation of percentage-volatility scale within a tolerance.

### Limitations and unresolved questions

- These are selected tests and source files, not a full code audit or proof that every strategy path is causal.
- A significance-test p-value is conditional on the tested null, sample, signal-generation process and assumptions. It does not establish a persistent tradable edge, and it does not by itself account for all strategy trials or data snooping.
- The inspected bootstrap tests validate synthetic candle generation properties; they do not establish that every Monte Carlo or trade-resampling workflow gives calibrated risk estimates.
- The exchange abstraction is an interface contract, not proof of realistic queue position, spread, partial fills, latency or market impact.
- We did not execute the upstream tests or inspect every exchange driver, dependency, install script, credential path or dynamic-loading boundary.

### NEXUS decision

**Use Jesse as a research-method reference, not as a dependency.** Port only independently specified concepts: execution-boundary tests, gap-aware stop fills, reproducible null-signal tests and OHLC-preserving block bootstrap checks. NEXUS's own next-open backtester remains the canonical engine until a parity test demonstrates that any alternative is at least as conservative.

## FinRL-X: source review

Reviewed source/test files:

- [Backtest engine](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/src/backtest/backtest_engine.py)
- [Walk-forward implementation](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/src/strategies/adaptive_rotation/walk_forward.py)
- [Point-in-time data preprocessor](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/src/strategies/adaptive_rotation/data_preprocessor.py)
- [Risk manager](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/src/strategies/adaptive_rotation/risk_manager.py)
- [Strategy interface](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/src/strategies/base_strategy.py)
- [Dependency manifest](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/4409abe925c904e570be78ebfb5e77ac3491dff8/requirements.txt)

### What the inspected code demonstrates

1. **Portfolio intent abstraction:** strategy output is a target-weight table; selection, weighting and rebalance are separate algorithm steps. This is a useful architecture pattern for NEXUS's strategy → portfolio intent → risk overlay → paper broker boundary.
2. **Explicit transaction costs:** the backtest engine configures a proportional commission callback using absolute traded quantity × price × configured transaction-cost rate. It also supports an optional `bt` CostModel path with volume and volatility inputs.
3. **Point-in-time slicing primitive:** `get_data_as_of_date` supports inclusive or exclusive date cutoffs and copies the sliced frames. The default is inclusive.
4. **Important walk-forward limitation:** the inspected `WalkForwardAnalyzer.run_backtest` generates decision periods, loads training data as of each decision date, invokes the supplied strategy function on that training data, and collects the returned objects. It does not itself pass the subsequent test-period data through an execution simulator or compute out-of-sample portfolio returns. It is a walk-forward decision/weight-generation scaffold, not a complete OOS backtest by itself.
5. **Execution timing remains unresolved:** the backtest engine aligns and forward-fills weight signals to the price calendar, then runs `RunOnDate`, `WeighTarget` and `Rebalance` on signal dates. The inspected wrapper does not explicitly lag signals to the next bar. The precise fill convention depends on the underlying `bt` engine semantics and requires a focused timing test before results could be trusted.
6. **Risk manager limitations:** the inspected stop module updates peak prices using supplied current prices before checking trailing stops. This can create same-observation high/close ordering ambiguity if callers supply a bar's close while also treating that bar's high as an already-known peak. It also does not, in the inspected functions, enforce positive finite entry/current/peak prices or validate stop thresholds.

### Repository test posture

The inspected default-branch tree did not expose an obvious project test suite directory for this repository snapshot, despite pytest appearing in requirements. This is not proof that no tests exist in other branches or external/private CI. No upstream tests were executed.

### NEXUS decision

**Use FinRL-X as an architecture reference only.** Do not reuse its backtest result as NEXUS OOS evidence. Any adaptation must add explicit signal lag/fill semantics, non-overlapping OOS execution, realistic spread/slippage/fees and independent synthetic timing tests. The current NEXUS walk-forward engine already separates train, embargo and test windows and fills at the next candle open; preserve that stricter contract.

## Adoption and verification status

- No third-party code copied into NEXUS.
- No dependency added.
- No external script or binary executed.
- Both candidates remain quarantined in the skill registry.
- Tests/documentation/security verification flags remain false: reading selected test files is not the same as executing the complete suite; reading selected source is not a security audit.
- These source reviews are research evidence only. They do not authorize approval, installation, autonomous skill execution or live trading.

## Immediate NEXUS engineering actions

1. Upgrade catalogue revision pins from abbreviated SHA values to the full commit SHAs above.
2. Add NEXUS regression tests for next-bar signal execution, gap-through-stop fills, fee accounting, same-bar high/close ambiguity and point-in-time cutoffs.
3. Add a walk-forward leakage test that fails if any training/feature input includes timestamps after the decision cutoff.
4. Keep third-party skill approval and code execution disabled until an isolated test runner, dependency review and security review are available.
