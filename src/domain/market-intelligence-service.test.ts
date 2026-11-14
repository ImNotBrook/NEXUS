import { describe, expect, it } from "vitest";
import {
  loadMarketIntelligence,
  type MarketIntelligenceServiceInput,
} from "./market-intelligence-service";
import type { MarketDataProvider, MarketSnapshot, MarketSnapshotCache } from "./market-data";
import type { Candle } from "./candles";

const NOW = 1_800_000_000_000;
const INTERVALS: Record<string, number> = {
  "1d": 86_400_000,
  "4h": 14_400_000,
  "1h": 3_600_000,
  "15m": 900_000,
};
const CONFIG = {
  fastEmaPeriod: 5,
  slowEmaPeriod: 13,
  atrPeriod: 14,
  trendThresholdPct: 0.1,
  lowVolatilityAtrPct: 0.3,
  highVolatilityAtrPct: 1.5,
};

function makeCandles(interval: string, priceOffset = 0, count = 60): Candle[] {
  const intervalMs = INTERVALS[interval];
  const boundary = Math.floor(NOW / intervalMs) * intervalMs;
  const start = boundary - count * intervalMs;
  const referenceStart = boundary - 60 * intervalMs;
  return Array.from({ length: count }, (_, index) => {
    const close = 1_000 + ((start + index * intervalMs - referenceStart) / intervalMs) * 2 + priceOffset;
    return {
      timestamp: start + index * intervalMs,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + index,
    };
  });
}

class MemoryCache implements MarketSnapshotCache {
  snapshots = new Map<string, MarketSnapshot>();
  async load(symbol: string, interval: string): Promise<MarketSnapshot | null> {
    return this.snapshots.get(symbol + ":" + interval) ?? null;
  }
  async save(snapshot: MarketSnapshot): Promise<void> {
    this.snapshots.set(snapshot.symbol + ":" + snapshot.interval, snapshot);
  }
}

function provider(
  name: string,
  options: {
    failIntervals?: string[];
    priceOffsetByInterval?: Record<string, number>;
    candleCountByInterval?: Record<string, number>;
    addIncompleteCandle?: boolean;
  } = {},
): MarketDataProvider {
  return {
    name,
    async fetchCandles(request) {
      if (options.failIntervals?.includes(request.interval)) throw new Error(name + " unavailable");
      const candles = makeCandles(
        request.interval,
        options.priceOffsetByInterval?.[request.interval] ?? 0,
        options.candleCountByInterval?.[request.interval] ?? 60,
      );
      if (options.addIncompleteCandle) {
        const intervalMs = INTERVALS[request.interval];
        const boundary = Math.floor(NOW / intervalMs) * intervalMs;
        candles.push({
          timestamp: boundary,
          open: 9_000,
          high: 9_100,
          low: 8_900,
          close: 9_000,
          volume: 10_000,
        });
      }
      return candles;
    },
  };
}

function serviceInput(overrides: Partial<MarketIntelligenceServiceInput> = {}): MarketIntelligenceServiceInput {
  return {
    symbol: "BTCUSDT",
    instrumentCategory: "spot",
    volumeUnit: "base",
    evaluationTime: NOW,
    config: CONFIG,
    providers: [provider("binance"), provider("kraken")],
    cache: new MemoryCache(),
    ...overrides,
  };
}

describe("loadMarketIntelligence", () => {
  it("loads all four frames, validates closed candles and confirms the 1H cross-feed", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance", { addIncompleteCandle: true }),
        provider("kraken", { addIncompleteCandle: true }),
      ],
    }));
    expect(result.snapshot.dataQuality).toBe("pass");
    expect(result.snapshot.coverage.availableTimeframes).toBe(4);
    expect(result.crossFeedStatus).toBe("within_tolerance");
    expect(result.marketDataTrusted).toBe(true);
    expect(result.snapshots["1h"]?.candles.at(-1)?.timestamp)
      .toBe(Math.floor(NOW / INTERVALS["1h"]) * INTERVALS["1h"]);
    expect(result.snapshot.frames["1h"].latestCandleAt)
      .toBe(result.snapshots["1h"]?.candles.at(-2)?.timestamp);
  });

  it("falls back to the secondary provider for an unavailable timeframe", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance", { failIntervals: ["1d"] }),
        provider("kraken"),
      ],
    }));
    expect(result.snapshot.frames["1d"].status).toBe("available");
    expect(result.snapshot.frames["1d"].provider).toBe("kraken");
    expect(result.snapshot.dataQuality).toBe("pass");
    expect(result.frameFailures["1d"]).toBeUndefined();
  });

  it("marks a cross-feed price discrepancy as failed and locks paper eligibility", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance"),
        provider("kraken", { priceOffsetByInterval: { "1h": 30 } }),
      ],
    }));
    expect(result.crossFeedStatus).toBe("discrepancy");
    expect(result.snapshot.frames["1h"].status).toBe("failed");
    expect(result.marketDataTrusted).toBe(false);
    expect(result.snapshot.dataQuality).toBe("degraded");
  });

  it("marks missing cross-feed confirmation degraded instead of trusting one venue", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [provider("binance")],
    }));
    expect(result.crossFeedStatus).toBe("unavailable");
    expect(result.snapshot.frames["1h"].status).toBe("degraded");
    expect(result.marketDataTrusted).toBe(false);
  });

  it("marks insufficient cross-feed overlap degraded", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance"),
        provider("kraken", { candleCountByInterval: { "1h": 2 } }),
      ],
    }));
    expect(result.crossFeedStatus).toBe("insufficient_overlap");
    expect(result.snapshot.frames["1h"].status).toBe("degraded");
    expect(result.marketDataTrusted).toBe(false);
  });

  it("keeps usable timeframes when one timeframe cannot be fetched", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance", { failIntervals: ["1d"] }),
      ],
    }));
    expect(result.snapshot.frames["1d"].status).toBe("missing");
    expect(result.snapshot.frames["4h"].status).toBe("available");
    expect(result.snapshot.dataQuality).toBe("degraded");
    expect(result.frameFailures["1d"]).toMatch(/unavailable/i);
  });

  it("does not fail the entire snapshot when all providers fail one timeframe", async () => {
    const result = await loadMarketIntelligence(serviceInput({
      providers: [
        provider("binance", { failIntervals: ["1d"] }),
        provider("kraken", { failIntervals: ["1d"] }),
      ],
    }));
    expect(result.snapshot.frames["1d"].status).toBe("missing");
    expect(result.snapshot.coverage.availableTimeframes).toBe(3);
    expect(result.snapshot.dataQuality).toBe("degraded");
  });

  it("rejects an empty provider list and invalid evaluation timestamps", async () => {
    await expect(loadMarketIntelligence(serviceInput({ providers: [] })))
      .rejects.toThrow(/provider/i);
    await expect(loadMarketIntelligence(serviceInput({ evaluationTime: -1 })))
      .rejects.toThrow(/evaluation/i);
  });
});
