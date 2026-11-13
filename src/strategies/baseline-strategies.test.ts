import { describe, expect, it } from "vitest";
import {
  createDonchianBreakout,
  createRsiMeanReversion,
  createSmaCrossover,
} from "./baseline-strategies";
import type { Candle } from "../domain/candles";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    timestamp: index * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  }));
}

describe("baseline strategy evaluators", () => {
  it("detects SMA crossovers using only the current and previous trailing windows", () => {
    const evaluate = createSmaCrossover({ fastPeriod: 2, slowPeriod: 3 });
    const candles = candlesFromCloses([5, 4, 3, 2, 3, 4, 5, 6, 5, 4, 3, 2]);
    const signals = candles.map((_, index) => evaluate(candles.slice(0, index + 1)));
    expect(signals).toContain("buy");
    expect(signals).toContain("sell");
    expect(evaluate(candles.slice(0, 6))).toBe("buy");
  });

  it("detects RSI re-entry from oversold and exit from overbought incrementally", () => {
    const evaluate = createRsiMeanReversion({ period: 2, oversold: 30, overbought: 70 });
    const candles = candlesFromCloses([100, 90, 80, 85, 90, 100, 110, 100]);
    const signals = candles.map((_, index) => evaluate(candles.slice(0, index + 1)));
    expect(signals[3]).toBe("buy");
    expect(signals[7]).toBe("sell");
  });

  it("excludes the current candle from Donchian breakout thresholds", () => {
    const evaluate = createDonchianBreakout({ period: 3 });
    const history = candlesFromCloses([100, 101, 102, 103]);
    history[3] = { ...history[3], high: 200, close: 102 };
    expect(evaluate(history)).toBe("hold");
    const priorBars = candlesFromCloses([100, 101, 102, 103]);
    const breakout = [...priorBars, {
      timestamp: 4 * 60_000, open: 104, high: 106, low: 103, close: 105, volume: 10,
    }];
    expect(evaluate(breakout)).toBe("buy");
  });

  it("validates strategy parameters", () => {
    expect(() => createSmaCrossover({ fastPeriod: 10, slowPeriod: 5 })).toThrow();
    expect(() => createRsiMeanReversion({ period: 14, oversold: 75, overbought: 25 })).toThrow();
    expect(() => createDonchianBreakout({ period: 0 })).toThrow();
  });
});
