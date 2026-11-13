import { describe, expect, it } from "vitest";
import { ResearchHypothesisStore } from "./research-hypothesis-store";
import { createResearchHypothesis, type ResearchHypothesisInput } from "../domain/research-agent";

function memoryIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => { const records = new Map<string, unknown>(); stores.set(name, records); return { createIndex: () => undefined }; },
    transaction: (name: string) => {
      const records = stores.get(name)!;
      const tx: Record<string, unknown> = {};
      tx.objectStore = () => ({
        add: (record: { id: string }) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            if (records.has(record.id)) { (request.onerror as (() => void) | undefined)?.(); return; }
            records.set(record.id, structuredClone(record));
            request.result = record.id;
            (request.onsuccess as (() => void) | undefined)?.();
            (tx.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        getAll: () => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => { request.result = [...records.values()].map((x) => structuredClone(x)); (request.onsuccess as (() => void) | undefined)?.(); (tx.oncomplete as (() => void) | undefined)?.(); });
          return request;
        },
      });
      return tx;
    },
    close: () => undefined,
  };
  return { open: () => { const request: Record<string, unknown> = { result: database }; queueMicrotask(() => { (request.onupgradeneeded as (() => void) | undefined)?.(); (request.onsuccess as (() => void) | undefined)?.(); }); return request; } } as unknown as IDBFactory;
}

const input: ResearchHypothesisInput = {
  title: "Volatility filter improves stability",
  question: "Does an ATR filter improve median fold return without worsening drawdown?",
  rationale: "Volatility clusters can change execution quality.",
  sourceEvidence: [
    { sourceType: "experiment", reference: "run:123", claim: "Prior fold reports show volatility-dependent results." },
    { sourceType: "paper", reference: "paper:abc", claim: "Published research describes volatility clustering." },
  ],
  targetStrategyId: "sma-v1", proposedVariables: ["atrThreshold"],
  primaryMetric: "median-fold-return", guardrailMetrics: ["max-drawdown", "trade-count"], createdAt: 1234,
};

describe("ResearchHypothesisStore", () => {
  it("persists hypotheses and lists newest first", async () => {
    const store = new ResearchHypothesisStore(memoryIndexedDb());
    const older = createResearchHypothesis(input);
    const newer = createResearchHypothesis({ ...input, createdAt: 2345, title: "Second hypothesis" });
    await store.save(older);
    await store.save(newer);
    expect((await store.list()).map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("does not overwrite an existing hypothesis ID", async () => {
    const store = new ResearchHypothesisStore(memoryIndexedDb());
    const hypothesis = createResearchHypothesis(input);
    await store.save(hypothesis);
    await expect(store.save(hypothesis)).rejects.toThrow();
  });
});
