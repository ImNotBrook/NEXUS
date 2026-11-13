import { describe, expect, it } from "vitest";
import { atr, bollingerBands, ema, macd, rsi, sma } from "./indicators";

describe("moving averages", () => {
  it("calculates SMA with null warm-up values", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds EMA with the first SMA and applies the standard smoothing factor", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("rejects invalid periods and non-finite observations", () => {
    expect(() => sma([1, 2], 0)).toThrow(/period/);
    expect(() => ema([1, Number.POSITIVE_INFINITY], 2)).toThrow(/finite/);
  });
});

describe("RSI", () => {
  it("uses Wilder smoothing and returns 100 for a monotonic rise", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, null, 100, 100, 100]);
  });

  it("returns 0 for a monotonic fall and 50 for a flat series", () => {
    expect(rsi([6, 5, 4, 3, 2, 1], 3)).toEqual([null, null, null, 0, 0, 0]);
    expect(rsi([5, 5, 5, 5, 5], 2)).toEqual([null, null, 50, 50, 50]);
  });
});

describe("ATR", () => {
  it("uses true range and Wilder smoothing", () => {
    const high = [10, 12, 13, 14];
    const low = [8, 9, 11, 12];
    const close = [9, 11, 12, 13];
    expect(atr(high, low, close, 2)).toEqual([null, 2.5, 2.25, 2.125]);
  });

  it("rejects mismatched or invalid OHLC series", () => {
    expect(() => atr([2, 3], [1], [1, 2], 2)).toThrow(/same length/);
    expect(() => atr([1], [2], [1], 1)).toThrow(/OHLC/);
  });
});

describe("MACD and Bollinger Bands", () => {
  it("keeps MACD outputs null until each component is warmed up", () => {
    const result = macd(Array.from({ length: 40 }, (_, i) => i + 1), 3, 5, 2);
    expect(result.macd.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result.signal.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(result.histogram.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(result.histogram[5]).toBeCloseTo(0);
  });

  it("calculates population-standard-deviation Bollinger bands", () => {
    const result = bollingerBands([1, 2, 3], 3, 2);
    expect(result.middle).toEqual([null, null, 2]);
    expect(result.upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3));
    expect(result.lower[2]).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3));
  });
});
