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

  /** Exports every immutable strategy version, not just the visible recent list. */
  async exportAll(): Promise<StoredStrategyDefinition[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_LIBRARY_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(STRATEGY_LIBRARY_STORE).getAll() as IDBRequest<StoredStrategyDefinition[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((record) => structuredClone(record));
  }

  private validateBackupRecords(snapshot: unknown): Map<string, StoredStrategyDefinition> {
    if (!Array.isArray(snapshot)) throw new TypeError("Strategy backup must contain a record array");
    const records = new Map<string, StoredStrategyDefinition>();
    for (const input of snapshot) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Strategy backup contains an invalid record");
      }
      const record = input as StoredStrategyDefinition;
      const assessment = validateStrategyDefinition(record.definition);
      if (!assessment.valid) throw new TypeError("Strategy backup contains an invalid definition: " + assessment.reasons.join("; "));
      const expectedId = record.definition.id + "@" + record.definition.version;
      if (record.id !== expectedId || record.createdAt !== record.definition.createdAt ||
          !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
        throw new TypeError("Strategy backup record identity or timestamp is invalid");
      }
      if (records.has(record.id)) throw new Error("Strategy backup contains duplicate versions: " + record.id);
      records.set(record.id, {
        id: record.id,
        createdAt: record.createdAt,
        definition: structuredClone(createStrategyDefinition(record.definition)),
      });
    }
    return records;
  }

  /** Read-only preview; identical versions are safe, conflicting content blocks restore. */
  async previewRestore(snapshot: unknown): Promise<{ added: number; unchanged: number; conflicts: string[] }> {
    const imported = this.validateBackupRecords(snapshot);
    const existing = new Map((await this.exportAll()).map((record) => [record.id, record]));
    let unchanged = 0;
    const conflicts: string[] = [];
    for (const [id, record] of imported) {
      const current = existing.get(id);
      if (!current) continue;
      if (JSON.stringify(current) !== JSON.stringify(record)) conflicts.push("Strategy version has different content: " + id);
      else unchanged += 1;
    }
    return { added: imported.size - unchanged - conflicts.length, unchanged, conflicts };
  }

  /** Imports missing immutable versions in one transaction; never overwrites existing content. */
  async restoreAll(snapshot: unknown): Promise<{ added: number; unchanged: number }> {
    const imported = this.validateBackupRecords(snapshot);
    const existing = new Map((await this.exportAll()).map((record) => [record.id, record]));
    let unchanged = 0;
    const additions: StoredStrategyDefinition[] = [];
    for (const [id, record] of imported) {
      const current = existing.get(id);
      if (!current) additions.push(record);
      else if (JSON.stringify(current) !== JSON.stringify(record)) {
        throw new Error("Restore conflict: strategy version has different content: " + id);
      } else unchanged += 1;
    }
    if (!additions.length) return { added: 0, unchanged };
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_LIBRARY_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const requests = additions.map((record) =>
      requestResult(transaction.objectStore(STRATEGY_LIBRARY_STORE).add(structuredClone(record))),
    );
    await Promise.all([...requests, done]);
    return { added: additions.length, unchanged };
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
