import { describe, expect, it } from "vitest";
import { resolveMarketSnapshot } from "./market-data";
import type { MarketDataProvider, MarketSnapshot } from "./market-data";
import type { Candle } from "./candles";

const candles: Candle[] = [
  { timestamp: 1_700_000_000_000, open: 100, high: 110, low: 90, close: 105, volume: 12 },
  { timestamp: 1_700_003_600_000, open: 105, high: 115, low: 100, close: 112, volume: 15 },
];

function provider(name: string, run: () => Promise<Candle[]>): MarketDataProvider {
  return { name, fetchCandles: run };
}

describe("resolveMarketSnapshot", () => {
  it("uses the first healthy provider and caches its validated candles", async () => {
    const saved: MarketSnapshot[] = [];
    const result = await resolveMarketSnapshot(
      [provider("primary", async () => candles), provider("secondary", async () => [])],
      { load: async () => null, save: async (snapshot) => { saved.push(snapshot); } },
      { symbol: "BTCUSDT", interval: "1h", now: 1_700_010_000_000 },
    );
    expect(result.provider).toBe("primary");
    expect(result.stale).toBe(false);
    expect(saved[0]?.candles).toEqual(candles);
  });

  it("falls through to the independent provider when the primary fails", async () => {
    const result = await resolveMarketSnapshot(
      [provider("primary", async () => { throw new Error("offline"); }), provider("secondary", async () => candles)],
      { load: async () => null, save: async () => undefined },
      { symbol: "BTCUSDT", interval: "1h", now: 1_700_010_000_000 },
    );
    expect(result.provider).toBe("secondary");
    expect(result.stale).toBe(false);
  });

  it("uses a stale cached snapshot only when every provider fails", async () => {
    const cached: MarketSnapshot = {
      symbol: "BTCUSDT", interval: "1h", provider: "primary", fetchedAt: 1_700_000_000_000,
      stale: false, candles,
    };
    const result = await resolveMarketSnapshot(
      [provider("primary", async () => { throw new Error("offline"); }), provider("secondary", async () => { throw new Error("offline"); })],
      { load: async () => cached, save: async () => undefined },
      { symbol: "BTCUSDT", interval: "1h", now: 1_700_010_000_000, maxCacheAgeMs: 20_000_000 },
    );
    expect(result.stale).toBe(true);
    expect(result.provider).toBe("primary");
  });

  it("rejects cached data older than the configured maximum age", async () => {
    const cached: MarketSnapshot = {
      symbol: "BTCUSDT", interval: "1h", provider: "primary", fetchedAt: 1,
      stale: false, candles,
    };
    await expect(resolveMarketSnapshot(
      [provider("primary", async () => { throw new Error("offline"); })],
      { load: async () => cached, save: async () => undefined },
      { symbol: "BTCUSDT", interval: "1h", now: 1_000_000, maxCacheAgeMs: 10 },
    )).rejects.toThrow(/no fresh market data/i);
  });

  it("rejects provider data with duplicate candle timestamps", async () => {
    const invalid = [candles[0], { ...candles[1], timestamp: candles[0].timestamp }];
    await expect(resolveMarketSnapshot(
      [provider("primary", async () => invalid)],
      { load: async () => null, save: async () => undefined },
      { symbol: "BTCUSDT", interval: "1h", now: 1_700_010_000_000 },
    )).rejects.toThrow(/no fresh market data/i);
  });
  it("falls through when a provider returns fewer candles than required", async () => {
    const result = await resolveMarketSnapshot(
      [provider("primary", async () => [candles[0]]), provider("secondary", async () => candles)],
      { load: async () => null, save: async () => undefined },
      { symbol: "BTCUSDT", interval: "1h", now: 1_700_010_000_000, minCandles: 2 },
    );
    expect(result.provider).toBe("secondary");
    expect(result.candles).toHaveLength(2);
  });

});
