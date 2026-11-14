import { describe, expect, it } from "vitest";
import { PaperAccountStore } from "./paper-account-store";
import { createPaperAccount, executePaperMarketOrder } from "../domain/paper-broker";

function createMemoryIndexedDb(): IDBFactory {
  const records = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: {
      contains: (name: string) => records.has(name),
    },
    createObjectStore: (name: string) => {
      records.set(name, new Map());
      return { createIndex: () => undefined };
    },
    transaction: (name: string) => {
      const store = records.get(name);
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
        add: (value: { id: string }) => {
          if (store.has(value.id)) throw new DOMException("Duplicate key", "ConstraintError");
          store.set(value.id, structuredClone(value));
          queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
        },
        put: (value: { id: string }) => {
          store.set(value.id, structuredClone(value));
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

describe("PaperAccountStore", () => {
  it("loads null before the first account snapshot and round-trips a saved account", async () => {
    const store = new PaperAccountStore(createMemoryIndexedDb());
    expect(await store.load()).toBeNull();

    const timestamp = Date.UTC(2026, 0, 1);
    const account = createPaperAccount({}, timestamp);
    const filled = executePaperMarketOrder(account, {
      symbol: "BTCUSDT",
      side: "buy",
      quantity: 0.001,
      referencePrice: 50_000,
      timestamp,
    });

    await store.save(filled);
    const restored = await store.load();
    expect(restored).toEqual(filled);
    expect(restored?.cash).toBeCloseTo(filled.cash);
    expect(restored?.fills).toHaveLength(1);
    expect(restored?.config).toEqual(filled.config);
  });

  it("restores only into an empty account and refuses to overwrite existing paper state", async () => {
    const factory = createMemoryIndexedDb();
    const store = new PaperAccountStore(factory);
    const original = createPaperAccount({}, Date.UTC(2026, 0, 1));
    await store.restore(original);
    expect(await store.load()).toEqual(original);
    await expect(store.restore(createPaperAccount({}, Date.UTC(2026, 0, 2)))).rejects.toThrow();
    expect(await store.load()).toEqual(original);
    await expect(store.restore({ ...original, cash: Number.NaN })).rejects.toThrow(/cash/i);
  });

  it("keeps separately named local paper accounts isolated", async () => {
    const factory = createMemoryIndexedDb();
    const primary = new PaperAccountStore(factory, "primary");
    const secondary = new PaperAccountStore(factory, "secondary");
    await primary.save(createPaperAccount({}, Date.UTC(2026, 0, 1)));
    expect(await secondary.load()).toBeNull();
  });
});
