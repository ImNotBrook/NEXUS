# External trading research catalogue

Updated: 2026-11-14

This catalogue records upstream projects as **research references**, not trusted dependencies. The NEXUS seed catalogue pins each candidate to an immutable full commit SHA and records the observed repository licence, last default-branch commit date, GitHub stars and open issue count. Counts are a snapshot and will change.

The seed function intentionally marks every entry as `quarantined`, with tests, documentation and security review set to unverified. A README or a GitHub licence badge is not a security audit. No source code is cloned, installed, imported or executed.

## Candidate snapshot

| Project | Licence reported by GitHub | Stars | Open issues | Last default-branch commit observed | NEXUS disposition |
|---|---:|---:|---:|---|---|
| [FinRL-X](https://github.com/AI4Finance-Foundation/FinRL-Trading) | Apache-2.0 | 3,939 | 53 | 2026-09-18 | Priority architecture reference; inspect tests and dependencies |
| [Jesse](https://github.com/jesse-ai/jesse) | MIT | 8,803 | 4 | 2026-11-10 | Priority crypto research reference; inspect research API, rule significance and Monte Carlo |
| [LEAN](https://github.com/QuantConnect/Lean) | Apache-2.0 | 22,516 | 305 | 2026-11-13 | Architecture reference for multi-asset event-driven modelling; repository is large |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | Apache-2.0 | 21,200 | 201 | 2026-09-22 | Later market-making and connector research; no current NEXUS execution use |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | MIT | 17,066 | 327 | 2026-10-25 | Educational DRL reference; upstream points new work to FinRL-X |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | GPL-3.0 | 56,853 | 25 | 2026-11-12 | Research reference only; excluded from source adoption by current licence allowlist |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | LGPL-3.0 | 31,508 | 108 | 2026-11-13 | Event-driven execution concepts only; excluded from source adoption by current allowlist |
| [vectorbt](https://github.com/polakowo/vectorbt) | NOASSERTION | 9,842 | 127 | 2026-11-11 | Quarantined pending authoritative licence resolution |
| [backtesting.py](https://github.com/kernc/backtesting.py) | AGPL-3.0 | 9,234 | 110 | 2026-08-05 | Research reference only; excluded from source adoption by current licence allowlist |

GitHub API repository metadata and default-branch commit history were checked on 2026-11-14. Licence labels are GitHub's SPDX metadata, not a substitute for reading the complete licence text and notices.

## Priority findings

### 1. FinRL-X — modular strategy and portfolio interface

FinRL-X documents a composable data → strategy → backtest → execution architecture. Its strategy pipeline separates selection, allocation, timing and risk overlay, with target portfolio weights as the interface contract. This is a useful pattern for NEXUS's future multi-asset layer: strategy logic proposes desired exposure; a separate risk layer clamps it; a separate broker/paper adapter handles orders.

**NEXUS adaptation:** implement a typed target-exposure/portfolio-intent contract and risk overlay in NEXUS's own TypeScript domain. Do not copy broker execution code or connect Alpaca. FinRL-X's documented stack uses Python, SQLite, external market-data sources and Alpaca integrations; it is not a drop-in mobile dependency.

### 2. Jesse — crypto research validation

Jesse documents multi-symbol/timeframe backtesting, a research API, rule-significance testing and Monte Carlo analysis. Its repository exposes a tests directory and research tooling in its README.

**NEXUS adaptation:** borrow the research workflow concepts, not the strategy claims: (a) test a candidate entry rule against a random-entry null, (b) bootstrap/shuffle trade order to estimate path sensitivity, (c) perturb candle paths, and (d) compare across untouched chronological windows. NEXUS must independently validate implementation details, assumptions and data requirements before relying on these diagnostics.

### 3. LEAN — event-driven modelling

LEAN documents modular datafeed, transaction processing, algorithm state and result-processing components. It is useful as a system-design reference for separating market data, order simulation, portfolio state and reporting.

**NEXUS adaptation:** retain provider-neutral adapters and a distinct broker/portfolio boundary. LEAN's repository size and .NET/Python runtime make importing it into this Android-first TypeScript PWA unsuitable.

### 4. Freqtrade / FreqAI — adaptive model research, not source reuse

Freqtrade is a prominent crypto framework with backtesting, optimisation and FreqAI adaptive-model workflows. Its GPL-3.0 licence is outside NEXUS's current permissive allowlist. Use published documentation and concepts as research inputs only; do not copy code. Any future model work must use chronological train/test separation, feature availability timestamps, retraining windows, model-version provenance and out-of-sample evaluation.

### 5. FinRL original versus FinRL-X

The original FinRL README now positions that repository as an educational/research framework and directs new production-oriented work to FinRL-X. NEXUS therefore prioritises FinRL-X architecture and keeps the original FinRL repository as a historical DRL research reference.

## Adoption decision

**No third-party code is approved for import at this stage.** The current registry records candidates only. Before any source adoption, a separate review must:
1. Pin the exact commit and inspect the full licence, notices and dependency licences.
2. Inspect install/build scripts, transitive dependencies, network access, file-system access, secrets handling and dynamic code loading.
3. Identify tests and execute them in a disposable isolated environment; record exact commands and results.
4. Review data leakage, look-ahead, survivorship, transaction costs, fill assumptions and model-selection bias in any trading logic.
5. Port only the minimum required method into NEXUS's existing typed TypeScript interfaces, with independent tests.
6. Require explicit human approval. A catalogue approval still cannot enable code execution or live trading.

## Important limitations

- GitHub stars and issue counts are popularity/maintenance signals, not quality or profitability.
- Open issue counts are not bug counts; many are feature requests or discussions.
- The last commit date is not the same as the last release date.
- No repository's reported backtest performance is accepted as evidence of a tradable edge.
- A trading strategy must still pass NEXUS's realistic fees, slippage, walk-forward, untouched-holdout and trade-count requirements.
- External model code, pretrained weights and Python dependencies are not suitable for the current Android-only PWA runtime without a separate, costed architecture review.

## Sources

- https://github.com/AI4Finance-Foundation/FinRL-Trading
- https://github.com/jesse-ai/jesse
- https://github.com/QuantConnect/Lean
- https://github.com/hummingbot/hummingbot
- https://github.com/AI4Finance-Foundation/FinRL
- https://github.com/freqtrade/freqtrade
- https://github.com/nautechsystems/nautilus_trader
- https://github.com/polakowo/vectorbt
- https://github.com/kernc/backtesting.py


## Source-level review update (2026-11-14)

Jesse and FinRL-X were inspected at immutable commit revisions. The review found useful execution-cutoff, gap-fill, significance-testing and bootstrap test patterns in Jesse. FinRL-X offers a target-weight portfolio-intent architecture and configurable commissions, but its inspected walk-forward runner generates decisions from training slices without simulating subsequent OOS execution; its backtest wrapper also does not explicitly lag weight signals to next-bar fills. See [the pinned source-level review](./EXTERNAL_SOURCE_REVIEW_2026-11-14.md) for reviewed files, findings and NEXUS adoption decisions.

Both remain quarantined. Reading selected tests and source is not equivalent to executing a full test suite or completing a security audit, so catalogue test/documentation/security verification flags remain false.
