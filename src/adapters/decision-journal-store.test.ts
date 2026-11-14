import { describe, expect, it } from "vitest";
import { DecisionJournalStore } from "./decision-journal-store";
import type { DecisionJournalRecord, DecisionJournalEvent } from "../domain/decision-journal";
import type { DecisionResult, EvidenceItem } from "../domain/decision-engine";

function memoryIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      stores.set(name, new Map());
      return { createIndex: () => undefined };
    },
    transaction: () => {
      const transaction: Record<string, unknown> = {};
      const objectStore = (name: string) => {
        const rows = stores.get(name);
        if (!rows) throw new Error("Missing object store");
        return {
          add: (value: Record<string, unknown>) => {
            transaction.hasPendingWrite = true;
            const keyPath = name === "decisionJournal" ? "decisionId" : "eventId";
            const key = String(value[keyPath]);
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              if (rows.has(key)) {
                request.error = new DOMException("Duplicate key", "ConstraintError");
                (request.onerror as (() => void) | undefined)?.();
                (transaction.onerror as (() => void) | undefined)?.();
                (transaction.onabort as (() => void) | undefined)?.();
                return;
              }
              rows.set(key, structuredClone(value));
              request.result = key;
              (request.onsuccess as (() => void) | undefined)?.();
              if (!aborted) (transaction.oncomplete as (() => void) | undefined)?.();
            });
            return request;
          },
          get: (key: string) => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              request.result = rows.get(key);
              (request.onsuccess as (() => void) | undefined)?.();
              if (!aborted && !transaction.hasPendingWrite) (transaction.oncomplete as (() => void) | undefined)?.();
            });
            return request;
          },
          getAll: () => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              request.result = [...rows.values()].map((value) => structuredClone(value));
              (request.onsuccess as (() => void) | undefined)?.();
              if (!aborted) (transaction.oncomplete as (() => void) | undefined)?.();
            });
            return request;
          },
          index: () => ({
            getAll: (value: string) => {
              const request: Record<string, unknown> = {};
              queueMicrotask(() => {
                const field = name === "decisionJournalEvents" ? "decisionId" : "symbol";
                request.result = [...rows.values()]
                  .filter((row) => (row as Record<string, unknown>)[field] === value)
                  .map((row) => structuredClone(row));
                (request.onsuccess as (() => void) | undefined)?.();
                (transaction.oncomplete as (() => void) | undefined)?.();
              });
              return request;
            },
          }),
        };
      };
      let aborted = false;
      transaction.objectStore = objectStore;
      transaction.abort = () => {
        aborted = true;
        queueMicrotask(() => (transaction.onabort as (() => void) | undefined)?.());
      };
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

const result: DecisionResult = {
  status: "WAIT", reasonCodes: ["TRIGGER_NOT_CONFIRMED"],
  supportingFamilies: ["market_structure"], contradictingFamilies: [],
  supportingEvidenceIds: ["e1"], contradictingEvidenceIds: [], invalidEvidence: [],
  supportScore: 0.8, contradictionScore: 0, coverageScore: 0.125,
  uncertaintyScore: 0.5, riskEligible: true,
};
const evidence: EvidenceItem = {
  id: "e1", family: "market_structure", claim: "Higher low intact",
  polarity: "supports", strength: 0.8, quality: 0.9, symbol: "BTCUSDT",
  timeframe: "4h", availableAt: 1_800_000_000_000, observedAt: 1_800_000_000_000,
  sourceRef: "snapshot:btc", calculationVersion: "v1",
};
const record: DecisionJournalRecord = {
  schemaVersion: 1, decisionId: "decision-1", decisionAt: 1_800_000_000_000,
  clockSource: "test-clock", symbol: "BTCUSDT", timeframe: "4h",
  status: "WAIT", reasonCodes: ["TRIGGER_NOT_CONFIRMED"], candidate: null,
  marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "sha256:abc" }],
  evidence: [evidence], result,
  thesis: { bullCase: ["Structure intact"], bearCase: ["No trigger"], alternatives: [], invalidation: [] },
  versions: { engine: "1", score: "1", strategy: "1", riskPolicy: "1" },
};
const event: DecisionJournalEvent = {
  schemaVersion: 1, eventId: "event-1", decisionId: "decision-1",
  eventType: "outcome_appended", occurredAt: 1_800_000_060_000,
  payload: { horizonClosed: true, hypotheticalR: 1.2 },
};

