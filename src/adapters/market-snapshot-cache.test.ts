import { describe, expect, it } from "vitest";
import { IndexedDbMarketSnapshotCache } from "./market-snapshot-cache";
import type { MarketSnapshot } from "../domain/market-data";

function memoryIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => { stores.set(name, new Map()); return { createIndex: () => undefined }; },
    transaction: (name: string) => {
      const store = stores.get(name);
      if (!store) throw new Error("Missing object store");
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        get: (key: string) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = store.get(key);
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        put: (record: { key: string }) => {
          store.set(record.key, structuredClone(record));
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

const snapshot: MarketSnapshot = {
  symbol: "BTCUSDT",
  interval: "1h",
  provider: "binance",
  fetchedAt: 1_700_000_000_000,
  stale: false,
  candles: [{ timestamp: 1_699_996_400_000, open: 100, high: 110, low: 90, close: 105, volume: 12 }],
};

describe("IndexedDbMarketSnapshotCache", () => {
  it("round-trips snapshots by symbol and interval", async () => {
    const cache = new IndexedDbMarketSnapshotCache(memoryIndexedDb());
    expect(await cache.load("BTCUSDT", "1h")).toBeNull();
    await cache.save(snapshot);
    expect(await cache.load("BTCUSDT", "1h")).toEqual(snapshot);
    expect(await cache.load("BTCUSDT", "4h")).toBeNull();
  });

  it("replaces a previous snapshot for the same market key", async () => {
    const cache = new IndexedDbMarketSnapshotCache(memoryIndexedDb());
    await cache.save(snapshot);
    const newer = { ...snapshot, fetchedAt: snapshot.fetchedAt + 3_600_000 };
    await cache.save(newer);
    expect(await cache.load("BTCUSDT", "1h")).toEqual(newer);
  });
});
