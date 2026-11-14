import { describe, expect, it } from "vitest";
import { rankResearchCandidates } from "./research-result-ranking";

describe("rankResearchCandidates", () => {
  it("puts robust, consistent and adequately sampled candidates first", () => {
    const ranked = rankResearchCandidates([
      { id: "high-return-small-sample", name: "Small", completedTrades: 8, foldCount: 3, reviewStatus: "INSUFFICIENT_SAMPLE", positiveFoldPct: 100, worstFoldReturnPct: 50, expectancy: 9, worstDrawdownPct: 2, compoundedReturnPct: 80 },
      { id: "robust", name: "Robust", completedTrades: 60, foldCount: 6, reviewStatus: "REVIEW_FOR_PAPER", positiveFoldPct: 80, worstFoldReturnPct: 3, expectancy: 0.8, worstDrawdownPct: 12, compoundedReturnPct: 25 },
      { id: "fragile", name: "Fragile", completedTrades: 60, foldCount: 6, reviewStatus: "FRAGILE", positiveFoldPct: 20, worstFoldReturnPct: -15, expectancy: -0.5, worstDrawdownPct: 40, compoundedReturnPct: 90 },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["robust", "fragile", "high-return-small-sample"]);
  });

  it("uses stable ID tie-breaks and rejects duplicate identities", () => {
    const row = { name: "same", completedTrades: 40, foldCount: 5, reviewStatus: "FRAGILE" as const, positiveFoldPct: 50, worstFoldReturnPct: 0, expectancy: 0, worstDrawdownPct: 10, compoundedReturnPct: 1 };
    expect(rankResearchCandidates([{ ...row, id: "z" }, { ...row, id: "a" }]).map(x => x.id)).toEqual(["a", "z"]);
    expect(() => rankResearchCandidates([{ ...row, id: "a" }, { ...row, id: "a" }])).toThrow();
  });
});
