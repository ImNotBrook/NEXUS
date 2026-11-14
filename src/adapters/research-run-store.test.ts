import { describe, expect, it } from "vitest";
import { ResearchRunStore } from "./research-run-store";
import type { ResearchBatchResult } from "../domain/research-pipeline";
import { buildResearchLeaderboard } from "../domain/research-leaderboard";
import { buildExecutionStressLeaderboard } from "../domain/execution-stress-leaderboard";

function memoryIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      const records = new Map<string, unknown>();
      stores.set(name, records);
      return { createIndex: () => undefined };
    },
    transaction: (name: string) => {
      const records = stores.get(name);
      if (!records) throw new Error("Missing object store");
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        put: (record: { id: string }) => {
          records.set(record.id, structuredClone(record));
          queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
        },
        getAll: () => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = [...records.values()].map((record) => structuredClone(record));
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        delete: (id: string) => {
          records.delete(id);
          queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
        },
      });
      return transaction;
    },
    close: () => undefined,
  };
  return {
    open: () => {
      const request: Record<string, unknown> = { result: database };
      queueMicrotask(() => {
        (request.onupgradeneeded as (() => void) | undefined)?.();
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
}

const report = {
  dataset: { candleCount: 300, firstTimestamp: 1, lastTimestamp: 300, fingerprint: "fnv1a32:12345678" },
  config: {
    folds: { trainBars: 100, testBars: 20, stepBars: 20, embargoBars: 2, expanding: true },
    backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
    regime: { fastEmaPeriod: 10, slowEmaPeriod: 30, atrPeriod: 14, trendThresholdPct: 0.15, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3 },
  },
  candidateResults: [],
} as unknown as ResearchBatchResult;

describe("ResearchRunStore", () => {
  it("persists and lists reproducible reports newest first", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, 1000);
    const second = await store.save({ ...report, dataset: { ...report.dataset, fingerprint: "fnv1a32:87654321" } }, 2000);
    const records = await store.list();
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    expect(records[0].report.dataset.fingerprint).toBe("fnv1a32:87654321");
  });


  it("feeds persisted research records into the compatibility-safe leaderboard after reload", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    const trades = Array.from({ length: 30 }, (_, index) => ({
      entryTimestamp: index * 2, exitTimestamp: index * 2 + 1,
      entryPrice: 100, exitPrice: 101, quantity: 1,
      entryFee: 0, exitFee: 0, pnl: 1, pnlPct: 1, exitReason: "signal" as const,
    }));
    const evaluation = {
      folds: Array.from({ length: 5 }, (_, index) => ({
        index, trainStartTimestamp: 0, trainEndTimestamp: 1,
        testStartTimestamp: index * 2 + 2, testEndTimestamp: index * 2 + 3,
        result: {
          startingCapital: 1000, endingEquity: 1001, cash: 1000,
          totalReturnPct: 1, maxDrawdownPct: 2, completedTrades: 6,
          winRatePct: 100, totalFees: 0, trades: trades.slice(index * 6, index * 6 + 6),
          equityCurve: [], openPosition: null,
        },
      })),
      foldCount: 5, totalCompletedTrades: 30, totalFees: 0,
      meanFoldReturnPct: 1, compoundedReturnPct: 5,
      worstFoldDrawdownPct: 2, aggregateWinRatePct: 100,
      totalFillEvents: 30, totalPartialFillEvents: 0,
      foldsWithOpenPositions: 0, foldsWithPendingOrders: 0, totalPendingQuantity: 0,
    };
    const persistedReport = {
      ...report,
      dataset: { ...report.dataset, metadata: { symbol: "BTCUSDT", interval: "1h", provider: "binance" } },
      candidateResults: [{
        id: "baseline-v1", name: "Baseline",
        evaluation,
        scorecard: {
          completedTrades: 30, positiveFoldPct: 100, worstFoldDrawdownPct: 2,
          expectancyPerTrade: 1, winRatePct: 100, profitFactor: 2, totalFees: 0,
        },
        regimeScorecard: { groups: [], classifiedTrades: 0, unclassifiedTrades: 30 },
      }],
    } as unknown as ResearchBatchResult;
    await store.save(persistedReport, 1000);
    const reloaded = await store.list();
    const leaderboard = buildResearchLeaderboard(reloaded);
    expect(leaderboard.groups).toHaveLength(1);
    expect(leaderboard.groups[0].bestHistorical[0]).toMatchObject({
      runId: reloaded[0].id,
      candidateId: "baseline-v1",
      reviewStatus: "REVIEW_FOR_PAPER",
    });
  });

  it("rejects malformed reports and invalid timestamps", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    await expect(store.save({} as ResearchBatchResult, 1000)).rejects.toThrow();
    await expect(store.save(report, -1)).rejects.toThrow();
  });

  it("lists the complete saved history independently of the bounded recent-history view", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, 1000);
    const second = await store.save({ ...report, dataset: { ...report.dataset, fingerprint: "fnv1a32:87654321" } }, 2000);
    expect((await store.list(1)).map((record) => record.id)).toEqual([second.id]);
    expect((await store.listAll()).map((record) => record.id)).toEqual([second.id, first.id]);
  });

  it("reconstructs a complete stress leaderboard from reports persisted then reopened from IndexedDB", async () => {
    const database = memoryIndexedDb();
    const writer = new ResearchRunStore(database);
    const reader = new ResearchRunStore(database);
    const candidate = {
      id: "strategy-v1", name: "Strategy V1",
      evaluation: { compoundedReturnPct: 10, folds: Array.from({ length: 5 }, () => ({})) },
      scorecard: { completedTrades: 40, worstFoldDrawdownPct: 8, expectancyPerTrade: 0.5 },
    };
    const stressReport = (fingerprint: string, returnPct: number) => ({
      ...report,
      dataset: { ...report.dataset, fingerprint, metadata: { symbol: "BTCUSDT", interval: "1h", provider: "binance" } },
      candidateResults: [{ ...candidate, evaluation: { ...candidate.evaluation, compoundedReturnPct: returnPct } }],
    }) as unknown as ResearchBatchResult;
    const expectedScenarioIds = ["baseline", "friction-2x"];
    const familyId = "persisted-family";
    await writer.save(stressReport("same-data", 20), 1000, {
      version: 1, familyId, scenarioId: "baseline", scenarioIndex: 0, scenarioCount: 2,
      expectedScenarioIds, label: "BTCUSDT stress", costMultiplier: 1, participationMultiplier: 1,
    });
    await writer.save(stressReport("same-data", 7), 1001, {
      version: 1, familyId, scenarioId: "friction-2x", scenarioIndex: 1, scenarioCount: 2,
      expectedScenarioIds, label: "BTCUSDT stress", costMultiplier: 2, participationMultiplier: 1,
    });
    const reloaded = await reader.listAll();
    const leaderboard = buildExecutionStressLeaderboard(reloaded);
    expect(leaderboard.families).toHaveLength(1);
    expect(leaderboard.families[0].rankedCandidates[0]).toMatchObject({
      candidateId: "strategy-v1", worstCaseReturnPct: 7, scenarioCount: 2,
    });
  });

  it("deletes a stored run without affecting other records", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, 1000);
    const second = await store.save({ ...report, dataset: { ...report.dataset, fingerprint: "fnv1a32:87654321" } }, 2000);
    await store.delete(first.id);
    expect((await store.list()).map((record) => record.id)).toEqual([second.id]);
  });
});
