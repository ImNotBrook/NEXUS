import { describe, expect, it } from "vitest";
import { runDecisionWorkbench, type DecisionWorkbenchJournal } from "./decision-workbench-service";
import type { DecisionJournalRecord, DecisionJournalEvent } from "./decision-journal";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { Candle } from "./candles";

const now = 1_800_000_000_000;
function frame(timeframe: "1d" | "4h" | "1h" | "15m") {
  return {
    timeframe, status: "available" as const, provider: "Binance", fetchedAt: now,
    candleCount: 60, latestCandleAt: now - 3_600_000, availableAt: now - 1_000,
    trend: "uptrend" as const, volatility: "normal" as const, emaSpreadPct: 0.4,
    trendStrengthPct: 0.4, trendPersistencePct: 80, atrPct: 1,
    volatilityRankPct: 50, relativeVolume20: 1.2, reason: null,
  };
}
const market = (): MarketIntelligenceSnapshot => ({
  schemaVersion: 1, engineVersion: "market-intelligence-v1", snapshotId: "workbench-snapshot",
  contentHash: "c".repeat(64), symbol: "BTCUSDT", instrumentCategory: "spot", volumeUnit: "base",
  evaluationTime: now, config: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
  latestSourceAvailableAt: now - 1_000, dataQuality: "pass",
  coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
  frames: { "1d": frame("1d"), "4h": frame("4h"), "1h": frame("1h"), "15m": frame("15m") },
  macroTrend: "uptrend", primaryTrend: "uptrend", tacticalTrend: "uptrend", microTrend: "uptrend",
  alignment: "aligned", lowerTimeframeDivergence: false, volatilityContext: "normal", phase: "trend",
  phaseRationale: "Aligned trends", uncertainty: "low",
  liquidity: { status: "partial", relativeVolume20: 1.2, depthStatus: "unknown", breadthStatus: "unknown", note: "Volume proxy only" },
  positioning: { status: "unknown", note: "Unavailable" }, missingDimensions: [], supportingObservations: [], contradictions: [],
});
const strategy = {
  id: "donchian-breakout", version: "1.0.0", approvedBy: "human-review", approvalRationale: "Approved for paper-only research evaluation",
  approvedAt: now - 10_000, lookback: 3, atrStopMultiple: 2, rewardRiskMultiple: 2,
  riskBudget: 20, maxNotional: 2_000, expiryBars: 2,
};
const breakout: Candle[] = [100, 101, 102, 106].map((close, index) => ({
  timestamp: now - (4 - index) * 3_600_000, open: close - 1,
  high: [101, 102, 103, 107][index], low: [99, 100, 101, 105][index],
  close, volume: 1_000,
}));
const noBreak: Candle[] = [100, 101, 102, 102.5].map((close, index) => ({
  timestamp: now - (4 - index) * 3_600_000, open: close - 1,
  high: [101, 102, 103, 103][index], low: [99, 100, 101, 101][index],
  close, volume: 100,
}));
const versions = { engine: "decision-1", score: "diagnostic-1", strategy: "donchian-1.0.0", riskPolicy: "paper-1" };
function journal(records: DecisionJournalRecord[] = []): DecisionWorkbenchJournal {
  const events: DecisionJournalEvent[] = [];
  return {
    append: async (record) => { records.push(structuredClone(record)); return structuredClone(record); },
    get: async (decisionId) => records.find((record) => record.decisionId === decisionId) ?? null,
    appendEvent: async (event) => {
      if (events.some((item) => item.eventId === event.eventId)) throw new Error("duplicate event");
      events.push(structuredClone(event));
      return structuredClone(event);
    },
    listEvents: async (decisionId) => events.filter((event) => event.decisionId === decisionId).map((event) => structuredClone(event)),
  };
}
function base(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: market(), candles: breakout, crossFeedStatus: "within_tolerance" as const,
    strategy, evaluationTime: now,
    gatePolicy: {
      instrumentCategory: "spot" as const,
      equity: 10_000, availableCapital: 10_000, existingExposure: 0, maxRiskPerTrade: 20,
      maxRiskFraction: 0.002, maxNotional: 2_000, maxExposure: 2_000,
      minimumNetRewardRisk: 1.4,
      execution: {
        feeRate: 0.001, baseSlippageBps: 10, halfSpreadBps: 0,
        maxParticipationRate: 0.05, marketImpactBpsAtMaxParticipation: 0,
      },
    },
    minimumSupportingFamilies: 2, versions, clockSource: "test-clock",
    journal: journal(), decisionId: "workbench-decision",
    ...overrides,
  };
}

describe("runDecisionWorkbench integration", () => {
  it("connects approved strategy generation to evidence evaluation and journal persistence", async () => {
    const records: DecisionJournalRecord[] = [];
    const result = await runDecisionWorkbench(base({ journal: journal(records) }));
    expect(result.generation.status).toBe("candidate");
    expect(result.assessment.result.status).toBe("ENTER");
    expect(result.assessment.record.candidate?.side).toBe("long");
    expect(result.assessment.record.evidence.length).toBeGreaterThanOrEqual(4);
    expect(records).toHaveLength(1);
    expect(result.shadowPlan.status).toBe("ready");
    expect(result.shadowPlanRegistered).toBe(true);
  });

  it("journals NO_SETUP with the actual detector reason when no breakout exists", async () => {
    const result = await runDecisionWorkbench(base({ candles: noBreak }));
    expect(result.generation.status).toBe("no_setup");
    expect(result.assessment.result.status).toBe("NO_SETUP");
    expect(result.assessment.result.reasonCodes).toContain("DONCHIAN_TRIGGER_ABSENT");
    expect(result.assessment.record.candidate).toBeNull();
    expect(result.shadowPlan).toMatchObject({ status: "not_simulatable", reasonCode: "NO_CANDIDATE" });
    expect(result.shadowPlanRegistered).toBe(false);
    expect(result.noSetupReplayRegistered).toBe(true);
  });

  it("lets the deterministic risk gate reject a generated candidate and journals it", async () => {
    const result = await runDecisionWorkbench(base({
      gatePolicy: {
        instrumentCategory: "spot" as const,
        equity: 10_000, availableCapital: 10_000, existingExposure: 0, maxRiskPerTrade: 10,
        maxRiskFraction: 0.002, maxNotional: 2_000, maxExposure: 2_000,
        minimumNetRewardRisk: 1.4,
        execution: {
          feeRate: 0.001, baseSlippageBps: 10, halfSpreadBps: 0,
          maxParticipationRate: 0.05, marketImpactBpsAtMaxParticipation: 0,
        },
      },
    }));
    expect(result.assessment.result.status).toBe("REJECT");
    expect(result.assessment.result.reasonCodes).toContain("MAX_RISK_PER_TRADE_EXCEEDED");
    expect(result.assessment.record.status).toBe("REJECT");
  });

  it("does not report a decision when journal persistence fails", async () => {
    await expect(runDecisionWorkbench(base({
      journal: { append: async () => { throw new Error("journal unavailable"); } },
    }))).rejects.toThrow("journal unavailable");
  });
});
