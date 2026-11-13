import { describe, expect, it } from "vitest";
import { CandleHistoryStore } from "./candle-history-store";
import type { Candle } from "../domain/candles";

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
const candles: Candle[] = [
  { timestamp: base, open: 100, high: 110, low: 90, close: 105, volume: 12 },
  { timestamp: base + 60_000, open: 105, high: 115, low: 100, close: 112, volume: 15 },
  { timestamp: base + 120_000, open: 112, high: 120, low: 110, close: 118, volume: 8 },
];

describe("CandleHistoryStore", () => {
  it("appends historical batches and returns a timestamp-ordered series", async () => {
    const store = new CandleHistoryStore(memoryIndexedDb());
    await store.save("BTCUSDT", "1m", "Binance", candles.slice(0, 2));
    await store.save("BTCUSDT", "1m", "Binance", candles.slice(2));
    expect(await store.load("BTCUSDT", "1m", "Binance")).toEqual(candles);
  });

  it("isolates symbols, intervals and providers", async () => {
    const store = new CandleHistoryStore(memoryIndexedDb());
    await store.save("BTCUSDT", "1m", "Binance", candles);
    await store.save("BTCUSDT", "1m", "Kraken", candles.slice(0, 1));
    await store.save("ETHUSDT", "1m", "Binance", candles.slice(0, 1));
    expect(await store.load("BTCUSDT", "1m", "Kraken")).toEqual(candles.slice(0, 1));
    expect(await store.load("ETHUSDT", "1m", "Binance")).toEqual(candles.slice(0, 1));
  });

  it("filters a stored series by inclusive time bounds", async () => {
    const store = new CandleHistoryStore(memoryIndexedDb());
    await store.save("BTCUSDT", "1m", "Binance", candles);
    expect(await store.load("BTCUSDT", "1m", "Binance", {
      startTime: base + 60_000, endTime: base + 60_000,
    })).toEqual(candles.slice(1, 2));
  });

  it("rejects invalid batches before persistence", async () => {
    const store = new CandleHistoryStore(memoryIndexedDb());
    const invalid = [candles[1], candles[0]];
    await expect(store.save("BTCUSDT", "1m", "Binance", invalid)).rejects.toThrow(/strictly increasing/i);
  });
});
