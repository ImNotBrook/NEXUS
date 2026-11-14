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

function makeFrame(
  timeframe: MarketTimeframe,
  direction: "up" | "down" | "flat" = "up",
  overrides: Partial<MarketFrameInput> = {},
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
  const { volatilityRange: _ignored, ...frameOverrides } = overrides as Partial<MarketFrameInput> & { volatilityRange?: number };
  return {
    symbol: "BTCUSDT",
    timeframe,
    intervalMs,
    provider: "test-feed",
    fetchedAt: NOW - 1_000,
    maxAgeMs: 10_000,
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
    const stale = makeFrame("1d", "up", { fetchedAt: NOW - 100_000 });
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
      "1d": makeFrame("1d", "flat", { volatilityRange: 30 } as Partial<MarketFrameInput>),
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
});
