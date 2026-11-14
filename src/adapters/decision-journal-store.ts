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

  async exportAll(): Promise<{ records: DecisionJournalRecord[]; events: DecisionJournalEvent[] }> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [DECISION_JOURNAL_STORE, DECISION_JOURNAL_EVENT_STORE],
      "readonly",
    );
    const done = transactionComplete(transaction);
    const recordsRequest = requestResult(
      transaction.objectStore(DECISION_JOURNAL_STORE).getAll() as IDBRequest<DecisionJournalRecord[]>,
    );
    const eventsRequest = requestResult(
      transaction.objectStore(DECISION_JOURNAL_EVENT_STORE).getAll() as IDBRequest<DecisionJournalEvent[]>,
    );
    const [records, events] = await Promise.all([recordsRequest, eventsRequest, done]).then(
      ([recordRows, eventRows]) => [recordRows, eventRows] as const,
    );
    return {
      records: records.map((record) => structuredClone(record)),
      events: events.map((event) => structuredClone(event)),
    };
  }

  /**
   * Imports a complete journal snapshot in one IndexedDB transaction.
   * Existing IDs are accepted only when byte-for-byte equivalent; conflicting
   * IDs abort the entire restore. No existing record or event is overwritten.
   */
  async restoreAll(snapshot: {
    records: DecisionJournalRecord[];
    events: DecisionJournalEvent[];
  }): Promise<{ addedRecords: number; addedEvents: number; unchangedRecords: number; unchangedEvents: number }> {
    if (!snapshot || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.events)) {
      throw new TypeError("A complete decision journal backup is required");
    }
    const importedRecords = new Map<string, DecisionJournalRecord>();
    for (const record of snapshot.records) {
      validateDecisionJournalRecord(record);
      if (importedRecords.has(record.decisionId)) throw new Error("Backup contains duplicate decision IDs");
      importedRecords.set(record.decisionId, record);
    }
    const importedEvents = new Map<string, DecisionJournalEvent>();
    for (const event of snapshot.events) {
      validateDecisionJournalEvent(event);
      if (importedEvents.has(event.eventId)) throw new Error("Backup contains duplicate event IDs");
      importedEvents.set(event.eventId, event);
    }
    const existing = await this.exportAll();
    const existingRecords = new Map(existing.records.map((record) => [record.decisionId, record]));
    const existingEvents = new Map(existing.events.map((event) => [event.eventId, event]));
    const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
    let unchangedRecords = 0;
    let unchangedEvents = 0;
    for (const [id, record] of importedRecords) {
      const current = existingRecords.get(id);
      if (current && !equal(current, record)) throw new Error("Restore conflict: existing decision ID has different content: " + id);
      if (current) unchangedRecords += 1;
    }
    for (const [id, event] of importedEvents) {
      const current = existingEvents.get(id);
      if (current && !equal(current, event)) throw new Error("Restore conflict: existing event ID has different content: " + id);
      if (current) unchangedEvents += 1;
      const parent = importedRecords.get(event.decisionId) ?? existingRecords.get(event.decisionId);
      if (!parent) throw new Error("Backup event references a missing decision: " + event.eventId);
      if (event.occurredAt < parent.decisionAt) throw new Error("Backup event predates its decision: " + event.eventId);
    }
    const newRecords = [...importedRecords.values()].filter((record) => !existingRecords.has(record.decisionId));
    const newEvents = [...importedEvents.values()].filter((event) => !existingEvents.has(event.eventId));
    if (!newRecords.length && !newEvents.length) {
      return { addedRecords: 0, addedEvents: 0, unchangedRecords, unchangedEvents };
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [DECISION_JOURNAL_STORE, DECISION_JOURNAL_EVENT_STORE],
      "readwrite",
    );
    const done = transactionComplete(transaction);
    const decisionStore = transaction.objectStore(DECISION_JOURNAL_STORE);
    const eventStore = transaction.objectStore(DECISION_JOURNAL_EVENT_STORE);
    for (const record of newRecords) decisionStore.add(structuredClone(record));
    for (const event of newEvents) eventStore.add(structuredClone(event));
    await done;
    return {
      addedRecords: newRecords.length,
      addedEvents: newEvents.length,
      unchangedRecords,
      unchangedEvents,
    };
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
