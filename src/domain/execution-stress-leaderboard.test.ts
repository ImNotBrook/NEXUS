import { describe, expect, it } from "vitest";
import { buildExecutionStressLeaderboard } from "./execution-stress-leaderboard";
import type { StoredResearchRun } from "../adapters/research-run-store";
import type { ResearchBatchResult } from "./research-pipeline";

function makeScenarioRun(
  id: string,
  familyId: string,
  scenarioId: string,
  scenarioIndex: number,
  returnPct: number,
): StoredResearchRun {
  const trades = Array.from({ length: 35 }, (_, index) => ({
    entryTimestamp: index * 2, exitTimestamp: index * 2 + 1,
    entryPrice: 100, exitPrice: 101, quantity: 1,
    entryFee: 0, exitFee: 0, pnl: 1, pnlPct: 1, exitReason: "signal" as const,
  }));
  const evaluation = {
    folds: Array.from({ length: 5 }, (_, index) => ({
      index, trainStartTimestamp: 0, trainEndTimestamp: 1,
      testStartTimestamp: index * 2 + 2, testEndTimestamp: index * 2 + 3,
      result: { startingCapital: 1000, endingEquity: 1000, cash: 1000,
        totalReturnPct: returnPct, maxDrawdownPct: 3, completedTrades: 7,
        winRatePct: 70, totalFees: 1, trades: trades.slice(index * 7, index * 7 + 7),
        equityCurve: [], openPosition: null },
    })),
    foldCount: 5, totalCompletedTrades: 35, totalFees: 5,
    meanFoldReturnPct: returnPct, compoundedReturnPct: returnPct,
    worstFoldDrawdownPct: 3, aggregateWinRatePct: 70,
    totalFillEvents: 35, totalPartialFillEvents: 0,
    foldsWithOpenPositions: 0, foldsWithPendingOrders: 0, totalPendingQuantity: 0,
  };
  const candidate = {
    id: "donchian-v1", name: "Donchian baseline", evaluation,
    scorecard: { completedTrades: 35, positiveFoldPct: 80, worstFoldDrawdownPct: 3,
      expectancyPerTrade: 1, winRatePct: 70, profitFactor: 2, totalFees: 5 },
    regimeScorecard: { groups: [], classifiedTrades: 0, unclassifiedTrades: 35 },
  };
  const report = {
    dataset: { candleCount: 500, firstTimestamp: 1000, lastTimestamp: 2000,
      fingerprint: "dataset-a", metadata: { symbol: "BTCUSDT", interval: "1h", provider: "binance" } },
    config: {
      folds: { trainBars: 100, testBars: 50, stepBars: 50, embargoBars: 2, expanding: true },
      backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
      executionModel: { feeRate: 0.001, baseSlippageBps: 5, halfSpreadBps: 2,
        maxParticipationRate: 0.01, marketImpactBpsAtMaxParticipation: 25 },
      regime: { fastEmaPeriod: 10, slowEmaPeriod: 30, atrPeriod: 14,
        trendThresholdPct: 0.15, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3 },
    },
    candidateResults: [candidate],
  } as unknown as ResearchBatchResult;
  return {
    id, createdAt: 1000 + scenarioIndex, report,
    stressFamily: {
      version: 1, familyId, scenarioId, scenarioIndex, scenarioCount: 2,
      expectedScenarioIds: ["baseline", "friction-2x"],
      label: "Default execution stress", costMultiplier: scenarioId === "baseline" ? 1 : 2,
      participationMultiplier: 1,
    },
  } as StoredResearchRun;
}

describe("buildExecutionStressLeaderboard", () => {
  it("reconstructs complete persisted families and applies the established stress ranking", () => {
    const records = [
      makeScenarioRun("base", "family-a", "baseline", 0, 25),
      makeScenarioRun("stress", "family-a", "friction-2x", 1, 12),
    ];
    const result = buildExecutionStressLeaderboard(records);
    expect(result.families).toHaveLength(1);
    expect(result.families[0].status).toBe("COMPLETE");
    expect(result.families[0].rankedCandidates[0]).toMatchObject({
      candidateId: "donchian-v1", worstCaseReturnPct: 12, scenarioCount: 2,
    });
  });

  it("excludes incomplete, duplicate and inconsistent scenario families", () => {
    const incomplete = buildExecutionStressLeaderboard([
      makeScenarioRun("base", "incomplete", "baseline", 0, 25),
    ]);
    expect(incomplete.families).toHaveLength(0);
    expect(incomplete.excludedFamilyIds).toContain("incomplete");

    const duplicate = buildExecutionStressLeaderboard([
      makeScenarioRun("base", "duplicate", "baseline", 0, 25),
      makeScenarioRun("base-copy", "duplicate", "baseline", 0, 24),
    ]);
    expect(duplicate.families).toHaveLength(0);
    expect(duplicate.excludedFamilyIds).toContain("duplicate");

    const mismatch = makeScenarioRun("stress", "mismatch", "friction-2x", 1, 12);
    mismatch.report = {
      ...mismatch.report,
      dataset: { ...mismatch.report.dataset, fingerprint: "different-data" },
    };
    const inconsistent = buildExecutionStressLeaderboard([
      makeScenarioRun("base", "mismatch", "baseline", 0, 25), mismatch,
    ]);
    expect(inconsistent.families).toHaveLength(0);
  });

  it("never guesses family membership for legacy reports without metadata", () => {
    const legacy = makeScenarioRun("legacy", "ignored", "baseline", 0, 20);
    delete (legacy as Partial<StoredResearchRun>).stressFamily;
    const result = buildExecutionStressLeaderboard([legacy]);
    expect(result.families).toEqual([]);
    expect(result.unassignedRunIds).toEqual(["legacy"]);
  });

  it("orders families deterministically and validates duplicate run IDs", () => {
    const records = [
      makeScenarioRun("z-base", "z-family", "baseline", 0, 25),
      makeScenarioRun("z-stress", "z-family", "friction-2x", 1, 12),
      makeScenarioRun("a-base", "a-family", "baseline", 0, 20),
      makeScenarioRun("a-stress", "a-family", "friction-2x", 1, 10),
    ];
    expect(buildExecutionStressLeaderboard(records).families.map((family) => family.familyId))
      .toEqual(["a-family", "z-family"]);
    expect(() => buildExecutionStressLeaderboard([records[0], records[0]])).toThrow();
  });
});
