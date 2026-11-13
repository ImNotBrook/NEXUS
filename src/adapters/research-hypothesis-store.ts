import type { ResearchHypothesis } from "../domain/research-agent";
import { RESEARCH_HYPOTHESIS_STORE, openNexusDatabase } from "./nexus-database";

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

/** Append-only local hypothesis ledger. It never runs or promotes a strategy. */
export class ResearchHypothesisStore {
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

  async save(hypothesis: ResearchHypothesis): Promise<void> {
    if (!hypothesis || hypothesis.status !== "draft" ||
        !hypothesis.protocol || hypothesis.protocol.automaticPromotion !== false ||
        !Array.isArray(hypothesis.sourceEvidence) || hypothesis.sourceEvidence.length === 0) {
      throw new TypeError("A valid draft research hypothesis is required");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(RESEARCH_HYPOTHESIS_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const request = requestResult(transaction.objectStore(RESEARCH_HYPOTHESIS_STORE).add(
      structuredClone(hypothesis),
    ));
    await Promise.all([request, done]);
  }

  async list(limit = 100): Promise<ResearchHypothesis[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer between 1 and 500");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(RESEARCH_HYPOTHESIS_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(RESEARCH_HYPOTHESIS_STORE).getAll() as IDBRequest<ResearchHypothesis[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, limit);
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
