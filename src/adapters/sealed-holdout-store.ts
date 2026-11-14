import type { ResearchBatchResult } from "../domain/research-pipeline";
import type { SealedHoldoutSeal } from "../domain/sealed-holdout";
import { SEALED_HOLDOUT_STORE, openNexusDatabase } from "./nexus-database";

export interface StoredSealedHoldout {
  id: string;
  createdAt: number;
  status: "sealed" | "completed";
  seal: SealedHoldoutSeal;
  report?: ResearchBatchResult;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Holdout ledger request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Holdout ledger transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Holdout ledger transaction failed"));
  });
}

function overlaps(a: SealedHoldoutSeal, b: SealedHoldoutSeal): boolean {
  return a.identity.symbol === b.identity.symbol && a.identity.interval === b.identity.interval &&
    a.identity.startTimestamp <= b.identity.endTimestamp &&
    b.identity.startTimestamp <= a.identity.endTimestamp;
}

function validSeal(seal: SealedHoldoutSeal): boolean {
  return !!seal && seal.protocol === "NEXUS_FINAL_HOLDOUT_V1" &&
    !!seal.identity && typeof seal.identity.symbol === "string" && !!seal.identity.symbol &&
    typeof seal.identity.interval === "string" && !!seal.identity.interval &&
    Number.isSafeInteger(seal.identity.startTimestamp) && Number.isSafeInteger(seal.identity.endTimestamp) &&
    seal.identity.startTimestamp <= seal.identity.endTimestamp &&
    typeof seal.datasetFingerprint === "string" && !!seal.datasetFingerprint &&
    typeof seal.holdoutFingerprint === "string" && !!seal.holdoutFingerprint &&
    typeof seal.developmentFingerprint === "string" && !!seal.developmentFingerprint &&
    typeof seal.candidateFingerprint === "string" && !!seal.candidateFingerprint &&
    typeof seal.pipelineFingerprint === "string" && !!seal.pipelineFingerprint &&
    Array.isArray(seal.candidateIds) && seal.candidateIds.length > 0 &&
    Number.isSafeInteger(seal.developmentBars) && seal.developmentBars >= 100 &&
    Number.isSafeInteger(seal.embargoBars) && seal.embargoBars >= 1 &&
    Number.isSafeInteger(seal.holdoutBars) && seal.holdoutBars >= 20 &&
    Number.isFinite(seal.fraction) && seal.fraction >= 0.1 && seal.fraction <= 0.3;
}

/**
 * Device-local one-shot ledger. Overlapping final periods for the same
 * symbol/interval are rejected, even if strategy or execution assumptions
 * change. This is an operational guard, not tamper-proof security: clearing
 * browser storage or using another device can bypass it.
 */
export class SealedHoldoutStore {
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

  async reserve(seal: SealedHoldoutSeal, createdAt = Date.now()): Promise<StoredSealedHoldout> {
    if (!validSeal(seal)) throw new TypeError("A complete sealed holdout manifest is required");
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new RangeError("createdAt must be a non-negative safe integer");
    const database = await this.openDatabase();
    const transaction = database.transaction(SEALED_HOLDOUT_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(SEALED_HOLDOUT_STORE);
    const existing = await requestResult(store.getAll() as IDBRequest<StoredSealedHoldout[]>);
    if (existing.some((record) => overlaps(record.seal, seal))) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new Error("This symbol/interval holdout period overlaps a previously sealed evaluation. Do not reuse final holdout data.");
    }
    const record: StoredSealedHoldout = {
      id: seal.identity.symbol + "-" + seal.identity.interval + "-" +
        seal.identity.startTimestamp + "-" + seal.identity.endTimestamp,
      createdAt,
      status: "sealed",
      seal: structuredClone(seal),
    };
    store.add(record);
    await done;
    return structuredClone(record);
  }

  async complete(id: string, report: ResearchBatchResult): Promise<StoredSealedHoldout> {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A sealed holdout ID is required");
    if (!report || !report.dataset || !Array.isArray(report.candidateResults)) {
      throw new TypeError("A complete final holdout report is required");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(SEALED_HOLDOUT_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(SEALED_HOLDOUT_STORE);
    const current = await requestResult(store.get(id) as IDBRequest<StoredSealedHoldout | undefined>);
    if (!current || current.status !== "sealed") {
      transaction.abort();
      await done.catch(() => undefined);
      throw new Error("Only an existing incomplete seal can be completed");
    }
    if (report.dataset.fingerprint !== current.seal.datasetFingerprint ||
        report.candidateResults.length !== current.seal.candidateIds.length ||
        report.candidateResults.some((item, index) => item.id !== current.seal.candidateIds[index])) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new Error("Final report does not match the sealed dataset and candidate manifest");
    }
    const completed: StoredSealedHoldout = { ...current, status: "completed", report: structuredClone(report) };
    store.put(completed);
    await done;
    return structuredClone(completed);
  }

  async list(limit = 50): Promise<StoredSealedHoldout[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limit must be between 1 and 200");
    const database = await this.openDatabase();
    const transaction = database.transaction(SEALED_HOLDOUT_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(transaction.objectStore(SEALED_HOLDOUT_STORE).getAll() as IDBRequest<StoredSealedHoldout[]>);
    const [records] = await Promise.all([request, done]);
    return records.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((record) => structuredClone(record));
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
