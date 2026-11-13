export const NEXUS_DATABASE_NAME = "nexus-local";
export const NEXUS_DATABASE_VERSION = 7;
export const PAPER_ACCOUNT_STORE = "paperAccounts";
export const MARKET_SNAPSHOT_STORE = "marketSnapshots";
export const HISTORICAL_CANDLE_STORE = "historicalCandles";
export const RESEARCH_RUN_STORE = "researchRuns";
export const STRATEGY_CONFIG_LEDGER_STORE = "strategyConfigLedger";
export const RESEARCH_HYPOTHESIS_STORE = "researchHypotheses";
export const SKILL_REGISTRY_STORE = "skillRegistry";

/**
 * One schema owner for every local adapter. A single versioned upgrade creates
 * all stores, preventing adapters from opening incompatible DB versions.
 */
export function openNexusDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(NEXUS_DATABASE_NAME, NEXUS_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PAPER_ACCOUNT_STORE)) {
        database.createObjectStore(PAPER_ACCOUNT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(MARKET_SNAPSHOT_STORE)) {
        database.createObjectStore(MARKET_SNAPSHOT_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(SKILL_REGISTRY_STORE)) {
        const skillStore = database.createObjectStore(SKILL_REGISTRY_STORE, { keyPath: "id" });
        skillStore.createIndex("discoveredAt", "discoveredAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(RESEARCH_HYPOTHESIS_STORE)) {
        const hypothesisStore = database.createObjectStore(RESEARCH_HYPOTHESIS_STORE, { keyPath: "id" });
        hypothesisStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(STRATEGY_CONFIG_LEDGER_STORE)) {
        const ledgerStore = database.createObjectStore(STRATEGY_CONFIG_LEDGER_STORE, { keyPath: "id" });
        ledgerStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(RESEARCH_RUN_STORE)) {
        const researchStore = database.createObjectStore(RESEARCH_RUN_STORE, { keyPath: "id" });
        researchStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(HISTORICAL_CANDLE_STORE)) {
        const historyStore = database.createObjectStore(HISTORICAL_CANDLE_STORE, { keyPath: "key" });
        historyStore.createIndex("series", "series", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open NEXUS local database"));
    request.onblocked = () => reject(new Error("NEXUS database upgrade is blocked by another open tab"));
  });
}