describe("DecisionJournalStore", () => {
  it("appends and reads an immutable decision snapshot", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    const saved = await store.append(record);
    expect(saved).toEqual(record);
    const restored = await store.get(record.decisionId);
    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
  });

  it("rejects duplicate decision IDs instead of overwriting history", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await store.append(record);
    await expect(store.append({ ...record, reasonCodes: ["CHANGED"] })).rejects.toThrow();
    expect((await store.get(record.decisionId))?.reasonCodes).toEqual(record.reasonCodes);
  });

  it("lists decisions newest first and validates the requested limit", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await store.append(record);
    await store.append({ ...record, decisionId: "decision-2", decisionAt: record.decisionAt + 1 });
    expect((await store.list()).map((row) => row.decisionId)).toEqual(["decision-2", "decision-1"]);
    await expect(store.list(0)).rejects.toThrow();
  });

  it("appends linked events without mutating the original decision", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await store.append(record);
    await store.appendEvent(event);
    expect(await store.listEvents(record.decisionId)).toEqual([event]);
    expect(await store.get(record.decisionId)).toEqual(record);
  });

  it("rejects events for missing decisions and duplicate event IDs", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await expect(store.appendEvent(event)).rejects.toThrow(/decision/i);
    await store.append(record);
    await store.appendEvent(event);
    await expect(store.appendEvent(event)).rejects.toThrow();
  });

  it("exports every decision and linked event and restores a missing journal atomically", async () => {
    const source = new DecisionJournalStore(memoryIndexedDb());
    await source.append(record);
    await source.appendEvent(event);
    const backup = await source.exportAll();
    expect(backup).toEqual({ records: [record], events: [event] });

    const target = new DecisionJournalStore(memoryIndexedDb());
    await expect(target.previewRestore(backup)).resolves.toMatchObject({
      addedRecords: 1, addedEvents: 1, unchangedRecords: 0, unchangedEvents: 0, conflicts: [],
    });
    await expect(target.restoreAll(backup)).resolves.toEqual({
      addedRecords: 1, addedEvents: 1, unchangedRecords: 0, unchangedEvents: 0,
    });
    expect(await target.exportAll()).toEqual(backup);
    await expect(target.restoreAll(backup)).resolves.toEqual({
      addedRecords: 0, addedEvents: 0, unchangedRecords: 1, unchangedEvents: 1,
    });
  });

  it("rejects conflicting IDs and missing event parents before writing anything", async () => {
    const target = new DecisionJournalStore(memoryIndexedDb());
    await target.append(record);
    const before = await target.exportAll();
    await expect(target.previewRestore({
      records: [{ ...record, reasonCodes: ["DIFFERENT"] }], events: [event],
    })).resolves.toMatchObject({ conflicts: [expect.stringMatching(/decision ID/i)] });
    await expect(target.restoreAll({
      records: [{ ...record, reasonCodes: ["DIFFERENT"] }], events: [event],
    })).rejects.toThrow(/conflict/i);
    await expect(target.restoreAll({ records: [], events: [{ ...event, decisionId: "missing-decision" }] })).rejects.toThrow(/missing decision/i);
    expect(await target.exportAll()).toEqual(before);
  });

  it("rejects malformed records and malformed events", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await expect(store.append({ ...record, symbol: "" })).rejects.toThrow();
    await store.append(record);
    await expect(store.appendEvent({ ...event, payload: { value: Number.NaN } })).rejects.toThrow();
  });
  it("rejects events timestamped before their decision", async () => {
    const store = new DecisionJournalStore(memoryIndexedDb());
    await store.append(record);
    await expect(store.appendEvent({ ...event, occurredAt: record.decisionAt - 1 })).rejects.toThrow(/precede/i);
  });

});