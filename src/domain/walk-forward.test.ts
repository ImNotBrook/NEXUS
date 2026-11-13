import { describe, expect, it } from "vitest";
import { buildWalkForwardFolds } from "./walk-forward";
import type { Candle } from "./candles";

const candles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10,
}));

describe("buildWalkForwardFolds", () => {
  it("builds chronological expanding training windows and disjoint test windows", () => {
    const folds = buildWalkForwardFolds(candles, { trainBars: 8, testBars: 4, stepBars: 4, embargoBars: 1 });
    expect(folds).toHaveLength(2);
    expect(folds[0].train).toHaveLength(8);
    expect(folds[0].test).toHaveLength(4);
    expect(folds[0].train.at(-1)?.timestamp).toBeLessThan(folds[0].test[0].timestamp);
    expect(folds[1].train).toHaveLength(12);
    expect(folds[1].test).toHaveLength(4);
    expect(folds[1].train.at(-1)?.timestamp).toBeLessThan(folds[1].test[0].timestamp);
    expect(folds[0].test.at(-1)?.timestamp).toBeLessThan(folds[1].test[0].timestamp);
  });

  it("uses a fixed rolling training window when expanding is disabled", () => {
    const folds = buildWalkForwardFolds(candles, {
      trainBars: 6, testBars: 3, stepBars: 3, embargoBars: 0, expanding: false,
    });
    expect(folds).toHaveLength(4);
    expect(folds.every((fold) => fold.train.length === 6)).toBe(true);
    expect(folds[1].train[0].timestamp).toBeGreaterThan(folds[0].train[0].timestamp);
  });

  it("rejects overlapping test windows, invalid sizes and datasets without a complete fold", () => {
    expect(() => buildWalkForwardFolds(candles, { trainBars: 0, testBars: 4 })).toThrow();
    expect(() => buildWalkForwardFolds(candles, { trainBars: 6, testBars: 4, stepBars: 2 })).toThrow();
    expect(() => buildWalkForwardFolds(candles.slice(0, 5), { trainBars: 4, testBars: 4 })).toThrow();
  });

  it("does not mutate the supplied candle series or expose mutable candle objects", () => {
    const source = candles.map((candle) => ({ ...candle }));
    const folds = buildWalkForwardFolds(source, { trainBars: 8, testBars: 4 });
    expect(source).toEqual(candles);
    expect(Object.isFrozen(folds[0].train[0])).toBe(true);
    expect(Object.isFrozen(folds[0].test[0])).toBe(true);
  });

  it("keeps every fold's training and embargo timestamps strictly before its test window", () => {
    const folds = buildWalkForwardFolds(candles, {
      trainBars: 7, testBars: 3, stepBars: 3, embargoBars: 2, expanding: true,
    });
    for (const fold of folds) {
      const testStart = fold.test[0].timestamp;
      expect(fold.train.every((bar) => bar.timestamp < testStart)).toBe(true);
      expect(fold.embargo.every((bar) => bar.timestamp < testStart)).toBe(true);
      expect(fold.train.at(-1)!.timestamp).toBeLessThan(fold.embargo[0].timestamp);
      expect(fold.embargo.at(-1)!.timestamp).toBeLessThan(testStart);
      expect(fold.test.every((bar) => bar.timestamp >= testStart)).toBe(true);
    }
  });

});