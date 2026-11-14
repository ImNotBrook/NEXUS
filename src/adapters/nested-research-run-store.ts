import type { NestedWalkForwardConfig, NestedWalkForwardResult } from "../domain/nested-walk-forward-selection";
import { NESTED_RESEARCH_RUN_STORE, openNexusDatabase } from "./nexus-database";

export interface NestedResearchMetadata {
  symbol: string;
  interval: string;
  provider: string;
}

export interface StoredNestedResearchRun {
  id: string;
  createdAt: number;
  metadata: NestedResearchMetadata;
  config: NestedWalkForwardConfig;
  report: NestedWalkForwardResult;
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

function isValidMetadata(metadata: NestedResearchMetadata): boolean {
  return !!metadata && typeof metadata.symbol === "string" && metadata.symbol.trim().length > 0 &&
    typeof metadata.interval === "string" && metadata.interval.trim().length > 0 &&
    typeof metadata.provider === "string" && metadata.provider.trim().length > 0;
}

function isValidConfig(config: NestedWalkForwardConfig): boolean {
  const validFolds = (folds: NestedWalkForwardConfig["outerFolds"]): boolean =>
    !!folds && Number.isSafeInteger(folds.trainBars) && folds.trainBars > 0 &&
    Number.isSafeInteger(folds.testBars) && folds.testBars > 0 &&
    Number.isSafeInteger(folds.stepBars) && folds.stepBars > 0 &&
    Number.isSafeInteger(folds.embargoBars ?? 0) && (folds.embargoBars ?? 0) >= 0;
  return !!config && validFolds(config.outerFolds) && validFolds(config.innerFolds) &&
    !!config.grid && Array.isArray(config.grid.stopLossValuesPct) &&
    Array.isArray(config.grid.takeProfitValuesPct) &&
    (config.minimumInnerTrades === undefined ||
      (Number.isSafeInteger(config.minimumInnerTrades) && config.minimumInnerTrades >= 0));
}

function isValidReport(report: NestedWalkForwardResult): boolean {
  return !!report && typeof report.datasetFingerprint === "string" && report.datasetFingerprint.length > 0 &&
    Number.isSafeInteger(report.outerFoldCount) && report.outerFoldCount > 0 &&
    Array.isArray(report.candidateResults) && report.candidateResults.every((candidate) =>
      typeof candidate.id === "string" && typeof candidate.name === "string" &&
      Array.isArray(candidate.folds) && Array.isArray(candidate.parameterStability));
}

let sequence = 0;

/** Device-local persistence for nested reports; separate from ordinary research batches. */
export class NestedResearchRunStore {
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

  async save(
    report: NestedWalkForwardResult,
    metadata: NestedResearchMetadata,
    config: NestedWalkForwardConfig,
    createdAt = Date.now(),
  ): Promise<StoredNestedResearchRun> {
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new RangeError("createdAt must be a non-negative safe integer");
    }
    if (!isValidReport(report)) throw new TypeError("A complete nested research report is required");
    if (!isValidMetadata(metadata)) throw new TypeError("Complete market data metadata is required");
    if (!isValidConfig(config)) throw new TypeError("A valid nested walk-forward configuration is required");
    const id = createdAt + "-" + report.datasetFingerprint + "-" + (++sequence);
    const record: StoredNestedResearchRun = {
      id,
      createdAt,
      metadata: structuredClone(metadata),
      config: structuredClone(config),
      report: structuredClone(report),
    };
    const database = await this.openDatabase();
    const transaction = database.transaction(NESTED_RESEARCH_RUN_STORE, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(NESTED_RESEARCH_RUN_STORE).put(record);
    await done;
    return structuredClone(record);
  }

  async list(limit = 50): Promise<StoredNestedResearchRun[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new RangeError("limit must be an integer between 1 and 200");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(NESTED_RESEARCH_RUN_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(NESTED_RESEARCH_RUN_STORE).getAll() as IDBRequest<StoredNestedResearchRun[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async delete(id: string): Promise<void> {
    if (typeof id !== "string" || id.trim().length === 0) throw new TypeError("A nested research run ID is required");
    const database = await this.openDatabase();
    const transaction = database.transaction(NESTED_RESEARCH_RUN_STORE, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(NESTED_RESEARCH_RUN_STORE).delete(id);
    await done;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
