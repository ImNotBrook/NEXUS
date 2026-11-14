import { describe, expect, it } from "vitest";
import { runDecisionWorkbench } from "./decision-workbench-service";
import { evaluateShadowOutcomes, type ShadowOutcomeServiceJournal } from "./shadow-outcome-service";
import type { DecisionJournalEvent, DecisionJournalRecord } from "./decision-journal";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { Candle } from "./candles";

const now = 1_800_000_000_000;
const hour = 3_600_000;
function frame(timeframe: "1d" | "4h" | "1h" | "15m") {
  return {
    timeframe, status: "available" as const, provider: "Binance", fetchedAt: now,
    candleCount: 60, latestCandleAt: now - hour, availableAt: now - 1_000,
    trend: "uptrend" as const, volatility: "normal" as const, emaSpreadPct: 0.4,
    trendStrengthPct: 0.4, trendPersistencePct: 80, atrPct: 1,
    volatilityRankPct: 50, relativeVolume20: 1.2, reason: null,
  };
}
const snapshot: MarketIntelligenceSnapshot = {
  schemaVersion: 1, engineVersion: "market-intelligence-v1", snapshotId: "e2e-snapshot",
  contentHash: "e".repeat(64), symbol: "BTCUSDT", instrumentCategory: "spot", volumeUnit: "base",
  evaluationTime: now,
  config: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
  latestSourceAvailableAt: now - 1_000, dataQuality: "pass",
  coverage: { expectedTimeframes: 4, availableTimeframes: 4, missingTimeframes: [] },
  frames: { "1d": frame("1d"), "4h": frame("4h"), "1h": frame("1h"), "15m": frame("15m") },
  macroTrend: "uptrend", primaryTrend: "uptrend", tacticalTrend: "uptrend", microTrend: "uptrend",
  alignment: "aligned", lowerTimeframeDivergence: false, volatilityContext: "normal", phase: "trend",
  phaseRationale: "Aligned trends", uncertainty: "low",
  liquidity: { status: "partial", relativeVolume20: 1.2, depthStatus: "unknown", breadthStatus: "unknown", note: "Volume proxy only" },
  positioning: { status: "unknown", note: "Unavailable" }, missingDimensions: [],
  supportingObservations: [], contradictions: [],
};
const strategy = {
  id: "donchian-breakout", version: "1.0.0", approvedBy: "human-review",
  approvalRationale: "Approved for paper-only research evaluation", approvedAt: now - 10_000,
  lookback: 3, atrStopMultiple: 2, rewardRiskMultiple: 2,
  riskBudget: 20, maxNotional: 2_000, expiryBars: 2,
};
const decisionCandles: Candle[] = [100, 101, 102, 106].map((close, index) => ({
  timestamp: now - (4 - index) * hour, open: close - 1,
  high: [101, 102, 103, 107][index], low: [99, 100, 101, 105][index],
  close, volume: 1_000,
}));
class MemoryJournal implements ShadowOutcomeServiceJournal {
  records: DecisionJournalRecord[] = [];
  events: DecisionJournalEvent[] = [];
  async append(record: DecisionJournalRecord): Promise<DecisionJournalRecord> {
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }
  async get(id: string): Promise<DecisionJournalRecord | null> {
    return structuredClone(this.records.find((record) => record.decisionId === id) ?? null);
  }
  async list(): Promise<DecisionJournalRecord[]> {
    return structuredClone(this.records);
  }
  async appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent> {
    if (this.events.some((item) => item.eventId === event.eventId)) throw new Error("duplicate event");
    this.events.push(structuredClone(event));
    return structuredClone(event);
  }
  async listEvents(id: string): Promise<DecisionJournalEvent[]> {
    return structuredClone(this.events.filter((event) => event.decisionId === id));
  }
}

describe("NEXUS decision-to-outcome end-to-end domain workflow", () => {
  it("generates a decision, registers its plan, replays later candles and produces a mature learning observation", async () => {
    const journal = new MemoryJournal();
    const decision = await runDecisionWorkbench({
      snapshot, candles: decisionCandles, crossFeedStatus: "within_tolerance",
      strategy, evaluationTime: now,
      gatePolicy: {
        instrumentCategory: "spot", equity: 10_000, availableCapital: 10_000,
        existingExposure: 0, maxRiskPerTrade: 20, maxRiskFraction: 0.002,
        maxNotional: 2_000, maxExposure: 2_000, minimumNetRewardRisk: 1.4,
        execution: {
          feeRate: 0.001, baseSlippageBps: 10, halfSpreadBps: 0,
          maxParticipationRate: 0.05, marketImpactBpsAtMaxParticipation: 5,
        },
      },
      minimumSupportingFamilies: 2,
      versions: { engine: "decision-1", score: "score-1", strategy: "strategy-1", riskPolicy: "risk-1" },
      clockSource: "test-clock", journal, decisionId: "decision-e2e",
    });
    expect(decision.assessment.result.status).toBe("ENTER");
    expect(decision.shadowPlanRegistered).toBe(true);
    expect(journal.events[0].eventType).toBe("shadow_plan_registered");

    const plan = decision.shadowPlan.status === "ready" ? decision.shadowPlan.plan : null;
    expect(plan).not.toBeNull();
    if (!plan) throw new Error("Expected a registered shadow plan");

    const laterCandles: Candle[] = [];
    for (let index = 1; index <= 24; index++) {
      const targetReached = index === 2;
      laterCandles.push({
        timestamp: plan.entry.earliestEligibleAt + (index - 1) * hour,
        open: plan.entry.referencePrice,
        high: targetReached ? plan.targetPrice * 1.01 : plan.entry.referencePrice * 1.01,
        low: plan.entry.referencePrice * 0.99,
        close: plan.entry.referencePrice,
        volume: 10_000,
      });
    }

    const report = await evaluateShadowOutcomes({
      journal,
      now: now + 26 * hour,
      fetchHistory: async () => laterCandles,
      hasher: async () => "e2e-outcome-hash",
    });
    expect(report.plansEvaluated).toBe(1);
    expect(report.outcomesRecorded).toBe(1);
    expect(report.failures).toHaveLength(0);
    expect(report.latestOutcomes[0]).toMatchObject({
      decisionId: "decision-e2e",
      decisionStatus: "ENTER",
      outcomeStatus: "completed",
      horizonReached: true,
      dataQuality: "pass",
    });
    expect(report.learning.eligibleObservations).toBe(1);
    expect(report.learning.cohorts[0]).toMatchObject({
      decisionStatus: "ENTER",
      maturedCandidates: 1,
      completedTrades: 1,
      noFillCandidates: 0,
    });
    expect(journal.events.map((event) => event.eventType)).toEqual([
      "shadow_plan_registered", "outcome_appended",
    ]);
  });
});
