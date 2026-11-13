import { describe, expect, it } from "vitest";
import { createBaselineResearchCandidates } from "./baseline-research-candidates";

describe("createBaselineResearchCandidates", () => {
  it("creates stable, parameter-specific candidates with independent evaluator factories", () => {
    const candidates = createBaselineResearchCandidates({
      sma: { fastPeriod: 3, slowPeriod: 8 },
      rsi: { period: 5, oversold: 30, overbought: 70 },
      donchian: { period: 10 },
    });
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "baseline-sma-cross-f3-s8",
      "baseline-rsi-reversion-p5-o30-b70",
      "baseline-donchian-breakout-p10",
    ]);
    expect(candidates[0].fit([])).not.toBe(candidates[0].fit([]));
    expect(candidates[1].fit([])).not.toBe(candidates[1].fit([]));
  });

  it("rejects invalid strategy parameters before a batch is run", () => {
    expect(() => createBaselineResearchCandidates({
      sma: { fastPeriod: 8, slowPeriod: 3 },
      rsi: { period: 5, oversold: 30, overbought: 70 },
      donchian: { period: 10 },
    })).toThrow();
  });
});
