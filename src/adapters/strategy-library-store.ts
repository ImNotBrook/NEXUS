import { createStrategyDefinition, validateStrategyDefinition, type StrategyDefinition } from "../domain/strategy-studio";
import { STRATEGY_LIBRARY_STORE, openNexusDatabase } from "./nexus-database";

export interface StoredStrategyDefinition {
  id: string;
  createdAt: number;
  definition: StrategyDefinition;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Strategy library request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Strategy library transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Strategy library transaction failed"));
  });
}

/** Device-local append-only library. A strategy version is never overwritten. */
export class StrategyLibraryStore {
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

  async save(input: StrategyDefinition): Promise<StoredStrategyDefinition> {
    const assessment = validateStrategyDefinition(input);
    if (!assessment.valid) {
      throw new TypeError("Invalid strategy definition: " + assessment.reasons.join("; "));
    }
    const definition = createStrategyDefinition(input);
    const record: StoredStrategyDefinition = {
      id: definition.id + "@" + definition.version,
      createdAt: definition.createdAt,
      definition: structuredClone(definition),
    };
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_LIBRARY_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const request = requestResult(transaction.objectStore(STRATEGY_LIBRARY_STORE).add(record));
    await Promise.all([request, done]);
    return structuredClone(record);
  }

  async list(limit = 100): Promise<StoredStrategyDefinition[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("Strategy library limit must be an integer between 1 and 500");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_LIBRARY_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(STRATEGY_LIBRARY_STORE).getAll() as IDBRequest<StoredStrategyDefinition[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
