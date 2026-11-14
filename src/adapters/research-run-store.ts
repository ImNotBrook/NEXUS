import type { ResearchBatchResult } from "../domain/research-pipeline";
import { RESEARCH_RUN_STORE, openNexusDatabase } from "./nexus-database";
import type { ExecutionStressFamilyMetadata } from "../domain/execution-stress-leaderboard";
import type { StrategyTrialManifest } from "../domain/strategy-studio";

export interface StoredResearchRun {
  id: string;
  createdAt: number;
  report: ResearchBatchResult;
  /** Present only when this report is one persisted scenario in an execution-stress family. */
  stressFamily?: ExecutionStressFamilyMetadata;
  /** Exact parameter-trial manifest used to produce this report, when applicable. */
  strategyTrials?: StrategyTrialManifest;
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

function isValidReport(report: ResearchBatchResult): boolean {
  return !!report && typeof report === "object" &&
    !!report.dataset && Number.isSafeInteger(report.dataset.candleCount) && report.dataset.candleCount > 0 &&
    Number.isSafeInteger(report.dataset.firstTimestamp) &&
    Number.isSafeInteger(report.dataset.lastTimestamp) &&
    typeof report.dataset.fingerprint === "string" && report.dataset.fingerprint.length > 0 &&
    !!report.config && Array.isArray(report.candidateResults);
}

let sequence = 0;

/** Device-local, auditable research history. Records never leave this browser. */
export class ResearchRunStore {
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

  async save(report: ResearchBatchResult, createdAt = Date.now(), stressFamily?: ExecutionStressFamilyMetadata, strategyTrials?: StrategyTrialManifest): Promise<StoredResearchRun> {
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new RangeError("createdAt must be a non-negative safe integer");
    }
    if (!isValidReport(report)) throw new TypeError("A complete research report is required");
    const id = createdAt + "-" + report.dataset.fingerprint + "-" + (++sequence);
    if (stressFamily && (stressFamily.version !== 1 ||
        typeof stressFamily.familyId !== "string" || !stressFamily.familyId.trim() ||
        typeof stressFamily.scenarioId !== "string" || !stressFamily.scenarioId.trim() ||
        typeof stressFamily.label !== "string" || !stressFamily.label.trim() ||
        !Number.isSafeInteger(stressFamily.scenarioIndex) || stressFamily.scenarioIndex < 0 ||
        !Number.isSafeInteger(stressFamily.scenarioCount) || stressFamily.scenarioCount < 1 ||
        stressFamily.scenarioCount > 8 || stressFamily.scenarioIndex >= stressFamily.scenarioCount ||
        !Array.isArray(stressFamily.expectedScenarioIds) ||
        stressFamily.expectedScenarioIds.length !== stressFamily.scenarioCount ||
        !stressFamily.expectedScenarioIds.every((id) => typeof id === "string" && !!id.trim()) ||
        stressFamily.expectedScenarioIds[stressFamily.scenarioIndex] !== stressFamily.scenarioId ||
        new Set(stressFamily.expectedScenarioIds).size !== stressFamily.expectedScenarioIds.length ||
        !Number.isFinite(stressFamily.costMultiplier) || stressFamily.costMultiplier < 1 ||
        !Number.isFinite(stressFamily.participationMultiplier) || stressFamily.participationMultiplier <= 0 ||
        stressFamily.participationMultiplier > 1)) {
      throw new TypeError("Valid execution stress family metadata is required");
    }
    if (strategyTrials && (
        strategyTrials.generatorVersion !== "1.0.0" ||
        typeof strategyTrials.baseStrategyId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(strategyTrials.baseStrategyId) ||
        typeof strategyTrials.baseVersion !== "string" || !/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.test(strategyTrials.baseVersion) ||
        !Number.isSafeInteger(strategyTrials.trialCount) || strategyTrials.trialCount < 1 || strategyTrials.trialCount > 25 ||
        !Array.isArray(strategyTrials.trialIds) || strategyTrials.trialIds.length !== strategyTrials.trialCount ||
        strategyTrials.trialIds.some((id) => typeof id !== "string" || !id.trim()) ||
        new Set(strategyTrials.trialIds).size !== strategyTrials.trialIds.length ||
        !strategyTrials.parameterGrid || typeof strategyTrials.parameterGrid !== "object" ||
        Object.keys(strategyTrials.parameterGrid).length === 0 ||
        Object.values(strategyTrials.parameterGrid).some((values) =>
          !Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value)) ||
          new Set(values).size !== values.length) ||
        Object.values(strategyTrials.parameterGrid).reduce((count, values) => count * values.length, 1) !== strategyTrials.trialCount ||
        typeof strategyTrials.selectionBiasWarning !== "string" || !strategyTrials.selectionBiasWarning.trim()
      )) {
      throw new TypeError("A valid strategy trial manifest is required");
    }
    const record: StoredResearchRun = {
      id, createdAt, report: structuredClone(report),
      ...(stressFamily ? { stressFamily: structuredClone(stressFamily) } : {}),
      ...(strategyTrials ? { strategyTrials: structuredClone(strategyTrials) } : {}),
    };
    const database = await this.openDatabase();
    const transaction = database.transaction(RESEARCH_RUN_STORE, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(RESEARCH_RUN_STORE).put(record);
    await done;
    return record;
  }

  async list(limit = 50): Promise<StoredResearchRun[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new RangeError("limit must be an integer between 1 and 200");
    }
    const records = await this.listAll();
    return records.slice(0, limit);
  }

  /** Returns every locally saved research run, newest first, for complete leaderboard aggregation. */
  async listAll(): Promise<StoredResearchRun[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(RESEARCH_RUN_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(RESEARCH_RUN_STORE).getAll() as IDBRequest<StoredResearchRun[]>,
    );
    const [records] = await Promise.all([request, done]);
    return records.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  async delete(id: string): Promise<void> {
    if (typeof id !== "string" || id.trim().length === 0) throw new TypeError("A research run ID is required");
    const database = await this.openDatabase();
    const transaction = database.transaction(RESEARCH_RUN_STORE, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(RESEARCH_RUN_STORE).delete(id);
    await done;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
