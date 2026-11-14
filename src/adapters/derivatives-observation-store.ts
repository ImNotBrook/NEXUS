import {
  validateDerivativesObservations,
  type DerivativesCategory,
  type DerivativesMetric,
  type DerivativesObservation,
} from "../domain/derivatives-data";
import { DERIVATIVES_OBSERVATION_STORE, openNexusDatabase } from "./nexus-database";

export interface DerivativesHistoryRange {
  startTime?: number;
  endTime?: number;
}

export interface StoredDerivativesObservation {
  observation: DerivativesObservation;
  ingestedAt: number;
}

interface StoredRecord extends StoredDerivativesObservation {
  key: string;
  series: string;
  timestamp: number;
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

function normalizedSeries(provider: string, symbol: string, category: DerivativesCategory, metric: DerivativesMetric): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedProvider || !/^[A-Z0-9]{3,30}$/.test(normalizedSymbol)) {
    throw new TypeError("provider and normalized symbol are required");
  }
  if (category !== "linear" && category !== "inverse") throw new TypeError("category is invalid");
  if (!["funding_rate", "open_interest", "account_ratio"].includes(metric)) {
    throw new TypeError("metric is invalid");
  }
  return [normalizedProvider, normalizedSymbol, category, metric].join("|");
}

/** Device-local derivatives history. Every provider/market/metric remains isolated. */
export class DerivativesObservationStore {
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

  async save(input: readonly DerivativesObservation[], ingestedAt = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(ingestedAt) || ingestedAt < 0) {
      throw new RangeError("ingestedAt must be a non-negative safe integer timestamp");
    }
    const observations = validateDerivativesObservations(input);
    if (observations.length === 0) return;
    const database = await this.openDatabase();
    const transaction = database.transaction(DERIVATIVES_OBSERVATION_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(DERIVATIVES_OBSERVATION_STORE);
    for (const observation of observations) {
      const series = normalizedSeries(observation.provider, observation.symbol, observation.category, observation.metric);
      const timestampKey = String(observation.timestamp).padStart(16, "0");
      store.put({
        key: series + "|" + timestampKey,
        series,
        timestamp: observation.timestamp,
        observation,
        ingestedAt,
      } satisfies StoredRecord);
    }
    await done;
  }

  async load(
    provider: string,
    symbol: string,
    category: DerivativesCategory,
    metric: DerivativesMetric,
    range: DerivativesHistoryRange = {},
  ): Promise<StoredDerivativesObservation[]> {
    const series = normalizedSeries(provider, symbol, category, metric);
    for (const [field, value] of Object.entries(range)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError(field + " must be a non-negative safe integer");
      }
    }
    if (range.startTime !== undefined && range.endTime !== undefined && range.startTime > range.endTime) {
      throw new RangeError("startTime must be less than or equal to endTime");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(DERIVATIVES_OBSERVATION_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(DERIVATIVES_OBSERVATION_STORE).index("series").getAll(series) as IDBRequest<StoredRecord[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records
      .filter((record) =>
        (range.startTime === undefined || record.timestamp >= range.startTime) &&
        (range.endTime === undefined || record.timestamp <= range.endTime),
      )
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(({ observation, ingestedAt }) => ({ observation, ingestedAt }));
  }

  async pruneBefore(
    provider: string,
    symbol: string,
    category: DerivativesCategory,
    metric: DerivativesMetric,
    cutoff: number,
  ): Promise<number> {
    if (!Number.isSafeInteger(cutoff) || cutoff < 0) {
      throw new RangeError("cutoff must be a non-negative safe integer timestamp");
    }
    const series = normalizedSeries(provider, symbol, category, metric);
    const database = await this.openDatabase();
    const transaction = database.transaction(DERIVATIVES_OBSERVATION_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(DERIVATIVES_OBSERVATION_STORE);
    const recordsRequest = store.index("series").getAll(series) as IDBRequest<StoredRecord[]>;
    let removed = 0;
    recordsRequest.onsuccess = () => {
      for (const record of recordsRequest.result) {
        if (record.timestamp < cutoff) {
          store.delete(record.key);
          removed += 1;
        }
      }
    };
    recordsRequest.onerror = () => {
      // The transaction error/abort handler below rejects the operation.
    };
    await done;
    return removed;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
