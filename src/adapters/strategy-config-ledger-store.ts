import {
  approveStrategyConfigProposal,
  assessStrategyConfigProposal,
  type ApprovedStrategyConfigVersion,
  type StrategyConfigApproval,
  type StrategyConfigProposal,
} from "../domain/strategy-config-governance";
import { STRATEGY_CONFIG_LEDGER_STORE, openNexusDatabase } from "./nexus-database";

export type StrategyConfigLedgerEntry =
  | { id: string; createdAt: number; status: "pending"; proposal: StrategyConfigProposal }
  | { id: string; createdAt: number; status: "approved"; version: ApprovedStrategyConfigVersion };

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

/** Local append-only proposal/version ledger. No record changes an active strategy automatically. */
export class StrategyConfigLedgerStore {
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

  async saveProposal(proposal: StrategyConfigProposal): Promise<void> {
    const assessment = assessStrategyConfigProposal(proposal);
    if (!assessment.valid) throw new Error("Strategy config proposal rejected: " + assessment.reasons.join("; "));
    const record: StrategyConfigLedgerEntry = {
      id: "proposal:" + proposal.id,
      createdAt: proposal.createdAt,
      status: "pending",
      proposal: structuredClone(proposal),
    };
    await this.add(record);
  }

  async approveProposal(
    proposal: StrategyConfigProposal,
    approval: StrategyConfigApproval,
  ): Promise<ApprovedStrategyConfigVersion> {
    const pending = await this.list(500);
    if (!pending.some((entry) => entry.status === "pending" && entry.proposal.id === proposal.id)) {
      throw new Error("A saved pending proposal is required before approval");
    }
    const version = approveStrategyConfigProposal(proposal, approval);
    const record: StrategyConfigLedgerEntry = {
      id: "version:" + version.id,
      createdAt: approval.approvedAt,
      status: "approved",
      version,
    };
    await this.add(record);
    return version;
  }

  private async add(record: StrategyConfigLedgerEntry): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_CONFIG_LEDGER_STORE, "readwrite");
    const done = transactionComplete(transaction);
    const request = requestResult(transaction.objectStore(STRATEGY_CONFIG_LEDGER_STORE).add(record));
    await Promise.all([request, done]);
  }

  async list(limit = 100): Promise<StrategyConfigLedgerEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer between 1 and 500");
    }
    const database = await this.openDatabase();
    const transaction = database.transaction(STRATEGY_CONFIG_LEDGER_STORE, "readonly");
    const done = transactionComplete(transaction);
    const request = requestResult(
      transaction.objectStore(STRATEGY_CONFIG_LEDGER_STORE).getAll() as IDBRequest<StrategyConfigLedgerEntry[]>,
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
