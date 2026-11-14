import { describe, expect, it } from "vitest";
import {
  buildMarketIntelligencePresentation,
  type MarketIntelligencePresentationInput,
} from "./market-intelligence-presentation";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";

const snapshot: MarketIntelligenceSnapshot = {
  schemaVersion: 1,
  engineVersion: "market-intelligence-v1",
  snapshotId: "snapshot-1",
  contentHash: "a".repeat(64),
  symbol: "BTCUSDT",
  instrumentCategory: "spot",
  volumeUnit: "base",
  evaluationTime: 1_800_000_000_000,
  config: {
    fastEmaPeriod: 5,
    slowEmaPeriod: 13,
    atrPeriod: 14,
    trendThresholdPct: 0.1,
    lowVolatilityAtrPct: 0.3,
    highVolatilityAtrPct: 1.5,
  },
  latestSourceAvailableAt: 1_799_999_000_000,
  dataQuality: "pass",
  coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
  frames: {
    "1d": { timeframe: "1d", status: "available", provider: "binance", fetchedAt: 1, candleCount: 60, latestCandleAt: 2, availableAt: 3, trend: "uptrend", volatility: "normal", emaSpreadPct: 1, trendStrengthPct: 1, trendPersistencePct: 90, atrPct: 0.5, volatilityRankPct: 50, relativeVolume20: 1, reason: null },
    "4h": { timeframe: "4h", status: "available", provider: "binance", fetchedAt: 1, candleCount: 60, latestCandleAt: 2, availableAt: 3, trend: "uptrend", volatility: "normal", emaSpreadPct: 1, trendStrengthPct: 1, trendPersistencePct: 90, atrPct: 0.5, volatilityRankPct: 50, relativeVolume20: 1, reason: null },
    "1h": { timeframe: "1h", status: "available", provider: "binance", fetchedAt: 1, candleCount: 60, latestCandleAt: 2, availableAt: 3, trend: "downtrend", volatility: "high", emaSpreadPct: -1, trendStrengthPct: 1, trendPersistencePct: 90, atrPct: 2, volatilityRankPct: 90, relativeVolume20: 1, reason: null },
    "15m": { timeframe: "15m", status: "available", provider: "binance", fetchedAt: 1, candleCount: 60, latestCandleAt: 2, availableAt: 3, trend: "downtrend", volatility: "high", emaSpreadPct: -1, trendStrengthPct: 1, trendPersistencePct: 90, atrPct: 2, volatilityRankPct: 90, relativeVolume20: 1, reason: null },
  },
  macroTrend: "uptrend",
  primaryTrend: "uptrend",
  tacticalTrend: "downtrend",
  microTrend: "downtrend",
  alignment: "aligned",
  lowerTimeframeDivergence: true,
  volatilityContext: "normal",
  phase: "transition",
  phaseRationale: "Lower timeframe divergence",
  uncertainty: "moderate",
  liquidity: { status: "partial", relativeVolume20: 1, depthStatus: "unknown", breadthStatus: "unknown", note: "Depth and breadth unavailable" },
  positioning: { status: "unknown", note: "Derivatives positioning unavailable" },
  missingDimensions: ["order_book_depth", "derivatives_positioning"],
  supportingObservations: ["1D and 4H trend up"],
  contradictions: ["1H and 15M trend down"],
};

const input: MarketIntelligencePresentationInput = {
  snapshot,
  crossFeedStatus: "within_tolerance",
  marketDataTrusted: true,
};

describe("buildMarketIntelligencePresentation", () => {
  it("preserves the higher-timeframe hierarchy and reports lower-timeframe divergence", () => {
    const view = buildMarketIntelligencePresentation(input);
    expect(view.phase).toBe("TRANSITION");
    expect(view.macroTrend).toBe("UPTREND");
    expect(view.primaryTrend).toBe("UPTREND");
    expect(view.tacticalTrend).toBe("DOWNTREND");
    expect(view.microTrend).toBe("DOWNTREND");
    expect(view.alignment).toBe("ALIGNED");
    expect(view.lowerTimeframeDivergence).toBe("Lower-timeframe divergence");
  });

  it("never presents unknown liquidity depth or positioning as measured", () => {
    const view = buildMarketIntelligencePresentation(input);
    expect(view.liquidity).toMatch(/depth unknown/i);
    expect(view.positioning).toMatch(/unknown/i);
    expect(view.missingDimensions).toContain("order_book_depth");
  });

  it("locks paper eligibility when cross-feed confirmation or data quality fails", () => {
    const unavailable = buildMarketIntelligencePresentation({
      ...input,
      crossFeedStatus: "unavailable",
      marketDataTrusted: false,
    });
    expect(unavailable.paperEligibility).toBe("LOCKED · DATA NOT TRUSTED");
    const degraded = buildMarketIntelligencePresentation({
      ...input,
      snapshot: { ...snapshot, dataQuality: "degraded" },
    });
    expect(degraded.quality).toBe("DEGRADED");
    expect(degraded.paperEligibility).toBe("LOCKED · DATA NOT TRUSTED");
  });

  it("shows timeframe coverage and cross-feed status explicitly", () => {
    const view = buildMarketIntelligencePresentation(input);
    expect(view.coverage).toBe("4 / 4 timeframes");
    expect(view.crossFeed).toMatch(/within tolerance/i);
    expect(view.paperEligibility).toBe("PAPER DATA GATE PASSED");
  });
});
