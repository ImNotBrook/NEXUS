# Adaptive model training architecture: patterns and constraints

## What is worth reusing conceptually

Freqtrade's FreqAI is a mature open-source example of supervised, periodically retrained market models. Its public documentation describes several useful design patterns:

- A sliding historical training window, with a new model trained at scheduled intervals.
- Separate model identifiers and persisted model artifacts so a previous model can be restored after a restart.
- Historical backtesting that simulates the same periodic retraining schedule rather than training once on the entire sample.
- A warm-up history before the first out-of-sample prediction.
- Explicit feature engineering, target labels, normalization and NaN handling.
- Outlier diagnostics and model expiry controls.
- A distinction between training, inference and the trading execution loop.

These are architecture patterns, not evidence that an arbitrary learned strategy is profitable. NEXUS should adopt the separation of concerns and time-aware evaluation, not copy FreqAI's code.

## NEXUS implementation path

1. Keep research data and model features versioned and timestamped.
2. Generate features only from data available at the prediction timestamp.
3. Fit transformations and model parameters on training windows only.
4. Store each model artifact with a unique version, training range, feature schema, target definition, code commit, evaluation report and creation timestamp.
5. Replay periodic retraining chronologically during historical simulation.
6. Expire stale models and block inference when required features are missing or out of distribution.
7. Compare each candidate model with a fixed baseline on the same validation tasks.
8. Preserve prior versions and rollback on regression.

## Why reinforcement learning is deferred

Freqtrade's own documentation warns that an RL agent can learn reward loopholes rather than economically useful behavior, and that its simplified training environment is not equivalent to the complete execution system. Its documented RL dependency stack adds roughly 700 MB for the PyTorch-based option. That is a poor fit for NEXUS's phone-first, zero-cost initial build.

Start with deterministic rules and supervised models only after the feature/label pipeline, walk-forward evaluation and realistic execution simulator are trustworthy. RL is not a shortcut to trading intelligence.

## Sources

- FreqAI overview: https://github.com/freqtrade/freqtrade/blob/develop/docs/freqai.md
- FreqAI retraining and backtesting: https://github.com/freqtrade/freqtrade/blob/develop/docs/freqai-running.md
- FreqAI feature engineering: https://github.com/freqtrade/freqtrade/blob/develop/docs/freqai-feature-engineering.md
- FreqAI reinforcement-learning caveats: https://github.com/freqtrade/freqtrade/blob/develop/docs/freqai-reinforcement-learning.md

Freqtrade is GPL-3.0. NEXUS uses these documents as design references only; no Freqtrade code is copied into NEXUS.
