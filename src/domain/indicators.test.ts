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


describe("additional trend and momentum indicators", () => {
  it("calculates WMA and rate of change with explicit warm-up", async () => {
    const { wma, rateOfChange } = await import("./indicators");
    expect(wma([1, 2, 3, 4], 3)).toEqual([null, null, 14 / 6, 20 / 6]);
    expect(rateOfChange([100, 110, 121], 2).at(-1)).toBeCloseTo(21);
  });

  it("calculates stochastic %K and its smoothed %D", async () => {
    const { stochastic } = await import("./indicators");
    const result = stochastic([10, 12, 13, 14], [8, 9, 11, 12], [9, 11, 13, 14], 2, 2);
    expect(result.k).toEqual([null, 75, 100, 100]);
    expect(result.d).toEqual([null, null, 87.5, 100]);
  });

  it("returns zero CCI for a constant typical price", async () => {
    const { cci } = await import("./indicators");
    expect(cci([11, 11, 11], [9, 9, 9], [10, 10, 10], 2)).toEqual([null, 0, 0]);
  });

  it("calculates ADX and directional indicators for a monotonic rise", async () => {
    const { adx } = await import("./indicators");
    const result = adx([11, 12, 13, 14, 15], [9, 10, 11, 12, 13], [10, 11, 12, 13, 14], 2);
    expect(result.plusDI[2]).toBeCloseTo(50);
    expect(result.minusDI[2]).toBe(0);
    expect(result.adx[2]).toBeNull();
    expect(result.adx[3]).toBeCloseTo(100);
    expect(result.adx[4]).toBeCloseTo(100);
  });
});

describe("volume and channel indicators", () => {
  it("calculates OBV without changing its value on unchanged closes", async () => {
    const { obv } = await import("./indicators");
    expect(obv([10, 11, 11, 9], [5, 2, 3, 4])).toEqual([0, 2, 2, -2]);
  });

  it("calculates cumulative VWAP using typical price and volume", async () => {
    const { vwap } = await import("./indicators");
    expect(vwap([11, 12], [9, 10], [10, 11], [2, 2])).toEqual([10, 10.5]);
  });

  it("calculates MFI and handles zero-flow windows", async () => {
    const { mfi } = await import("./indicators");
    expect(mfi([11, 12, 13], [9, 10, 11], [10, 11, 12], [5, 5, 5], 2).at(-1)).toBe(100);
    expect(mfi([11, 11, 11], [9, 9, 9], [10, 10, 10], [0, 0, 0], 2)).toEqual([null, null, 50]);
  });

  it("calculates prior-window Donchian channels without including the current candle", async () => {
    const { donchianChannels } = await import("./indicators");
    const result = donchianChannels([10, 12, 13], [8, 9, 11], 2);
    expect(result.upper).toEqual([null, null, 12]);
    expect(result.lower).toEqual([null, null, 8]);
    expect(result.middle).toEqual([null, null, 10]);
  });

  it("builds Keltner channels from EMA and ATR", async () => {
    const { atr, ema, keltnerChannels } = await import("./indicators");
    const high = [11, 12, 13, 14];
    const low = [9, 10, 11, 12];
    const close = [10, 11, 12, 13];
    const result = keltnerChannels(high, low, close, 2, 2, 1.5);
    const middle = ema(close, 2);
    const range = atr(high, low, close, 2);
    expect(result.middle).toEqual(middle);
    expect(result.upper[2]).toBeCloseTo(middle[2]! + range[2]! * 1.5);
    expect(result.lower[2]).toBeCloseTo(middle[2]! - range[2]! * 1.5);
  });

  it("rejects invalid volume and mismatched series", async () => {
    const { obv, vwap } = await import("./indicators");
    expect(() => obv([1, 2], [1, -1])).toThrow(/volume/);
    expect(() => vwap([2], [1, 1], [1], [1])).toThrow(/same length/);
  });
});
