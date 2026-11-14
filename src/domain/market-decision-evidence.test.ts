import { describe, expect, it } from "vitest";
import { buildDecisionEvidenceFromMarketSnapshot } from "./market-decision-evidence";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";

const now = 1_800_000_000_000;
const frame = (timeframe: "1d" | "4h" | "1h" | "15m", trend: "uptrend" | "downtrend" | "unknown", availableAt: number) => ({
  timeframe, status: "available" as const, provider: "Binance", fetchedAt: now,
  candleCount: 60, latestCandleAt: availableAt - 3_600_000, availableAt,
  trend, volatility: "normal" as const, emaSpreadPct: trend === "uptrend" ? 0.4 : trend === "downtrend" ? -0.4 : null,
  trendStrengthPct: 0.4, trendPersistencePct: 80, atrPct: 0.8, volatilityRankPct: 50,
  relativeVolume20: 1.2, reason: null,
});

function snapshot(overrides: Partial<MarketIntelligenceSnapshot> = {}): MarketIntelligenceSnapshot {
  return {
    schemaVersion: 1, engineVersion: "market-intelligence-1", snapshotId: "snapshot-btc-1",
    contentHash: "a".repeat(64), symbol: "BTCUSDT", instrumentCategory: "spot",
    volumeUnit: "base", evaluationTime: now, config: {
      fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1,
      lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5,
    }, latestSourceAvailableAt: now - 1, dataQuality: "pass",
    coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
    frames: {
      "1d": frame("1d", "uptrend", now - 10_000),
      "4h": frame("4h", "uptrend", now - 5_000),
      "1h": frame("1h", "downtrend", now - 2_000),
      "15m": frame("15m", "downtrend", now - 1_000),
    },
    macroTrend: "uptrend", primaryTrend: "uptrend", tacticalTrend: "downtrend",
    microTrend: "downtrend", alignment: "aligned", lowerTimeframeDivergence: true,
    volatilityContext: "normal", phase: "transition", phaseRationale: "Mixed timeframe state",
    uncertainty: "moderate", liquidity: { status: "partial", relativeVolume20: 1.2, depthStatus: "unknown", breadthStatus: "unknown", note: "Volume proxy only" },
    positioning: { status: "unknown", note: "No positioning data" }, missingDimensions: [],
    supportingObservations: [], contradictions: [], ...overrides,
  } as MarketIntelligenceSnapshot;
}

const candidate = { symbol: "BTCUSDT", side: "long" as const };

describe("buildDecisionEvidenceFromMarketSnapshot", () => {
  it("maps available timeframe trends into candidate-relative, timestamped evidence", () => {
    const result = buildDecisionEvidenceFromMarketSnapshot(snapshot(), candidate, "within_tolerance");
    expect(result.marketDataStatus).toBe("pass");
    expect(result.snapshotRef).toEqual({ snapshotId: "snapshot-btc-1", contentHash: "a".repeat(64) });
    expect(result.evidence.find((item) => item.id.endsWith(":1d:trend"))).toMatchObject({
      family: "macro_regime", polarity: "supports", symbol: "BTCUSDT", availableAt: now - 10_000,
    });
    expect(result.evidence.find((item) => item.id.endsWith(":1h:trend"))).toMatchObject({
      family: "momentum_volume", polarity: "contradicts",
    });
  });

  it("does not manufacture evidence for missing or unknown frames", () => {
    const input = snapshot();
    input.frames["15m"] = { ...input.frames["15m"], status: "missing", trend: "unknown", availableAt: null };
    const result = buildDecisionEvidenceFromMarketSnapshot(input, candidate, "within_tolerance");
    expect(result.evidence.some((item) => item.id.endsWith(":15m:trend"))).toBe(false);
  });

  it("fails closed on a cross-feed discrepancy or unavailable tactical frame", () => {
    expect(buildDecisionEvidenceFromMarketSnapshot(snapshot(), candidate, "discrepancy").marketDataStatus).toBe("fail");
    const input = snapshot();
    input.frames["1h"] = { ...input.frames["1h"], status: "missing", trend: "unknown", availableAt: null };
    expect(buildDecisionEvidenceFromMarketSnapshot(input, candidate, "within_tolerance").marketDataStatus).toBe("fail");
  });

  it("marks incomplete but non-discrepant context as degraded, not trusted", () => {
    const result = buildDecisionEvidenceFromMarketSnapshot(snapshot({ dataQuality: "degraded" }), candidate, "unavailable");
    expect(result.marketDataStatus).toBe("degraded");
  });


  it("scores higher-timeframe alignment relative to candidate direction, not as universally bullish", () => {
    const result = buildDecisionEvidenceFromMarketSnapshot(
      snapshot(),
      { symbol: "BTCUSDT", side: "short" },
      "within_tolerance",
    );
    expect(result.evidence.find((item) => item.id.endsWith(":alignment"))?.polarity).toBe("contradicts");
  });

  it("rejects symbol mismatches and future-dated evidence", () => {
    expect(() => buildDecisionEvidenceFromMarketSnapshot(snapshot(), { ...candidate, symbol: "ETHUSDT" }, "within_tolerance"))
      .toThrow(/symbol/i);
    const input = snapshot();
    input.frames["1h"] = { ...input.frames["1h"], availableAt: now + 1 };
    expect(() => buildDecisionEvidenceFromMarketSnapshot(input, candidate, "within_tolerance"))
      .toThrow(/future/i);
  });
});
