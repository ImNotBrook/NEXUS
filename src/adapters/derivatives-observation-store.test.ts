import { describe, expect, it } from "vitest";
import { DerivativesObservationStore } from "./derivatives-observation-store";
import type { DerivativesObservation } from "../domain/derivatives-data";

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
        put: (record: { key: string }) => {
          records.set(record.key, structuredClone(record));
          queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
        },
        delete: (key: string) => { records.delete(key); },
        index: () => ({
          getAll: (series: string) => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              request.result = [...records.values()].filter(
                (record) => (record as { series: string }).series === series,
              );
              (request.onsuccess as (() => void) | undefined)?.();
              (transaction.oncomplete as (() => void) | undefined)?.();
            });
            return request;
          },
        }),
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

const base = 1_700_000_000_000;
const funding: DerivativesObservation[] = [
  { metric: "funding_rate", provider: "bybit", symbol: "BTCUSDT", category: "linear",
    timestamp: base, fundingRate: 0.0001, unit: "rate_per_settlement" },
  { metric: "funding_rate", provider: "bybit", symbol: "BTCUSDT", category: "linear",
    timestamp: base + 8 * 60 * 60_000, fundingRate: 0.0002, unit: "rate_per_settlement" },
];

describe("DerivativesObservationStore", () => {
  it("stores and returns timestamp-ordered observations with ingestion provenance", async () => {
    const store = new DerivativesObservationStore(memoryIndexedDb());
    await store.save([...funding].reverse(), base + 100);
    expect(await store.load("BYBIT", "BTCUSDT", "linear", "funding_rate")).toEqual([
      { observation: funding[0], ingestedAt: base + 100 },
      { observation: funding[1], ingestedAt: base + 100 },
    ]);
  });

  it("upserts the same metric timestamp without overwriting another series", async () => {
    const store = new DerivativesObservationStore(memoryIndexedDb());
    await store.save([funding[0]]);
    await store.save([{ ...funding[0], fundingRate: 0.0003 }], base + 1);
    await store.save([{
      metric: "account_ratio", provider: "bybit", symbol: "BTCUSDT", category: "linear",
      timestamp: base, longAccountRatio: 0.6, shortAccountRatio: 0.4, measurement: "account_share",
    }]);
    const rows = await store.load("bybit", "BTCUSDT", "linear", "funding_rate");
    expect(rows).toHaveLength(1);
    expect(rows[0].observation).toMatchObject({ fundingRate: 0.0003 });
    expect(rows[0].ingestedAt).toBe(base + 1);
    expect(await store.load("bybit", "BTCUSDT", "linear", "account_ratio")).toHaveLength(1);
  });

  it("isolates provider, symbol and contract category", async () => {
    const store = new DerivativesObservationStore(memoryIndexedDb());
    await store.save([funding[0]]);
    await store.save([{ ...funding[0], provider: "other" }]);
    await store.save([{ ...funding[0], symbol: "ETHUSDT" }]);
    await store.save([{
      metric: "funding_rate", provider: "bybit", symbol: "BTCUSD", category: "inverse",
      timestamp: base, fundingRate: 0.0001, unit: "rate_per_settlement",
    }]);
    expect(await store.load("bybit", "BTCUSDT", "linear", "funding_rate")).toHaveLength(1);
    expect(await store.load("other", "BTCUSDT", "linear", "funding_rate")).toHaveLength(1);
    expect(await store.load("bybit", "BTCUSD", "inverse", "funding_rate")).toHaveLength(1);
  });

  it("filters inclusive timestamp ranges and prunes old observations", async () => {
    const store = new DerivativesObservationStore(memoryIndexedDb());
    await store.save(funding);
    expect(await store.load("bybit", "BTCUSDT", "linear", "funding_rate", {
      startTime: funding[1].timestamp, endTime: funding[1].timestamp,
    })).toHaveLength(1);
    expect(await store.pruneBefore("bybit", "BTCUSDT", "linear", "funding_rate", funding[1].timestamp)).toBe(1);
    expect((await store.load("bybit", "BTCUSDT", "linear", "funding_rate")).map((row) => row.observation)).toEqual([funding[1]]);
  });

  it("rejects invalid records, ingestion timestamps and query ranges", async () => {
    const store = new DerivativesObservationStore(memoryIndexedDb());
    await expect(store.save([{ ...funding[0], fundingRate: Number.NaN }])).rejects.toThrow(/fundingRate/);
    await expect(store.save(funding, -1)).rejects.toThrow(/ingestedAt/);
    await expect(store.load("bybit", "BTCUSDT", "linear", "funding_rate", {
      startTime: base + 100, endTime: base,
    })).rejects.toThrow(/startTime/);
    await expect(store.pruneBefore("bybit", "BTCUSDT", "linear", "funding_rate", -1)).rejects.toThrow(/cutoff/);
  });
});
