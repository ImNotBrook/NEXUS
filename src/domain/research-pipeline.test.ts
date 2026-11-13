import { describe, expect, it } from "vitest";
import { runResearchBatch, type ResearchCandidate } from "./research-pipeline";
import type { Candle } from "./candles";

const candles: Candle[] = Array.from({ length: 30 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + Math.sin(index / 2) * 5 + index * 0.1,
  high: 102 + Math.sin(index / 2) * 5 + index * 0.1,
  low: 98 + Math.sin(index / 2) * 5 + index * 0.1,
  close: 100 + Math.sin(index / 2) * 5 + index * 0.1,
  volume: 10,
}));

const regimeConfig = {
  fastEmaPeriod: 2,
  slowEmaPeriod: 4,
  atrPeriod: 3,
  trendThresholdPct: 0.05,
  lowVolatilityAtrPct: 0.1,
  highVolatilityAtrPct: 10,
};

const baseConfig = {
  folds: { trainBars: 10, testBars: 5, stepBars: 5, embargoBars: 1 },
  backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
  regime: regimeConfig,
};

describe("runResearchBatch", () => {
  it("evaluates candidates on identical walk-forward windows and returns separate evidence", () => {
    const seen: number[][] = [];
    const candidates: ResearchCandidate[] = [
      { id: "hold", name: "Hold baseline", fit: () => () => "hold" },
      {
        id: "buy-once",
        name: "Buy then sell",
        fit: (training) => {
          seen.push(training.map((candle) => candle.timestamp));
          let first = true;
          return (history) => {
            if (first && history.length === training.length + 2) {
              first = false;
              return "buy";
            }
            if (history.length === training.length + 3) return "sell";
            return "hold";
          };
        },
      },
    ];

    const report = runResearchBatch(candles, candidates, baseConfig);
    expect(report.candidateResults).toHaveLength(2);
    expect(report.candidateResults[0].evaluation.folds.map((fold) => [
      fold.trainStartTimestamp, fold.trainEndTimestamp, fold.testStartTimestamp, fold.testEndTimestamp,
    ])).toEqual(report.candidateResults[1].evaluation.folds.map((fold) => [
      fold.trainStartTimestamp, fold.trainEndTimestamp, fold.testStartTimestamp, fold.testEndTimestamp,
    ]));
    expect(report.candidateResults[0].scorecard.completedTrades).toBe(0);
    expect(report.candidateResults[1].scorecard.completedTrades).toBeGreaterThan(0);
    expect(report.dataset).toMatchObject({ candleCount: 30, firstTimestamp: 0, lastTimestamp: 29 * 60_000 });
    expect(report.dataset.fingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    const altered = candles.map((candle, index) => index === 0 ? { ...candle, close: candle.close + 0.01 } : candle);
    const alteredReport = runResearchBatch(altered, [{ id: "hold", name: "Hold", fit: () => () => "hold" }], baseConfig);
    expect(alteredReport.dataset.fingerprint).not.toBe(report.dataset.fingerprint);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("rejects duplicate candidate IDs and empty candidate lists", () => {
    const candidate = { id: "same", name: "Same", fit: () => () => "hold" as const };
    expect(() => runResearchBatch(candles, [candidate, candidate], baseConfig)).toThrow();
    expect(() => runResearchBatch(candles, [], baseConfig)).toThrow();
  });

  it("does not mutate the supplied candle history", () => {
    const before = JSON.stringify(candles);
    runResearchBatch(candles, [{ id: "hold", name: "Hold", fit: () => () => "hold" }], baseConfig);
    expect(JSON.stringify(candles)).toBe(before);
  });


  it("stores the complete execution model alongside the evaluated research results", () => {
    const executionModel = {
      feeRate: 0.001,
      baseSlippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationRate: 0.01,
      marketImpactBpsAtMaxParticipation: 25,
    };
    const report = runResearchBatch(candles, [
      { id: "hold", name: "Hold", fit: () => () => "hold" },
    ], { ...baseConfig, executionModel });
    expect(report.config.executionModel).toEqual(executionModel);
    expect(report.candidateResults[0].evaluation.totalFillEvents).toBe(0);
    expect(report.candidateResults[0].evaluation.totalPendingQuantity).toBe(0);
  });
\n});
