import { describe, expect, it } from "vitest";
import { NestedResearchRunStore } from "./nested-research-run-store";
import type { NestedWalkForwardConfig, NestedWalkForwardResult } from "../domain/nested-walk-forward-selection";

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

const config: NestedWalkForwardConfig = {
  outerFolds: { trainBars: 100, testBars: 20, stepBars: 20, embargoBars: 2, expanding: true },
  innerFolds: { trainBars: 50, testBars: 10, stepBars: 10, embargoBars: 2, expanding: true },
  grid: { stopLossValuesPct: [2, 4], takeProfitValuesPct: [4, 8] },
  minimumInnerTrades: 2,
};
const metadata = { symbol: "BTCUSDT", interval: "1h", provider: "Binance public spot" };
const report: NestedWalkForwardResult = {
  datasetFingerprint: "fnv1a32:12345678",
  outerFoldCount: 2,
  candidateResults: [{
    id: "trend", name: "Trend", folds: [], compoundedOuterReturnPct: 3,
    meanOuterReturnPct: 1.5, worstOuterFoldDrawdownPct: 2, totalOuterCompletedTrades: 8,
    profitFactor: 1.4, expectancyPerTrade: 2, totalFees: 4, completedTurnover: 1.2,
    averageExposurePct: 20, stopLossExitCount: 1, takeProfitExitCount: 2,
    totalPendingQuantity: 0, totalFillEvents: 10, totalPartialFillEvents: 2,
    parameterStability: [{ stopLossPct: 2, takeProfitPct: 4, outerFoldCount: 2 }],
  }],
  selectionWarning: "Outer test results must not be used to revise selection.",
};

describe("NestedResearchRunStore", () => {
  it("persists complete nested reports with metadata and configuration, newest first", async () => {
    const store = new NestedResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, metadata, config, 1000);
    const second = await store.save({ ...report, datasetFingerprint: "fnv1a32:87654321" }, metadata, config, 2000);

    const records = await store.list();
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    expect(records[0]).toMatchObject({
      createdAt: 2000,
      metadata,
      config,
      report: { datasetFingerprint: "fnv1a32:87654321", candidateResults: report.candidateResults },
    });
  });

  it("returns isolated copies so callers cannot mutate persisted records", async () => {
    const store = new NestedResearchRunStore(memoryIndexedDb());
    await store.save(report, metadata, config, 1000);
    const listed = await store.list();
    listed[0].report.candidateResults[0].name = "Mutated";
    expect((await store.list())[0].report.candidateResults[0].name).toBe("Trend");
  });

  it("deletes one nested run without affecting other records", async () => {
    const store = new NestedResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, metadata, config, 1000);
    const second = await store.save({ ...report, datasetFingerprint: "fnv1a32:87654321" }, metadata, config, 2000);
    await store.delete(first.id);
    expect((await store.list()).map((record) => record.id)).toEqual([second.id]);
  });

  it("rejects malformed reports, metadata, configuration and timestamps", async () => {
    const store = new NestedResearchRunStore(memoryIndexedDb());
    await expect(store.save({} as NestedWalkForwardResult, metadata, config, 1000)).rejects.toThrow();
    await expect(store.save(report, { ...metadata, symbol: "" }, config, 1000)).rejects.toThrow();
    await expect(store.save(report, metadata, { ...config, grid: {} } as NestedWalkForwardConfig, 1000)).rejects.toThrow();
    await expect(store.save(report, metadata, config, -1)).rejects.toThrow();
    await expect(store.list(0)).rejects.toThrow();
  });
});
