import { describe, expect, it } from "vitest";
import { validateCandles, type Candle } from "./candles";

const valid: Candle[] = [
  { timestamp: 1_700_000_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12 },
  { timestamp: 1_700_000_060_000, open: 105, high: 112, low: 101, close: 108, volume: 9 },
];

describe("validateCandles", () => {
  it("accepts valid, strictly chronological OHLCV candles", () => {
    expect(validateCandles(valid)).toEqual(valid);
  });

  it("rejects duplicate or descending timestamps rather than silently reordering", () => {
    expect(() => validateCandles([valid[0], valid[0]])).toThrow(/strictly increasing/);
    expect(() => validateCandles([...valid].reverse())).toThrow(/strictly increasing/);
  });

  it("rejects impossible OHLC relationships", () => {
    expect(() => validateCandles([{ ...valid[0], high: 99 }])).toThrow(/OHLC/);
    expect(() => validateCandles([{ ...valid[0], low: 106 }])).toThrow(/OHLC/);
  });

  it("rejects negative volume, non-finite values and invalid timestamps", () => {
    expect(() => validateCandles([{ ...valid[0], volume: -1 }])).toThrow(/volume/);
    expect(() => validateCandles([{ ...valid[0], close: Number.NaN }])).toThrow(/finite/);
    expect(() => validateCandles([{ ...valid[0], timestamp: 1.2 }])).toThrow(/timestamp/);
  });

  it("does not mutate the input array", () => {
    const input = [...valid];
    validateCandles(input);
    expect(input).toEqual(valid);
  });
});
