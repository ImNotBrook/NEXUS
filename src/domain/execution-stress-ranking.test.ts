import { describe, expect, it } from "vitest";
import { rankExecutionStressCandidates } from "./execution-stress-ranking";
import type { ExecutionStressReport } from "./execution-stress-test";

function scenario(id: string, values: Array<{ id: string; name: string; returns: number; drawdown: number; expectancy: number; trades: number; folds: number }>) {
  return {
    id, label: id, costMultiplier: 1, participationMultiplier: 1,
    report: {
      candidateResults: values.map((value) => ({
        id: value.id, name: value.name,
        evaluation: { compoundedReturnPct: value.returns, folds: Array.from({ length: value.folds }, () => ({})) },
        scorecard: { worstFoldDrawdownPct: value.drawdown, expectancyPerTrade: value.expectancy, completedTrades: value.trades },
      })),
    },
  } as unknown as ExecutionStressReport["scenarios"][number];
}

describe("rankExecutionStressCandidates", () => {
  it("ranks by worst-case stressed return, then median return and downside", () => {
    const report = {
      scenarios: [
        scenario("base", [
          { id: "fragile", name: "Fragile", returns: 80, drawdown: 40, expectancy: 3, trades: 80, folds: 6 },
          { id: "robust", name: "Robust", returns: 25, drawdown: 12, expectancy: 1, trades: 60, folds: 6 },
        ]),
        scenario("stress", [
          { id: "fragile", name: "Fragile", returns: -30, drawdown: 55, expectancy: -2, trades: 80, folds: 6 },
          { id: "robust", name: "Robust", returns: 12, drawdown: 15, expectancy: 0.7, trades: 60, folds: 6 },
        ]),
      ],
    } as ExecutionStressReport;
    const ranked = rankExecutionStressCandidates(report);
    expect(ranked.map((item) => item.candidateId)).toEqual(["robust", "fragile"]);
    expect(ranked[0].worstCaseReturnPct).toBe(12);
  });

  it("places inadequate samples after adequately sampled candidates", () => {
    const report = {
      scenarios: [
        scenario("base", [
          { id: "tiny", name: "Tiny", returns: 200, drawdown: 2, expectancy: 10, trades: 5, folds: 2 },
          { id: "sampled", name: "Sampled", returns: 5, drawdown: 10, expectancy: 0.2, trades: 40, folds: 5 },
        ]),
      ],
    } as ExecutionStressReport;
    const ranked = rankExecutionStressCandidates(report);
    expect(ranked.map((item) => item.candidateId)).toEqual(["sampled", "tiny"]);
    expect(ranked[1].sampleSufficient).toBe(false);
  });

  it("uses stable ID as final tie-breaker and rejects duplicate/missing candidate identities", () => {
    const report = {
      scenarios: [
        scenario("base", [
          { id: "z", name: "Z", returns: 5, drawdown: 10, expectancy: 1, trades: 40, folds: 5 },
          { id: "a", name: "A", returns: 5, drawdown: 10, expectancy: 1, trades: 40, folds: 5 },
        ]),
      ],
    } as ExecutionStressReport;
    expect(rankExecutionStressCandidates(report).map((item) => item.candidateId)).toEqual(["a", "z"]);
    expect(() => rankExecutionStressCandidates({ scenarios: [] } as unknown as ExecutionStressReport)).toThrow();
  });
});
