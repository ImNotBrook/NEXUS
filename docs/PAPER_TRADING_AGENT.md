# Automated paper trading

NEXUS has a checkpointed, long-only paper-trading worker. It runs hourly at 5 minutes past the hour (UTC) or manually from GitHub Actions.

## Human approval gate

The persistent branch `nexus-paper-ledger` contains `data/paper-trading-config.json`. It is disabled by default. The worker will not process strategy orders unless the config is explicitly enabled and contains:
- an approved strategy ID and parameters from the reviewed SMA, RSI or Donchian template;
- a human approver and rationale;
- an approval timestamp;
- explicit risk and execution assumptions.

Do not enable a strategy merely because it had the highest return in one research report. Review nested walk-forward results and preserve a final untouched holdout first.

## Execution

- Processes only newly closed hourly candles after the approval checkpoint.
- Replays the available candle history to reconstruct stateful indicators, but processes orders only after the last persisted candle timestamp.
- Fills signal-generated orders at the next candle open using fees, adverse slippage, spread, candle-volume participation and market-impact assumptions.
- Supports partial fills and persistent pending market orders.
- Long-only, no leverage, bounded allocation and daily loss lockout.
- Optional protective stop-loss and take-profit exits use the same adverse stop / limit-target semantics as the execution-aware backtester. Stop remainders continue as market orders; target remainders remain limit orders.
- Persists a versioned checkpoint on the separate `nexus-paper-ledger` branch and uploads a 30-day report artifact.

## Limitations and safety

This is simulated execution only. Candle volume is a coarse liquidity proxy; it does not model order-book depth, queue position, latency, exchange rejects, tick/lot sizes or actual executable liquidity. The current agent does not automatically choose or promote a strategy, and it does not submit live orders.

The ledger branch is part of the public repository. It contains simulated balances and strategy results only; never put credentials, personal data or exchange account information in it. GitHub scheduled jobs are best-effort and can be delayed; a missed run is caught up on the next successful run while the checkpoint remains within the 600-candle history window. The workflow uses no exchange keys and requires no paid service or billing activation.
