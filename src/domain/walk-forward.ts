import { validateCandles, type Candle } from "./candles";

export interface WalkForwardConfig {
  trainBars: number;
  testBars: number;
  stepBars?: number;
  embargoBars?: number;
  expanding?: boolean;
}

export interface WalkForwardFold {
  index: number;
  train: readonly Candle[];
  test: readonly Candle[];
  embargo: readonly Candle[];
}

function assertInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(name + " must be a safe integer >= " + minimum);
  }
}

/**
 * Builds chronological walk-forward folds. Training data always precedes the
 * embargo and test window. Only complete test windows are returned.
 */
export function buildWalkForwardFolds(
  inputCandles: readonly Candle[],
  config: WalkForwardConfig,
): WalkForwardFold[] {
  const { trainBars, testBars } = config;
  const stepBars = config.stepBars ?? testBars;
  const embargoBars = config.embargoBars ?? 0;
  const expanding = config.expanding ?? true;

  assertInteger(trainBars, "trainBars", 1);
  assertInteger(testBars, "testBars", 1);
  assertInteger(stepBars, "stepBars", 1);
  if (stepBars < testBars) throw new RangeError("stepBars must be >= testBars to keep test windows disjoint");
  assertInteger(embargoBars, "embargoBars", 0);
  if (typeof expanding !== "boolean") throw new TypeError("expanding must be boolean");

  const candles = validateCandles(inputCandles).map((candle) => Object.freeze({ ...candle }));
  const firstTestStart = trainBars + embargoBars;
  if (candles.length < firstTestStart + testBars) {
    throw new RangeError("Dataset is too short for one complete walk-forward fold");
  }

  const folds: WalkForwardFold[] = [];
  for (let testStart = firstTestStart; testStart + testBars <= candles.length; testStart += stepBars) {
    const trainEnd = testStart - embargoBars;
    const trainStart = expanding ? 0 : Math.max(0, trainEnd - trainBars);
    const train = candles.slice(trainStart, trainEnd);
    const embargo = candles.slice(trainEnd, testStart);
    const test = candles.slice(testStart, testStart + testBars);
    if (train.length !== (expanding ? trainEnd : trainBars)) {
      throw new Error("Walk-forward training window is incomplete");
    }
    folds.push(Object.freeze({
      index: folds.length,
      train: Object.freeze(train),
      embargo: Object.freeze(embargo),
      test: Object.freeze(test),
    }));
  }

  if (folds.length === 0) throw new RangeError("No complete walk-forward folds could be generated");
  return folds;
}
