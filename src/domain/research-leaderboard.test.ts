import { describe, expect, it } from "vitest";
import { buildResearchLeaderboard } from "./research-leaderboard";
import type { StoredResearchRun } from "../adapters/research-run-store";
import type { ResearchBatchResult } from "./research-pipeline";

function makeRun(id: string, createdAt: number, fingerprint: string, symbol = "BTCUSDT", feeRate = 0.001, returnPct = 5): StoredResearchRun {
  const trades = Array.from({ length: 35 }, (_, index) => ({
    entryTimestamp: index * 2, exitTimestamp: index * 2 + 1,
    entryPrice: 100, exitPrice: 101, quantity: 1,
    entryFee: 0, exitFee: 0, pnl: 1, pnlPct: 1, exitReason: "signal" as const,
  }));
  const folds = Array.from({ length: 5 }, (_, index) => ({
    index, trainStartTimestamp: 0, trainEndTimestamp: 1,
    testStartTimestamp: 2 + index * 2, testEndTimestamp: 3 + index * 2,
    result: {
      startingCapital: 1000, endingEquity: 1000 * (1 + returnPct / 100),
      cash: 1000, totalReturnPct: returnPct, maxDrawdownPct: 3,
      completedTrades: 7, winRatePct: 70, totalFees: 1, trades: trades.slice(index * 7, index * 7 + 7),
      equityCurve: [], openPosition: null,
    },
  }));
  const evaluation = {
    folds, foldCount: 5, totalCompletedTrades: 35, totalFees: 5,
    meanFoldReturnPct: returnPct, compoundedReturnPct: returnPct,
    worstFoldDrawdownPct: 3, aggregateWinRatePct: 70,
    totalFillEvents: 35, totalPartialFillEvents: 0,
    foldsWithOpenPositions: 0, foldsWithPendingOrders: 0, totalPendingQuantity: 0,
  };
  const candidate = {
    id: "donchian-v1", name: "Donchian baseline", evaluation,
    scorecard: {
      completedTrades: 35, positiveFoldPct: 80, worstFoldDrawdownPct: 3,
      expectancyPerTrade: 1, winRatePct: 70, profitFactor: 2,
      totalFees: 5,
    },
    regimeScorecard: { groups: [], classifiedTrades: 0, unclassifiedTrades: 35 },
  };
  const report = {
    dataset: { candleCount: 500, firstTimestamp: 1000, lastTimestamp: 2000, fingerprint,
      metadata: { symbol, interval: "1h", provider: "binance" } },
    config: {
      folds: { trainBars: 100, testBars: 50, stepBars: 50, embargoBars: 2, expanding: true },
      backtest: { initialCapital: 10_000, feeRate, slippageBps: 5, allocationFraction: 0.25 },
      executionModel: { feeRate, baseSlippageBps: 5, halfSpreadBps: 2, maxParticipationRate: 0.01, marketImpactBpsAtMaxParticipation: 25 },
      regime: { fastEmaPeriod: 10, slowEmaPeriod: 30, atrPeriod: 14, trendThresholdPct: 0.15, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3 },
    },
    candidateResults: [candidate],
  } as unknown as ResearchBatchResult;
  return { id, createdAt, report };
}

describe("buildResearchLeaderboard", () => {
  it("groups only identical market data and execution assumptions", () => {
    const result = buildResearchLeaderboard([
      makeRun("a", 100, "dataset-a"),
      makeRun("b", 200, "dataset-a"),
      makeRun("c", 300, "dataset-b"),
      makeRun("d", 400, "dataset-a", "ETHUSDT"),
      makeRun("e", 500, "dataset-a", "BTCUSDT", 0.002),
    ]);
    expect(result.groups).toHaveLength(4);
    expect(result.groups.find((group) => group.runIds.includes("a"))?.runIds).toEqual(["b", "a"]);
  });

  it("ranks best raw result separately from the robust shortlist", () => {
    const result = buildResearchLeaderboard([
      makeRun("lower", 100, "same", "BTCUSDT", 0.001, 4),
      makeRun("higher", 200, "same", "BTCUSDT", 0.001, 9),
    ]);
    const group = result.groups[0];
    expect(group.bestHistorical[0].runId).toBe("higher");
    expect(group.mostRobust[0].runId).toBe("higher");
    expect(group.bestHistorical[0].returnPct).toBe(9);
  });

  it("isolates records with missing provenance instead of guessing compatibility", () => {
    const valid = makeRun("valid", 100, "same");
    const missing = makeRun("missing", 200, "same");
    delete (missing.report.dataset as { metadata?: unknown }).metadata;
    const result = buildResearchLeaderboard([valid, missing]);
    expect(result.groups).toHaveLength(2);
    expect(result.nonComparableRunIds).toContain("missing");
  });

  it("uses stable ordering for equal results and reports empty history", () => {
    const result = buildResearchLeaderboard([
      makeRun("z-run", 100, "same"),
      makeRun("a-run", 100, "same"),
    ]);
    expect(result.groups[0].bestHistorical.map((entry) => entry.runId)).toEqual(["a-run", "z-run"]);
    expect(buildResearchLeaderboard([]).groups).toEqual([]);
  });
});
