import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import type { ResearchCandidate, ResearchPipelineConfig } from "./research-pipeline";
import { prepareSealedHoldout, evaluateSealedHoldout } from "./sealed-holdout";

const candles: Candle[] = Array.from({ length: 500 }, (_, index) => ({
  timestamp: index * 3_600_000,
  open: 100 + index * 0.02,
  high: 101 + index * 0.02,
  low: 99 + index * 0.02,
  close: 100 + index * 0.02,
  volume: 100,
}));

const pipeline: ResearchPipelineConfig = {
  folds: { trainBars: 300, testBars: 100, stepBars: 100, embargoBars: 2, expanding: true },
  backtest: { initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25 },
  executionModel: {
    feeRate: 0.001, baseSlippageBps: 5, halfSpreadBps: 2,
    maxParticipationRate: 0.01, marketImpactBpsAtMaxParticipation: 25,
  },
  regime: {
    fastEmaPeriod: 10, slowEmaPeriod: 30, atrPeriod: 14,
    trendThresholdPct: 0.15, lowVolatilityAtrPct: 0.5, highVolatilityAtrPct: 3,
  },
};
const metadata = { symbol: "BTCUSDT", interval: "1h", provider: "Binance public spot" };

describe("sealed final holdout", () => {
  it("reserves the newest contiguous fraction and excludes the embargo from both samples", () => {
    const plan = prepareSealedHoldout(candles, metadata, 0.2, 2);
    expect(plan.developmentCandles).toHaveLength(398);
    expect(plan.embargoCandles).toHaveLength(2);
    expect(plan.holdoutCandles).toHaveLength(100);
    expect(plan.developmentCandles.at(-1)?.timestamp).toBe(397 * 3_600_000);
    expect(plan.holdoutCandles[0].timestamp).toBe(400 * 3_600_000);
    expect(plan.identity).toMatchObject({
      symbol: "BTCUSDT", interval: "1h",
      startTimestamp: 400 * 3_600_000, endTimestamp: 499 * 3_600_000,
    });
  });

  it("fits each candidate only on development candles and evaluates exactly one final holdout fold", () => {
    const seenTrainingEnds: number[] = [];
    const candidates: ResearchCandidate[] = [{
      id: "frozen-baseline-v1",
      name: "Frozen baseline",
      fit: (training) => {
        seenTrainingEnds.push(training[training.length - 1].timestamp);
        return () => "hold";
      },
    }];
    const plan = prepareSealedHoldout(candles, metadata, 0.2, 2);
    const result = evaluateSealedHoldout(plan, candidates, pipeline);
    expect(seenTrainingEnds).toEqual([397 * 3_600_000]);
    expect(result.report.candidateResults[0].evaluation.foldCount).toBe(1);
    expect(result.report.candidateResults[0].evaluation.folds[0]).toMatchObject({
      trainEndTimestamp: 397 * 3_600_000,
      testStartTimestamp: 400 * 3_600_000,
      testEndTimestamp: 499 * 3_600_000,
    });
    expect(result.report.dataset.fingerprint).toBe(plan.fullDatasetFingerprint);
    expect(result.seal).toMatchObject({
      datasetFingerprint: plan.fullDatasetFingerprint,
      holdoutFingerprint: plan.holdoutFingerprint,
      developmentFingerprint: plan.developmentFingerprint,
      holdoutStartTimestamp: 400 * 3_600_000,
      holdoutEndTimestamp: 499 * 3_600_000,
      candidateIds: ["frozen-baseline-v1"],
    });
  });

  it("rejects insufficient history, invalid fractions, and invalid market identity", () => {
    expect(() => prepareSealedHoldout(candles.slice(0, 150), metadata, 0.2, 2)).toThrow();
    expect(() => prepareSealedHoldout(candles, metadata, 0.05, 2)).toThrow();
    expect(() => prepareSealedHoldout(candles, { ...metadata, symbol: "" }, 0.2, 2)).toThrow();
  });

  it("does not mutate source candles or candidate arrays", () => {
    const before = JSON.stringify(candles);
    const candidates: ResearchCandidate[] = [{ id: "hold", name: "Hold", fit: () => () => "hold" }];
    const plan = prepareSealedHoldout(candles, metadata, 0.2, 2);
    evaluateSealedHoldout(plan, candidates, pipeline);
    expect(JSON.stringify(candles)).toBe(before);
    expect(candidates).toHaveLength(1);
  });
});
