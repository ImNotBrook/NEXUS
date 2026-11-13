import { validateCandles, type Candle } from "../domain/candles";
import { HISTORICAL_CANDLE_STORE, openNexusDatabase } from "./nexus-database";

interface StoredCandle {
  key: string;
  series: string;
  timestamp: number;
  candle: Candle;
}

export interface CandleHistoryRange {
  startTime?: number;
  endTime?: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

/** Device-local OHLCV history, partitioned by symbol, interval and provider. */
export class CandleHistoryStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = openNexusDatabase(this.factory).catch((error: unknown) => {
      this.databasePromise = null;
      throw error;
    });
    return this.databasePromise;
  }

  async save(symbol: string, interval: string, provider: string, input: readonly Candle[]): Promise<void> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const normalizedInterval = interval.trim();
    const normalizedProvider = provider.trim();
    if (!normalizedSymbol || !normalizedInterval || !normalizedProvider) {
      throw new TypeError("symbol, interval and provider are required");
    }
    const candles = validateCandles(input);
    const series = [normalizedSymbol, normalizedInterval, normalizedProvider].join("|");
    const database = await this.openDatabase();
    const transaction = database.transaction(HISTORICAL_CANDLE_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(HISTORICAL_CANDLE_STORE);
    for (const candle of candles) {
      const timestampKey = String(candle.timestamp).padStart(16, "0");
      store.put({
        key: series + "|" + timestampKey,
        series,
        timestamp: candle.timestamp,
        candle,
      } satisfies StoredCandle);
    }
    await done;
  }

  async load(
    symbol: string,
    interval: string,
    provider: string,
    range: CandleHistoryRange = {},
  ): Promise<Candle[]> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const normalizedInterval = interval.trim();
    const normalizedProvider = provider.trim();
    if (!normalizedSymbol || !normalizedInterval || !normalizedProvider) {
      throw new TypeError("symbol, interval and provider are required");
    }
    for (const [field, value] of Object.entries(range)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError(field + " must be a non-negative safe integer");
      }
    }
    if (range.startTime !== undefined && range.endTime !== undefined && range.startTime > range.endTime) {
      throw new RangeError("startTime must be less than or equal to endTime");
    }

    const series = [normalizedSymbol, normalizedInterval, normalizedProvider].join("|");
    const database = await this.openDatabase();
    const transaction = database.transaction(HISTORICAL_CANDLE_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(HISTORICAL_CANDLE_STORE).index("series").getAll(series) as IDBRequest<StoredCandle[]>,
    );
    const [records] = await Promise.all([request, done]);
    const selected = records
      .filter((record) =>
        (range.startTime === undefined || record.timestamp >= range.startTime) &&
        (range.endTime === undefined || record.timestamp <= range.endTime),
      )
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((record) => record.candle);
    return validateCandles(selected);
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
