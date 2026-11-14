import { describe, expect, it } from "vitest";
import { SealedHoldoutStore } from "./sealed-holdout-store";
import type { SealedHoldoutSeal } from "../domain/sealed-holdout";
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
      const finish = () => queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
      transaction.abort = () => queueMicrotask(() => (transaction.onabort as (() => void) | undefined)?.());
      transaction.objectStore = () => ({
        add: (record: { id: string }) => { records.set(record.id, structuredClone(record)); finish(); },
        put: (record: { id: string }) => { records.set(record.id, structuredClone(record)); finish(); },
        get: (id: string) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = records.get(id);
            (request.onsuccess as (() => void) | undefined)?.();
          });
          return request;
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

const seal: SealedHoldoutSeal = {
  protocol: "NEXUS_FINAL_HOLDOUT_V1",
  identity: { symbol: "BTCUSDT", interval: "1h", startTimestamp: 1_000, endTimestamp: 2_000 },
  datasetFingerprint: "fnv1a32:dataset", developmentFingerprint: "fnv1a32:dev",
  holdoutFingerprint: "fnv1a32:holdout", candidateIds: ["baseline-v1"],
  candidateFingerprint: "fnv1a32:candidate", pipelineFingerprint: "fnv1a32:pipeline",
  developmentBars: 398, embargoBars: 2, holdoutBars: 100, fraction: 0.2,
};
const report = {
  dataset: { candleCount: 500, firstTimestamp: 0, lastTimestamp: 2_000, fingerprint: seal.datasetFingerprint },
  config: {},
  candidateResults: [{ id: "baseline-v1" }],
} as unknown as ResearchBatchResult;

describe("SealedHoldoutStore", () => {
  it("reserves a final holdout period and blocks overlapping reuse even with a different strategy fingerprint", async () => {
    const store = new SealedHoldoutStore(memoryIndexedDb());
    await expect(store.reserve(seal, 10)).resolves.toMatchObject({ status: "sealed", seal });
    await expect(store.reserve({
      ...seal,
      identity: { ...seal.identity, startTimestamp: 1_500, endTimestamp: 2_500 },
      candidateFingerprint: "different-strategy",
      pipelineFingerprint: "different-pipeline",
    }, 20)).rejects.toThrow(/overlaps a previously sealed evaluation/i);
  });

  it("completes a reserved seal only with a matching dataset and candidate manifest", async () => {
    const store = new SealedHoldoutStore(memoryIndexedDb());
    const reserved = await store.reserve(seal, 10);
    await expect(store.complete(reserved.id, {
      ...report, dataset: { ...report.dataset, fingerprint: "wrong" },
    })).rejects.toThrow(/does not match/i);
    await expect(store.complete(reserved.id, report)).resolves.toMatchObject({
      id: reserved.id, status: "completed", report,
    });
    await expect(store.complete(reserved.id, report)).rejects.toThrow(/incomplete seal/i);
  });

  it("keeps an incomplete reservation visible and validates malformed manifests", async () => {
    const store = new SealedHoldoutStore(memoryIndexedDb());
    await store.reserve(seal, 10);
    expect(await store.list()).toMatchObject([{ status: "sealed" }]);
    expect((await store.list())[0]).not.toHaveProperty("report");
    await expect(store.reserve({ ...seal, holdoutBars: 0 }, 20)).rejects.toThrow();
    await expect(store.list(0)).rejects.toThrow();
  });
});
