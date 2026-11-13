import { describe, expect, it } from "vitest";
import { compareResearchRuns } from "./research-comparison";
import type { ResearchBatchResult } from "./research-pipeline";

function report(fingerprint: string, returnPct: number): ResearchBatchResult {
  return {
    dataset: { candleCount: 300, firstTimestamp: 1, lastTimestamp: 300, fingerprint, metadata: { symbol: "BTCUSDT", interval: "1h", provider: "Binance public spot" } },
    config: {
      folds: { trainBars: 100, testBars: 20, stepBars: 20, embargoBars: 2, expanding: true },
      backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
      regime: { fastEmaPeriod: 10, slowEmaPeriod: 30, atrPeriod: 14, trendThresholdPct: 0.15, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3 },
    },
    candidateResults: [{
      id: "sma-v1", name: "SMA",
      evaluation: { compoundedReturnPct: returnPct, foldCount: 3 },
      scorecard: { worstFoldDrawdownPct: -5, completedTrades: 10, winRatePct: 60, positiveFoldPct: 66.7 },
    }],
  } as unknown as ResearchBatchResult;
}

describe("compareResearchRuns", () => {
  it("calculates matched candidate deltas when dataset and assumptions match", () => {
    const result = compareResearchRuns(report("same", 4), report("same", 7));
    expect(result.comparable).toBe(true);
    expect(result.candidateDeltas[0]).toMatchObject({
      candidateId: "sma-v1", returnDeltaPct: 3, tradeCountDelta: 0,
    });
  });

  it("marks comparisons non-comparable when data or execution assumptions differ", () => {
    expect(compareResearchRuns(report("one", 4), report("two", 7)).comparable).toBe(false);
    const changed = report("same", 7);
    changed.config.backtest.feeRate = 0.002;
    expect(compareResearchRuns(report("same", 4), changed).comparable).toBe(false);
    const otherMarket = report("same", 7);
    otherMarket.dataset.metadata!.symbol = "ETHUSDT";
    expect(compareResearchRuns(report("same", 4), otherMarket).reasons).toContain("Market symbol, interval or provider differs");
  });

  it("refuses to certify legacy reports without market provenance", () => {
    const first = report("same", 4);
    const second = report("same", 7);
    delete second.dataset.metadata;
    expect(compareResearchRuns(first, second).comparable).toBe(false);
  });

  it("reports only candidates present in both experiments", () => {
    const first = report("same", 4);
    const second = report("same", 5);
    second.candidateResults = [];
    expect(compareResearchRuns(first, second).candidateDeltas).toEqual([]);
  });
});
