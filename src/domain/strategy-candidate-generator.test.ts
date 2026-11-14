import { describe, expect, it } from "vitest";
import { generateDonchianStrategyCandidate } from "./strategy-candidate-generator";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { Candle } from "./candles";

const now = 1_800_000_000_000;
function frame(timeframe: "1d" | "4h" | "1h" | "15m", trend: "uptrend" | "downtrend") {
  return {
    timeframe, status: "available" as const, provider: "Binance", fetchedAt: now,
    candleCount: 60, latestCandleAt: now - 3_600_000, availableAt: now - 1_000,
    trend, volatility: "normal" as const, emaSpreadPct: 0.4, trendStrengthPct: 0.4,
    trendPersistencePct: 80, atrPct: 1, volatilityRankPct: 50, relativeVolume20: 1.2, reason: null,
  };
}
const snapshot = (trend: "uptrend" | "downtrend" = "uptrend"): MarketIntelligenceSnapshot => ({
  schemaVersion: 1, engineVersion: "market-intelligence-v1", snapshotId: "snapshot-1",
  contentHash: "a".repeat(64), symbol: "BTCUSDT", instrumentCategory: "spot", volumeUnit: "base",
  evaluationTime: now, config: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
  latestSourceAvailableAt: now - 1_000, dataQuality: "pass",
  coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
  frames: { "1d": frame("1d", trend), "4h": frame("4h", trend), "1h": frame("1h", trend), "15m": frame("15m", trend) },
  macroTrend: trend, primaryTrend: trend, tacticalTrend: trend, microTrend: trend,
  alignment: "aligned", lowerTimeframeDivergence: false, volatilityContext: "normal", phase: "trend",
  phaseRationale: "Aligned trends", uncertainty: "low",
  liquidity: { status: "partial", relativeVolume20: 1.2, depthStatus: "unknown", breadthStatus: "unknown", note: "Volume proxy only" },
  positioning: { status: "unknown", note: "Unavailable" }, missingDimensions: [], supportingObservations: [], contradictions: [],
});
const strategy = {
  id: "donchian-breakout", version: "1.0.0", approvedBy: "human-review",
  approvedAt: now - 10_000, lookback: 3, atrStopMultiple: 2, rewardRiskMultiple: 2,
  riskBudget: 20, maxNotional: 2_000, expiryBars: 2,
};
function candles(closes: number[], highs: number[], lows: number[]): Candle[] {
  return closes.map((close, index) => ({
    timestamp: now - (closes.length - index) * 3_600_000,
    open: close - 1, high: highs[index], low: lows[index], close, volume: 100,
  }));
}
const breakout = candles(
  [100, 101, 102, 106],
  [101, 102, 103, 107],
  [99, 100, 101, 105],
);

describe("generateDonchianStrategyCandidate", () => {
  it("creates a long candidate only after a completed close breaks the prior channel", () => {
    const result = generateDonchianStrategyCandidate({
      snapshot: snapshot("uptrend"), candles: breakout, crossFeedStatus: "within_tolerance",
      strategy, evaluationTime: now,
    });
    expect(result.status).toBe("candidate");
    expect(result.candidate?.side).toBe("long");
    expect(result.candidate?.plan.entryPrice).toBe(106);
    expect(result.candidate?.plan.stopPrice).toBeCloseTo(103.88);
    expect(result.candidate?.plan.targetPrices[0]).toBeCloseTo(110.24);
    expect(result.candidate?.plan.quantity).toBeCloseTo(20 / 2.12);
    expect(result.candidate?.id).toContain("donchian-breakout");
  });

  it("returns NO_SETUP when the latest close does not break the previous channel", () => {
    const noBreak = candles([100, 101, 102, 102.5], [101, 102, 103, 103], [99, 100, 101, 101]);
    const result = generateDonchianStrategyCandidate({
      snapshot: snapshot(), candles: noBreak, crossFeedStatus: "within_tolerance",
      strategy, evaluationTime: now,
    });
    expect(result.status).toBe("no_setup");
    expect(result.candidate).toBeNull();
    expect(result.reasonCodes).toContain("DONCHIAN_TRIGGER_ABSENT");
  });

  it("does not create a candidate when the strategy lacks explicit human approval", () => {
    const result = generateDonchianStrategyCandidate({
      snapshot: snapshot(), candles: breakout, crossFeedStatus: "within_tolerance",
      strategy: { ...strategy, approvedBy: "" }, evaluationTime: now,
    });
    expect(result.status).toBe("blocked");
    expect(result.reasonCodes).toContain("STRATEGY_NOT_APPROVED");
  });

  it("blocks a breakout against the higher-timeframe regime", () => {
    const result = generateDonchianStrategyCandidate({
      snapshot: snapshot("downtrend"), candles: breakout, crossFeedStatus: "within_tolerance",
      strategy, evaluationTime: now,
    });
    expect(result.status).toBe("no_setup");
    expect(result.reasonCodes).toContain("HIGHER_TIMEFRAME_CONFLICT");
  });

  it("fails closed on degraded market data or cross-feed discrepancy", () => {
    const result = generateDonchianStrategyCandidate({
      snapshot: { ...snapshot(), dataQuality: "degraded" }, candles: breakout,
      crossFeedStatus: "discrepancy", strategy, evaluationTime: now,
    });
    expect(result.status).toBe("blocked");
    expect(result.candidate).toBeNull();
    expect(result.reasonCodes).toContain("MARKET_DATA_NOT_READY");
  });

  it("rejects future or incomplete candle data instead of using it", () => {
    const future = [...breakout, { ...breakout[3], timestamp: now }];
    expect(() => generateDonchianStrategyCandidate({
      snapshot: snapshot(), candles: future, crossFeedStatus: "within_tolerance",
      strategy, evaluationTime: now,
    })).toThrow();
  });

  it("caps size by max notional even when the risk budget permits more", () => {
    const smallNotional = { ...strategy, maxNotional: 50 };
    const result = generateDonchianStrategyCandidate({
      snapshot: snapshot(), candles: breakout, crossFeedStatus: "within_tolerance",
      strategy: smallNotional, evaluationTime: now,
    });
    expect(result.status).toBe("candidate");
    expect(result.candidate?.plan.quantity).toBeCloseTo(50 / 106);
  });
});
