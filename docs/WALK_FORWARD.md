# Walk-forward validation

NEXUS includes a deterministic chronological fold generator in `src/domain/walk-forward.ts`.

## Configuration

- `trainBars`: minimum training history for the first fold.
- `testBars`: fixed number of out-of-sample candles per fold.
- `stepBars`: distance between test-window starts; defaults to `testBars`.
- `embargoBars`: candles excluded between each training window and its test window.
- `expanding`: defaults to true. When false, training uses a fixed rolling window of `trainBars` candles.

Only complete test windows are emitted. Training, embargo and test slices are chronological, and every candle object and fold slice is frozen. Input candles are validated using the shared OHLCV domain validator.

## Correct use

For each fold, use `train` only for model/parameter selection. Freeze the selected configuration before evaluating on `test`. Never tune parameters using a fold's test results and then report those same results as unbiased performance. Aggregate out-of-sample results across folds and retain a final untouched holdout period for the final model-selection audit.

## Limitations

This module partitions data; it does not select strategies, tune parameters, execute backtests, or calculate performance statistics. It does not solve survivorship bias, data snooping, multiple-testing bias, regime shift, or market microstructure modelling. Embargo bars reduce some temporal leakage but cannot guarantee independence between observations. Choose window sizes based on the strategy horizon and data frequency, not to maximise a reported score.
