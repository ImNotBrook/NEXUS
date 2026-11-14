import type { ExecutionStressReport } from "./execution-stress-test";

export interface ExecutionStressCandidateRank {
  rank: number;
  candidateId: string;
  name: string;
  scenarioCount: number;
  worstCaseReturnPct: number;
  medianReturnPct: number;
  worstDrawdownPct: number | null;
  worstExpectancyPerTrade: number | null;
  minimumCompletedTrades: number;
  minimumFoldCount: number;
  sampleSufficient: boolean;
  status: "SAMPLE_SUFFICIENT" | "INSUFFICIENT_SAMPLE";
}

/**
 * Orders candidates by survivability across every fixed stress scenario.
 * This is a descriptive shortlist, not a strategy promotion or holdout selector.
 */
export function rankExecutionStressCandidates(
  report: ExecutionStressReport,
): ExecutionStressCandidateRank[] {
  if (!report || !Array.isArray(report.scenarios) || report.scenarios.length === 0) {
    throw new TypeError("Execution stress report must contain scenarios");
  }
  const baseline = report.scenarios[0].report.candidateResults;
  if (!Array.isArray(baseline) || baseline.length === 0) {
    throw new TypeError("Execution stress scenarios must contain candidates");
  }
  const ids = new Set<string>();
  const rows = baseline.map((candidate) => {
    if (!candidate.id?.trim() || ids.has(candidate.id)) {
      throw new TypeError("Candidate IDs must be present and unique");
    }
    ids.add(candidate.id);
    const observations = report.scenarios.map((scenario) => {
      const matches = scenario.report.candidateResults.filter((item) => item.id === candidate.id);
      if (matches.length !== 1) {
        throw new Error("Every stress scenario must contain exactly one result for candidate " + candidate.id);
      }
      const result = matches[0];
      const value = result.evaluation.compoundedReturnPct;
      if (!Number.isFinite(value)) throw new TypeError("Candidate return must be finite");
      return result;
    });
    const returns = observations.map((item) => item.evaluation.compoundedReturnPct).sort((a, b) => a - b);
    const medianReturnPct = returns.length % 2
      ? returns[Math.floor(returns.length / 2)]
      : (returns[returns.length / 2 - 1] + returns[returns.length / 2]) / 2;
    const drawdowns = observations.map((item) => item.scorecard.worstFoldDrawdownPct)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const expectancies = observations.map((item) => item.scorecard.expectancyPerTrade)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const minimumCompletedTrades = Math.min(...observations.map((item) => item.scorecard.completedTrades));
    const minimumFoldCount = Math.min(...observations.map((item) => item.evaluation.folds.length));
    return {
      rank: 0,
      candidateId: candidate.id,
      name: candidate.name,
      scenarioCount: observations.length,
      worstCaseReturnPct: returns[0],
      medianReturnPct,
      worstDrawdownPct: drawdowns.length ? Math.max(...drawdowns) : null,
      worstExpectancyPerTrade: expectancies.length ? Math.min(...expectancies) : null,
      minimumCompletedTrades,
      minimumFoldCount,
      sampleSufficient: minimumCompletedTrades >= 30 && minimumFoldCount >= 5,
      status: minimumCompletedTrades >= 30 && minimumFoldCount >= 5
        ? "SAMPLE_SUFFICIENT" as const : "INSUFFICIENT_SAMPLE" as const,
    };
  });

  rows.sort((a, b) =>
    Number(b.sampleSufficient) - Number(a.sampleSufficient) ||
    b.worstCaseReturnPct - a.worstCaseReturnPct ||
    b.medianReturnPct - a.medianReturnPct ||
    (a.worstDrawdownPct ?? Number.POSITIVE_INFINITY) - (b.worstDrawdownPct ?? Number.POSITIVE_INFINITY) ||
    (b.worstExpectancyPerTrade ?? Number.NEGATIVE_INFINITY) -
      (a.worstExpectancyPerTrade ?? Number.NEGATIVE_INFINITY) ||
    a.candidateId.localeCompare(b.candidateId),
  );
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
