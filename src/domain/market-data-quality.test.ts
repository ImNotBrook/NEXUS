import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import type { MarketSnapshot } from "./market-data";
import { compareMarketSnapshots, validateSnapshotQuality } from "./market-data-quality";

const base = Math.floor(1_700_000_000_000 / 3_600_000) * 3_600_000;
const candles: Candle[] = [
  { timestamp: base, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { timestamp: base + 3_600_000, open: 101, high: 103, low: 100, close: 102, volume: 12 },
  { timestamp: base + 7_200_000, open: 102, high: 104, low: 101, close: 103, volume: 11 },
];

function snapshot(provider: string, rows: Candle[], fetchedAt = base + 10_800_000): MarketSnapshot {
  return { symbol: "BTCUSDT", interval: "1h", provider, fetchedAt, stale: false, candles: rows };
}

describe("validateSnapshotQuality", () => {
  it("passes a complete, fresh hourly snapshot", () => {
    const result = validateSnapshotQuality(snapshot("Binance", candles), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("pass");
    expect(result.issues).toHaveLength(0);
  });

  it("fails when one or more expected candles are missing", () => {
    const result = validateSnapshotQuality(snapshot("Binance", [candles[0], candles[2]]), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.code === "CANDLE_GAP")).toBe(true);
  });

  it("fails candle timestamps that are not aligned to the requested interval", () => {
    const misaligned = candles.map((candle) => ({ ...candle, timestamp: candle.timestamp + 1_000 }));
    const result = validateSnapshotQuality(snapshot("Binance", misaligned), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.code === "MISALIGNED_CANDLE")).toBe(true);
  });

  it("warns on zero-volume candles without treating them as invalid OHLC", () => {
    const rows = [candles[0], { ...candles[1], volume: 0 }, candles[2]];
    const result = validateSnapshotQuality(snapshot("Binance", rows), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("warning");
    expect(result.issues.some((issue) => issue.code === "ZERO_VOLUME")).toBe(true);
  });

  it("fails snapshots that are stale or timestamped in the future", () => {
    const stale = validateSnapshotQuality(snapshot("Binance", candles, base), {
      now: base + 11_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    const future = validateSnapshotQuality(snapshot("Binance", candles, base + 9_000_000), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(stale.status).toBe("fail");
    expect(future.issues.some((issue) => issue.code === "FUTURE_SNAPSHOT")).toBe(true);
  });


  it("fails when the latest candle has not closed yet", () => {
    const result = validateSnapshotQuality(snapshot("Binance", candles, base + 10_600_000), {
      now: base + 10_700_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.code === "INCOMPLETE_LAST_CANDLE")).toBe(true);
  });

  it("fails when the latest completed candle is too old even if the fetch is recent", () => {
    const result = validateSnapshotQuality(snapshot("Binance", candles, base + 20 * 3_600_000 - 100_000), {
      now: base + 20 * 3_600_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.code === "LAST_CANDLE_STALE")).toBe(true);
  });

  it("fails malformed candle sequences using the shared candle validator", () => {
    const duplicate = [candles[0], { ...candles[1], timestamp: candles[0].timestamp }];
    const result = validateSnapshotQuality(snapshot("Binance", duplicate), {
      now: base + 10_900_000, intervalMs: 3_600_000, maxAgeMs: 300_000,
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.code === "INVALID_CANDLES")).toBe(true);
  });
});

describe("compareMarketSnapshots", () => {
  it("flags overlapping candle closes beyond the configured basis-point threshold", () => {
    const secondary = candles.map((candle) => ({ ...candle, close: candle.close * 1.01, high: Math.max(candle.high, candle.close * 1.01) }));
    const result = compareMarketSnapshots(snapshot("Binance", candles), snapshot("Kraken", secondary), 20);
    expect(result.status).toBe("discrepancy");
    expect(result.comparedCandles).toBe(3);
    expect(result.maxDeviationBps).toBeGreaterThan(20);
  });

  it("passes when overlapping closes are within tolerance", () => {
    const secondary = candles.map((candle) => ({ ...candle, close: candle.close * 1.0001, high: Math.max(candle.high, candle.close * 1.0001) }));
    const result = compareMarketSnapshots(snapshot("Binance", candles), snapshot("Kraken", secondary), 20);
    expect(result.status).toBe("within_tolerance");
  });

  it("reports insufficient overlap instead of inventing a comparison", () => {
    const result = compareMarketSnapshots(
      snapshot("Binance", candles),
      snapshot("Kraken", [{ ...candles[0], timestamp: base + 99_000_000 }]),
      20,
    );
    expect(result.status).toBe("insufficient_overlap");
    expect(result.comparedCandles).toBe(0);
  });


  it("requires the latest candle timestamp to overlap, not merely older candles", () => {
    const result = compareMarketSnapshots(
      snapshot("Binance", candles),
      snapshot("Kraken", candles.slice(0, 2)),
      20,
    );
    expect(result.status).toBe("insufficient_overlap");
    expect(result.latestTimestampMatched).toBe(false);
  });

  it("rejects invalid thresholds", () => {
    expect(() => compareMarketSnapshots(snapshot("A", candles), snapshot("B", candles), -1)).toThrow();
  });
});
