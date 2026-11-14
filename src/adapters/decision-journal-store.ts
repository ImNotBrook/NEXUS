import {
  validateDecisionJournalEvent,
  validateDecisionJournalRecord,
  type DecisionJournalEvent,
  type DecisionJournalRecord,
} from "../domain/decision-journal";
import {
  DECISION_JOURNAL_EVENT_STORE,
  DECISION_JOURNAL_STORE,
  openNexusDatabase,
} from "./nexus-database";

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

/**
 * Append-only local journal. Records use IDBObjectStore.add (never put), and
 * this API deliberately exposes no update or delete operation.
 */
export class DecisionJournalStore {
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

  async append(record: DecisionJournalRecord): Promise<DecisionJournalRecord> {
    validateDecisionJournalRecord(record);
    const snapshot = structuredClone(record);
    const database = await this.openDatabase();
    const transaction = database.transaction(DECISION_JOURNAL_STORE, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(DECISION_JOURNAL_STORE).add(snapshot);
    await done;
    return structuredClone(snapshot);
  }

  async get(decisionId: string): Promise<DecisionJournalRecord | null> {
    if (typeof decisionId !== "string" || !decisionId.trim()) throw new TypeError("A decision ID is required");
    const database = await this.openDatabase();
    const transaction = database.transaction(DECISION_JOURNAL_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(DECISION_JOURNAL_STORE).get(decisionId) as IDBRequest<DecisionJournalRecord | undefined>,
    );
    const [record] = await Promise.all([request, done]);
    return record ? structuredClone(record) : null;
  }

  async list(limit = 100): Promise<DecisionJournalRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer between 1 and 500");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(DECISION_JOURNAL_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(DECISION_JOURNAL_STORE).getAll() as IDBRequest<DecisionJournalRecord[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records
      .sort((a, b) => b.decisionAt - a.decisionAt || b.decisionId.localeCompare(a.decisionId))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent> {
    validateDecisionJournalEvent(event);
    const snapshot = structuredClone(event);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [DECISION_JOURNAL_STORE, DECISION_JOURNAL_EVENT_STORE],
      "readwrite",
    );
    const done = transactionComplete(transaction);
    let missingDecision = false;
    let eventPredatesDecision = false;
    const parentRequest = transaction.objectStore(DECISION_JOURNAL_STORE).get(event.decisionId);
    parentRequest.onsuccess = () => {
      if (!parentRequest.result) {
        missingDecision = true;
        transaction.abort();
        return;
      }
      if (snapshot.occurredAt < parentRequest.result.decisionAt) {
        eventPredatesDecision = true;
        transaction.abort();
        return;
      }
      transaction.objectStore(DECISION_JOURNAL_EVENT_STORE).add(snapshot);
    };
    try {
      await done;
    } catch (error) {
      if (missingDecision) throw new Error("Cannot append an event for a missing decision");
      if (eventPredatesDecision) throw new Error("Event timestamp cannot precede its decision");
      throw error;
    }
    return structuredClone(snapshot);
  }

  async listEvents(decisionId: string): Promise<DecisionJournalEvent[]> {
    if (typeof decisionId !== "string" || !decisionId.trim()) throw new TypeError("A decision ID is required");
    const database = await this.openDatabase();
    const transaction = database.transaction(DECISION_JOURNAL_EVENT_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(DECISION_JOURNAL_EVENT_STORE)
        .index("decisionId")
        .getAll(decisionId) as IDBRequest<DecisionJournalEvent[]>,
    );
    const [events] = await Promise.all([request, done]);
    return events
      .sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId))
      .map((event) => structuredClone(event));
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
