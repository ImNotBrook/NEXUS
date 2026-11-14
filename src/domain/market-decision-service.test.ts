import { describe, expect, it } from "vitest";
import { evaluateMarketCandidateAndJournal, type MarketDecisionJournal } from "./market-decision-service";
import type { DecisionJournalRecord } from "./decision-journal";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";

const now = 1_800_000_000_000;
const makeFrame = (timeframe: "1d" | "4h" | "1h" | "15m", trend: "uptrend" | "downtrend") => ({
  timeframe, status: "available" as const, provider: "Binance", fetchedAt: now,
  candleCount: 60, latestCandleAt: now - 3_600_000, availableAt: now - 1_000,
  trend, volatility: "normal" as const, emaSpreadPct: 0.4, trendStrengthPct: 0.4,
  trendPersistencePct: 80, atrPct: 0.8, volatilityRankPct: 50, relativeVolume20: 1.2, reason: null,
});
const market = (): MarketIntelligenceSnapshot => ({
  schemaVersion: 1, engineVersion: "market-intelligence-v1", snapshotId: "snapshot-service-1",
  contentHash: "b".repeat(64), symbol: "BTCUSDT", instrumentCategory: "spot", volumeUnit: "base",
  evaluationTime: now, config: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
  latestSourceAvailableAt: now - 1_000, dataQuality: "pass",
  coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
  frames: { "1d": makeFrame("1d", "uptrend"), "4h": makeFrame("4h", "uptrend"), "1h": makeFrame("1h", "uptrend"), "15m": makeFrame("15m", "uptrend") },
  macroTrend: "uptrend", primaryTrend: "uptrend", tacticalTrend: "uptrend", microTrend: "uptrend",
  alignment: "aligned", lowerTimeframeDivergence: false, volatilityContext: "normal", phase: "trend",
  phaseRationale: "Higher timeframes aligned", uncertainty: "low",
  liquidity: { status: "partial", relativeVolume20: 1.2, depthStatus: "unknown", breadthStatus: "unknown", note: "Volume proxy only" },
  positioning: { status: "unknown", note: "Unavailable" }, missingDimensions: [], supportingObservations: [], contradictions: [],
});
const candidate = {
  id: "candidate-btc-long", symbol: "BTCUSDT", side: "long" as const, setupFamily: "structure-retest",
  timeframe: "1h", triggerConfirmed: true, expiresAt: now + 60_000,
  plan: { entryPrice: 100, stopPrice: 98, targetPrices: [104], quantity: 0.5 },
};
const thesis = { bullCase: ["Closed trends align with the long candidate"], bearCase: ["Positioning remains unknown"], alternatives: ["Wait for a retest"], invalidation: ["Close below the planned stop"] };
const versions = { engine: "decision-1", score: "diagnostic-1", strategy: "baseline-1", riskPolicy: "paper-1" };
function memoryJournal(records: DecisionJournalRecord[] = []): MarketDecisionJournal {
  return { append: async (record) => { records.push(structuredClone(record)); return structuredClone(record); } };
}

describe("evaluateMarketCandidateAndJournal integration", () => {
  it("connects market snapshot evidence to the decision kernel and durable journal writer", async () => {
    const records: DecisionJournalRecord[] = [];
    const result = await evaluateMarketCandidateAndJournal({
      snapshot: market(), candidate, crossFeedStatus: "within_tolerance",
      riskGate: { eligible: true, reasonCodes: [] }, economicsGate: { eligible: true, reasonCodes: [] },
      minimumSupportingFamilies: 2, thesis, versions, clockSource: "test-clock",
      journal: memoryJournal(records), decisionId: "decision-integrated-1",
    });
    expect(result.result.status).toBe("ENTER");
    expect(result.record.status).toBe("ENTER");
    expect(result.record.marketSnapshotRefs[0].snapshotId).toBe("snapshot-service-1");
    expect(result.record.evidence.length).toBeGreaterThanOrEqual(4);
    expect(records).toHaveLength(1);
    expect(records[0].result).toEqual(result.result);
  });

  it("journals WAIT when market cross-feed validation fails, without discarding evidence", async () => {
    const result = await evaluateMarketCandidateAndJournal({
      snapshot: market(), candidate, crossFeedStatus: "discrepancy",
      riskGate: { eligible: true, reasonCodes: [] }, economicsGate: { eligible: true, reasonCodes: [] },
      minimumSupportingFamilies: 2, thesis, versions, clockSource: "test-clock",
      journal: memoryJournal(), decisionId: "decision-market-blocked",
    });
    expect(result.result.status).toBe("WAIT");
    expect(result.result.reasonCodes).toContain("MARKET_DATA_NOT_READY");
    expect(result.record.evidence.length).toBeGreaterThan(0);
  });

  it("does not report a completed assessment if journal persistence fails", async () => {
    await expect(evaluateMarketCandidateAndJournal({
      snapshot: market(), candidate, crossFeedStatus: "within_tolerance",
      riskGate: { eligible: true, reasonCodes: [] }, economicsGate: { eligible: true, reasonCodes: [] },
      minimumSupportingFamilies: 2, thesis, versions, clockSource: "test-clock",
      journal: { append: async () => { throw new Error("storage offline"); } },
      decisionId: "decision-storage-failure",
    })).rejects.toThrow("storage offline");
  });
});
