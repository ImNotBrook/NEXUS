import { describe, expect, it } from "vitest";
import { StrategyLibraryStore } from "./strategy-library-store";
import { createResearchCandidateFromDefinition, type StrategyDefinition } from "../domain/strategy-studio";
import { runResearchBatch } from "../domain/research-pipeline";
import { createHumanReviewedStrategyDefinition, parseAutomatedResearchAiArtifact } from "../domain/ai-strategy-review";

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
      if (!records) throw new Error("Missing object store: " + name);
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        add: (record: { id: string }) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            if (records.has(record.id)) {
              request.error = new DOMException("ConstraintError", "ConstraintError");
              (request.onerror as (() => void) | undefined)?.();
              (transaction.onabort as (() => void) | undefined)?.();
              return;
            }
            records.set(record.id, structuredClone(record));
            request.result = record.id;
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
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

const definition: StrategyDefinition = {
  schemaVersion: 1, id: "btc-sma", version: "1.0.0", name: "BTC SMA",
  family: "sma-crossover", parameters: { fastPeriod: 8, slowPeriod: 24 },
  createdAt: 1000, origin: "human", description: "Reviewed research definition",
};

describe("StrategyLibraryStore", () => {
  it("persists immutable definitions and reloads them newest first", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    const first = await store.save(definition);
    const second = await store.save({ ...definition, id: "btc-rsi", name: "BTC RSI", family: "rsi-mean-reversion", parameters: { period: 14, oversold: 30, overbought: 70 }, createdAt: 2000 });
    const records = await store.list();
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    expect(records[0].definition.family).toBe("rsi-mean-reversion");
    (records[0].definition.parameters as { period: number }).period = 99;
    expect((await store.list())[0].definition.parameters).toEqual({ period: 14, oversold: 30, overbought: 70 });
  });


  it("connects a persisted user strategy to the walk-forward research pipeline after reload", async () => {
    const database = memoryIndexedDb();
    const writer = new StrategyLibraryStore(database);
    const reader = new StrategyLibraryStore(database);
    const saved = await writer.save(definition);
    const reloaded = await reader.list();
    const candidate = createResearchCandidateFromDefinition(reloaded[0].definition);
    expect(candidate.id).toBe(saved.id);

    const candles = Array.from({ length: 300 }, (_, index) => {
      const close = 100 + index * 0.08 + Math.sin(index / 5) * 2;
      return {
        timestamp: index * 3_600_000,
        open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 100,
      };
    });
    const report = runResearchBatch(candles, [candidate], {
      folds: { trainBars: 100, testBars: 40, stepBars: 40, embargoBars: 2, expanding: true },
      backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
      regime: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
    }, { symbol: "BTCUSDT", interval: "1h", provider: "synthetic-test" });
    expect(report.candidateResults).toHaveLength(1);
    expect(report.candidateResults[0].id).toBe("btc-sma@1.0.0");
    expect(report.dataset.metadata?.symbol).toBe("BTCUSDT");
  });

  it("connects an AI proposal through explicit approval, immutable storage and walk-forward research", async () => {
    const artifact = parseAutomatedResearchAiArtifact({
      schemaVersion: 1,
      createdAt: "2026-11-14T00:00:00.000Z",
      symbol: "BTCUSDT",
      interval: "1h",
      aiGeneration: {
        status: "generated",
        provider: "groq",
        model: "openai/gpt-oss-120b",
        proposals: [{
          family: "sma-crossover",
          parameters: { fastPeriod: 8, slowPeriod: 24 },
          rationale: "Tests a faster trend trigger against a slower baseline.",
        }],
      },
    });
    const reviewed = createHumanReviewedStrategyDefinition(artifact.proposals[0], 1_800_000_000_000, artifact);
    expect(reviewed.origin).toBe("human");

    const database = memoryIndexedDb();
    const saved = await new StrategyLibraryStore(database).save(reviewed as StrategyDefinition);
    const reloaded = await new StrategyLibraryStore(database).list();
    expect(reloaded[0].id).toBe(saved.id);
    const candidate = createResearchCandidateFromDefinition(reloaded[0].definition);
    const candles = Array.from({ length: 300 }, (_, index) => {
      const close = 100 + index * 0.08 + Math.sin(index / 5) * 2;
      return {
        timestamp: index * 3_600_000,
        open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 100,
      };
    });
    const report = runResearchBatch(candles, [candidate], {
      folds: { trainBars: 100, testBars: 40, stepBars: 40, embargoBars: 2, expanding: true },
      backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
      regime: { fastEmaPeriod: 5, slowEmaPeriod: 13, atrPeriod: 14, trendThresholdPct: 0.1, lowVolatilityAtrPct: 0.3, highVolatilityAtrPct: 1.5 },
    }, { symbol: "BTCUSDT", interval: "1h", provider: "synthetic-test" });
    expect(report.candidateResults).toHaveLength(1);
    expect(report.candidateResults[0].id).toBe(saved.id);
  });

  it("exports the complete strategy library and restores it idempotently after reload", async () => {
    const database = memoryIndexedDb();
    const writer = new StrategyLibraryStore(database);
    const reader = new StrategyLibraryStore(database);
    const saved = await writer.save(definition);
    const backup = await writer.exportAll();
    expect(backup).toEqual([saved]);
    const preview = await reader.previewRestore(backup);
    expect(preview).toEqual({ added: 0, unchanged: 1, conflicts: [] });
    const emptyDatabase = memoryIndexedDb();
    const destination = new StrategyLibraryStore(emptyDatabase);
    const firstRestore = await destination.restoreAll(backup);
    const secondRestore = await destination.restoreAll(backup);
    expect(firstRestore).toEqual({ added: 1, unchanged: 0 });
    expect(secondRestore).toEqual({ added: 0, unchanged: 1 });
    expect((await new StrategyLibraryStore(emptyDatabase).list())[0].definition).toEqual(definition);
  });

  it("blocks a strategy backup with conflicting content under an existing ID/version", async () => {
    const database = memoryIndexedDb();
    const store = new StrategyLibraryStore(database);
    await store.save(definition);
    const conflicting = [{
      id: "btc-sma@1.0.0", createdAt: 1000,
      definition: { ...definition, name: "Altered content" },
    }];
    const preview = await store.previewRestore(conflicting);
    expect(preview.conflicts).toEqual(["Strategy version has different content: btc-sma@1.0.0"]);
    await expect(store.restoreAll(conflicting)).rejects.toThrow(/different content/);
    expect((await store.list())[0].definition.name).toBe("BTC SMA");
  });

  it("rejects malformed and duplicate records in a strategy backup", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    await expect(store.previewRestore([{ id: "wrong", createdAt: 1000, definition }])).rejects.toThrow(/identity/i);
    await expect(store.restoreAll([
      { id: "btc-sma@1.0.0", createdAt: 1000, definition },
      { id: "btc-sma@1.0.0", createdAt: 1000, definition },
    ])).rejects.toThrow(/duplicate/i);
  });

  it("rejects duplicate versions instead of overwriting an immutable definition", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    await store.save(definition);
    await expect(store.save({ ...definition, name: "Mutated definition" })).rejects.toThrow();
  });

  it("rejects invalid definitions and unsafe limits", async () => {
    const store = new StrategyLibraryStore(memoryIndexedDb());
    await expect(store.save({ ...definition, version: "bad" })).rejects.toThrow(/Invalid strategy/);
    await expect(store.list(0)).rejects.toThrow(/limit/);
  });
});
