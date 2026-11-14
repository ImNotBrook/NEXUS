import { describe, expect, it } from "vitest";
import { StrategyLibraryStore } from "./strategy-library-store";
import type { StrategyDefinition } from "../domain/strategy-studio";

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
      if (!records) throw new Error("Missing object store: " + name);
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        add: (record: { id: string }) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            if (records.has(record.id)) {
              request.error = new DOMException("ConstraintError", "ConstraintError");
              (request.onerror as (() => void) | undefined)?.();
              (transaction.onabort as (() => void) | undefined)?.();
              return;
            }
            records.set(record.id, structuredClone(record));
            request.result = record.id;
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
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

const definition: StrategyDefinition = {
  schemaVersion: 1, id: "btc-sma", version: "1.0.0", name: "BTC SMA",
  family: "sma-crossover", parameters: { fastPeriod: 8, slowPeriod: 24 },
  createdAt: 1000, origin: "human", description: "Reviewed research definition",
};

describe("StrategyLibraryStore", () => {
  it("persists immutable definitions and reloads them newest first", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    const first = await store.save(definition);
    const second = await store.save({ ...definition, id: "btc-rsi", name: "BTC RSI", family: "rsi-mean-reversion", parameters: { period: 14, oversold: 30, overbought: 70 }, createdAt: 2000 });
    const records = await store.list();
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    expect(records[0].definition.family).toBe("rsi-mean-reversion");
    (records[0].definition.parameters as { period: number }).period = 99;
    expect((await store.list())[0].definition.parameters).toEqual({ period: 14, oversold: 30, overbought: 70 });
  });

  it("rejects duplicate versions instead of overwriting an immutable definition", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    await store.save(definition);
    await expect(store.save({ ...definition, name: "Mutated definition" })).rejects.toThrow();
  });

  it("rejects invalid definitions and unsafe limits", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    await expect(store.save({ ...definition, version: "bad" })).rejects.toThrow(/Invalid strategy/);
    await expect(store.list(0)).rejects.toThrow(/limit/);
  });
});
