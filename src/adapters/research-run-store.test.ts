import { describe, expect, it } from "vitest";
import { ResearchRunStore } from "./research-run-store";
import type { ResearchBatchResult } from "../domain/research-pipeline";

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

  it("rejects malformed reports and invalid timestamps", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    await expect(store.save({} as ResearchBatchResult, 1000)).rejects.toThrow();
    await expect(store.save(report, -1)).rejects.toThrow();
  });

  it("deletes a stored run without affecting other records", async () => {
    const store = new ResearchRunStore(memoryIndexedDb());
    const first = await store.save(report, 1000);
    const second = await store.save({ ...report, dataset: { ...report.dataset, fingerprint: "fnv1a32:87654321" } }, 2000);
    await store.delete(first.id);
    expect((await store.list()).map((record) => record.id)).toEqual([second.id]);
  });
});
