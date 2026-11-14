import { describe, expect, it } from "vitest";
import {
  buildMarketIntelligenceSnapshot,
  type MarketFrameInput,
  type MarketIntelligenceInput,
  type MarketTimeframe,
} from "./market-intelligence";
import type { Candle } from "./candles";

const NOW = 1_800_000_000_000;
const INTERVALS: Record<MarketTimeframe, number> = {
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

type FrameOverrides = Partial<MarketFrameInput> & { volatilityRange?: number };

function makeFrame(
  timeframe: MarketTimeframe,
  direction: "up" | "down" | "flat" = "up",
  overrides: FrameOverrides = {},
): MarketFrameInput {
  const intervalMs = INTERVALS[timeframe];
  const latestBoundary = Math.floor(NOW / intervalMs) * intervalMs;
  const start = latestBoundary - 60 * intervalMs;
  const candles: Candle[] = Array.from({ length: 60 }, (_, index) => {
    const close = direction === "up"
      ? 1_000 + index * 2
      : direction === "down"
        ? 1_000 - index * 2
        : 1_000;
    const range = overrides.volatilityRange ?? 1;
    return {
      timestamp: start + index * intervalMs,
      open: close,
      high: close + range,
      low: close - range,
      close,
      volume: 100 + index,
    };
  });
  const { volatilityRange: _ignored, ...frameOverrides } = overrides;
  return {
    symbol: "BTCUSDT",
    timeframe,
    intervalMs,
    provider: "test-feed",
    fetchedAt: NOW - 1_000,
    maxAgeMs: intervalMs * 2,
    qualityStatus: "pass",
    candles,
    ...frameOverrides,
  };
}

function input(
  frames: Partial<Record<MarketTimeframe, MarketFrameInput>> = {
    "1d": makeFrame("1d"),
    "4h": makeFrame("4h"),
    "1h": makeFrame("1h"),
    "15m": makeFrame("15m"),
  },
  overrides: Partial<MarketIntelligenceInput> = {},
): MarketIntelligenceInput {
  return {
    symbol: "BTCUSDT",
    instrumentCategory: "spot",
    volumeUnit: "base",
    evaluationTime: NOW,
    config: CONFIG,
    frames,
    ...overrides,
  };
}

const testHasher = async (value: unknown): Promise<string> => {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
};

describe("buildMarketIntelligenceSnapshot", () => {
  it("combines the 1D and 4H hierarchy while preserving lower-timeframe divergence", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up"),
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "down"),
      "15m": makeFrame("15m", "down"),
    }), testHasher);
    expect(snapshot).toMatchObject({
      symbol: "BTCUSDT",
      macroTrend: "uptrend",
      primaryTrend: "uptrend",
      tacticalTrend: "downtrend",
      microTrend: "downtrend",
      alignment: "aligned",
      lowerTimeframeDivergence: true,
      phase: "transition",
      dataQuality: "pass",
      liquidity: { status: "partial" },
      positioning: { status: "unknown" },
    });
    expect(snapshot.frames["1d"].trendPersistencePct).toBe(100);
    expect(snapshot.frames["1d"].volatilityRankPct).toBeGreaterThan(0);
    expect(snapshot.missingDimensions).toContain("order_book_depth");
    expect(snapshot.missingDimensions).toContain("derivatives_positioning");
  });

  it("marks opposing 1D and 4H trends as a transition instead of averaging them", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up"),
      "4h": makeFrame("4h", "down"),
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.alignment).toBe("conflict");
    expect(snapshot.phase).toBe("transition");
    expect(snapshot.macroTrend).toBe("uptrend");
    expect(snapshot.primaryTrend).toBe("downtrend");
    expect(snapshot.contradictions.length).toBeGreaterThan(0);
  });

  it("does not allow 1H or 15M trends to override aligned higher-timeframe context", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up"),
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "down"),
      "15m": makeFrame("15m", "down"),
    }), testHasher);
    expect(snapshot.macroTrend).toBe("uptrend");
    expect(snapshot.primaryTrend).toBe("uptrend");
    expect(snapshot.phase).toBe("transition");
    expect(snapshot.lowerTimeframeDivergence).toBe(true);
  });

  it("fails closed to unknown phase when the daily macro frame is missing", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.frames["1d"].status).toBe("missing");
    expect(snapshot.macroTrend).toBe("unknown");
    expect(snapshot.phase).toBe("unknown");
    expect(snapshot.dataQuality).toBe("degraded");
  });

  it("ignores future candles, including malformed future OHLC, without changing the prefix snapshot", async () => {
    const base = input();
    const first = await buildMarketIntelligenceSnapshot(base, testHasher);
    const frames = { ...base.frames };
    const daily = frames["1d"]!;
    const futureTimestamp = daily.candles[daily.candles.length - 1].timestamp + daily.intervalMs;
    frames["1d"] = {
      ...daily,
      candles: [...daily.candles, {
        timestamp: futureTimestamp,
        open: -1, high: -1, low: -1, close: -1, volume: -1,
      }],
    };
    const second = await buildMarketIntelligenceSnapshot({ ...base, frames }, testHasher);
    expect(second).toEqual(first);
    expect(second.frames["1d"].latestCandleAt).toBe(first.frames["1d"].latestCandleAt);
  });

  it("excludes the currently forming candle until its close time has passed", async () => {
    const frame = makeFrame("1h", "up");
    const boundary = Math.floor(NOW / frame.intervalMs) * frame.intervalMs;
    const current = {
      timestamp: boundary,
      open: 10_000,
      high: 10_001,
      low: 9_999,
      close: 10_000,
      volume: 10_000,
    };
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1h": { ...frame, candles: [...frame.candles, current] },
    }), testHasher);
    expect(snapshot.frames["1h"].latestCandleAt).toBe(frame.candles.at(-1)?.timestamp);
    expect(snapshot.frames["1h"].availableAt).toBe(boundary);
  });

  it("marks stale or failed frames unknown and reports aggregate degraded quality", async () => {
    const stale = makeFrame("1d", "up", { fetchedAt: NOW - 100_000, maxAgeMs: 10_000 });
    const failed = makeFrame("4h", "up", { qualityStatus: "fail" });
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": stale,
      "4h": failed,
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.frames["1d"].status).toBe("stale");
    expect(snapshot.frames["4h"].status).toBe("failed");
    expect(snapshot.macroTrend).toBe("unknown");
    expect(snapshot.phase).toBe("unknown");
    expect(snapshot.dataQuality).toBe("degraded");
  });

  it("returns fail quality when no timeframe has usable data", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({}), testHasher);
    expect(snapshot.dataQuality).toBe("fail");
    expect(snapshot.phase).toBe("unknown");
    expect(snapshot.alignment).toBe("unknown");
  });

  it("labels high realised volatility as stress without inferring direction", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "flat", { volatilityRange: 30 }),
      "4h": makeFrame("4h", "flat", { volatilityRange: 30 } as Partial<MarketFrameInput>),
      "1h": makeFrame("1h", "flat", { volatilityRange: 1 }),
      "15m": makeFrame("15m", "flat", { volatilityRange: 1 }),
    }), testHasher);
    expect(snapshot.phase).toBe("stress");
    expect(snapshot.macroTrend).toBe("range");
    expect(snapshot.primaryTrend).toBe("range");
  });

  it("rejects mixed symbols and invalid timeframe intervals", async () => {
    await expect(buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up", { symbol: "ETHUSDT" }),
    }), testHasher)).rejects.toThrow(/symbol/i);
    await expect(buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up", { intervalMs: 1 }),
    }), testHasher)).rejects.toThrow(/interval/i);
  });

  it("rejects invalid hash output rather than creating an untraceable snapshot", async () => {
    await expect(buildMarketIntelligenceSnapshot(input(), async () => "not a hash"))
      .rejects.toThrow(/hash/i);
  });
  it("distinguishes trend, range and compression without treating them as forecasts", async () => {
    const trend = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up", { volatilityRange: 5 }),
      "4h": makeFrame("4h", "up", { volatilityRange: 5 }),
      "1h": makeFrame("1h", "up", { volatilityRange: 5 }),
      "15m": makeFrame("15m", "up", { volatilityRange: 5 }),
    }), testHasher);
    const range = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "flat", { volatilityRange: 1 }),
      "4h": makeFrame("4h", "flat", { volatilityRange: 1 }),
      "1h": makeFrame("1h", "flat", { volatilityRange: 1 }),
      "15m": makeFrame("15m", "flat", { volatilityRange: 1 }),
    }), testHasher);
    const compression = await buildMarketIntelligenceSnapshot(input({
      "1d": makeFrame("1d", "up", { volatilityRange: 0.1 }),
      "4h": makeFrame("4h", "up", { volatilityRange: 0.1 }),
      "1h": makeFrame("1h", "up", { volatilityRange: 0.1 }),
      "15m": makeFrame("15m", "up", { volatilityRange: 0.1 }),
    }), testHasher);
    expect(trend.phase).toBe("trend");
    expect(range.phase).toBe("range");
    expect(compression.phase).toBe("compression");
    expect(trend.uncertainty).toBe("moderate");
  });

  it("marks an insufficient history frame unknown rather than extrapolating", async () => {
    const short = makeFrame("1d", "up");
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": { ...short, candles: short.candles.slice(-5) },
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.frames["1d"].status).toBe("insufficient_history");
    expect(snapshot.macroTrend).toBe("unknown");
    expect(snapshot.phase).toBe("unknown");
  });

  it("does not use a frame whose fetch timestamp is in the future", async () => {
    const future = makeFrame("1d", "up", { fetchedAt: NOW + 1 });
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": future,
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.frames["1d"].status).toBe("future");
    expect(snapshot.macroTrend).toBe("unknown");
    expect(snapshot.dataQuality).toBe("degraded");
  });

  it("marks malformed eligible candles failed but ignores malformed future bars", async () => {
    const frame = makeFrame("1d", "up");
    const malformedEligible = {
      ...frame,
      candles: frame.candles.map((candle, index) =>
        index === frame.candles.length - 1 ? { ...candle, low: candle.high + 1 } : candle
      ),
    };
    const snapshot = await buildMarketIntelligenceSnapshot(input({
      "1d": malformedEligible,
      "4h": makeFrame("4h", "up"),
      "1h": makeFrame("1h", "up"),
      "15m": makeFrame("15m", "up"),
    }), testHasher);
    expect(snapshot.frames["1d"].status).toBe("failed");
    expect(snapshot.macroTrend).toBe("unknown");
  });

  it("bounds per-timeframe history to protect phone memory and hashing cost", async () => {
    const frame = makeFrame("1d", "up");
    const oversized = {
      ...frame,
      candles: Array.from({ length: 5_001 }, (_, index) => ({
        ...frame.candles[index % frame.candles.length],
        timestamp: frame.candles[0].timestamp + index * frame.intervalMs,
      })),
    };
    await expect(buildMarketIntelligenceSnapshot(input({
      "1d": oversized,
    }), testHasher)).rejects.toThrow(/5000 candles/i);
  });

  it("preserves instrument and candle-volume units in the canonical snapshot", async () => {
    const snapshot = await buildMarketIntelligenceSnapshot(
      input(undefined, { volumeUnit: "quote" }),
      testHasher,
    );
    const base = await buildMarketIntelligenceSnapshot(input(), testHasher);
    expect(snapshot.instrumentCategory).toBe("spot");
    expect(snapshot.volumeUnit).toBe("quote");
    expect(snapshot.contentHash).not.toBe(base.contentHash);
  });

  it("rejects unsupported instrument and volume-unit metadata", async () => {
    await expect(buildMarketIntelligenceSnapshot(
      input(undefined, { instrumentCategory: "unknown" } as unknown as Partial<MarketIntelligenceInput>),
      testHasher,
    )).rejects.toThrow(/instrument/i);
    await expect(buildMarketIntelligenceSnapshot(
      input(undefined, { volumeUnit: "contracts" } as unknown as Partial<MarketIntelligenceInput>),
      testHasher,
    )).rejects.toThrow(/volume unit/i);
  });

  it("produces the same content hash when equivalent inputs use different object-key order", async () => {
    const base = input();
    const first = await buildMarketIntelligenceSnapshot(base, testHasher);
    const reorderedFrames = { ...base.frames };
    const daily = reorderedFrames["1d"]!;
    reorderedFrames["1d"] = {
      ...daily,
      candles: daily.candles.map((candle) => ({
        volume: candle.volume,
        close: candle.close,
        low: candle.low,
        high: candle.high,
        open: candle.open,
        timestamp: candle.timestamp,
      })),
    };
    const reordered = await buildMarketIntelligenceSnapshot({
      ...base,
      config: {
        highVolatilityAtrPct: base.config.highVolatilityAtrPct,
        lowVolatilityAtrPct: base.config.lowVolatilityAtrPct,
        trendThresholdPct: base.config.trendThresholdPct,
        atrPeriod: base.config.atrPeriod,
        slowEmaPeriod: base.config.slowEmaPeriod,
        fastEmaPeriod: base.config.fastEmaPeriod,
      },
      frames: reorderedFrames,
    }, testHasher);
    expect(reordered.contentHash).toBe(first.contentHash);
  });

});