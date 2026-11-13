import { describe, expect, it } from "vitest";
import { StrategyConfigLedgerStore } from "./strategy-config-ledger-store";
import type { StrategyConfigProposal } from "../domain/strategy-config-governance";

function memoryIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      const records = new Map<string, unknown>();
      stores.set(name, records);
      return { createIndex: () => undefined };
    },
    transaction: (name: string) => {
      const records = stores.get(name);
      if (!records) throw new Error("Missing object store");
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        add: (record: { id: string }) => {
          if (records.has(record.id)) throw new Error("ConstraintError");
          records.set(record.id, structuredClone(record));
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = record.id;
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        put: (record: { id: string }) => {
          records.set(record.id, structuredClone(record));
          queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
        },
        getAll: () => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = [...records.values()].map((record) => structuredClone(record));
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
      });
      return transaction;
    },
    close: () => undefined,
  };
  return {
    open: () => {
      const request: Record<string, unknown> = { result: database };
      queueMicrotask(() => {
        (request.onupgradeneeded as (() => void) | undefined)?.();
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
}

const proposal: StrategyConfigProposal = {
  id: "proposal-001", strategyId: "sma", baseVersion: "1.0.0", proposedVersion: "1.1.0",
  parameters: { fastPeriod: 12, slowPeriod: 36 }, rationale: "Improved median fold return",
  evidence: [{ source: "run:abc", note: "Same dataset and costs" }],
  evaluation: { metric: "median-fold-return", baselineScore: 1, candidateScore: 2, testsPassed: true, regressionCount: 0 },
  createdAt: 1000,
};

describe("StrategyConfigLedgerStore", () => {
  it("stores a pending proposal and separately records a human-approved immutable version", async () => {
    const store = new StrategyConfigLedgerStore(memoryIndexedDb());
    await store.saveProposal(proposal);
    const approved = await store.approveProposal(proposal, {
      approvedBy: "owner", rationale: "Reviewed experiment evidence.", approvedAt: 1001,
    });
    const records = await store.list();
    expect(records.map((record) => record.status)).toEqual(["approved", "pending"]);
    expect(approved.approval.approvedBy).toBe("owner");
  });

  it("rejects invalid proposals and cannot approve without human attribution", async () => {
    const store = new StrategyConfigLedgerStore(memoryIndexedDb());
    await expect(store.saveProposal({ ...proposal, evidence: [] })).rejects.toThrow();
    await expect(store.approveProposal(proposal, {
      approvedBy: "owner", rationale: "Not yet persisted.", approvedAt: 1001,
    })).rejects.toThrow(/saved pending proposal/i);
    await store.saveProposal(proposal);
    await expect(store.approveProposal(proposal, {
      approvedBy: "", rationale: "", approvedAt: 1001,
    })).rejects.toThrow(/human approval/i);
  });
});
