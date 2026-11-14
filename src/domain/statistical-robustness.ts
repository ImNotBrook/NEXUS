import type { WalkForwardEvaluationResult } from "./walk-forward-evaluation";

export type RobustnessStatus = "INSUFFICIENT_SAMPLE" | "FRAGILE" | "REVIEW_FOR_PAPER";

export interface ConfidenceInterval95 {
  lowerPct: number;
  upperPct: number;
}

export interface StatisticalRobustnessReport {
  status: RobustnessStatus;
  completedTrades: number;
  foldCount: number;
  winRatePct: number | null;
  winRateConfidence95: ConfidenceInterval95 | null;
  expectancyPerTrade: number | null;
  expectancyBlockBootstrap95: { lower: number; upper: number } | null;
  positiveFoldPct: number | null;
  medianFoldReturnPct: number | null;
  worstFoldReturnPct: number | null;
  worstFoldDrawdownPct: number | null;
  foldsWithUnresolvedExposure: number;
  candidateCount: number;
  warnings: string[];
  interpretation: string;
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function wilsonInterval(wins: number, count: number): ConfidenceInterval95 {
  const z = 1.959963984540054;
  const p = wins / count;
  const denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const radius = z * Math.sqrt((p * (1 - p) / count) + z * z / (4 * count * count)) / denominator;
  return { lowerPct: Math.max(0, center - radius) * 100, upperPct: Math.min(1, center + radius) * 100 };
}

function blockBootstrapInterval(values: readonly number[], seed: number, iterations = 1000): { lower: number; upper: number } {
  const blockLength = Math.max(1, Math.ceil(Math.sqrt(values.length)));
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let sampled = 0;
    while (sampled < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockLength && sampled < values.length; offset += 1) {
        sum += values[(start + offset) % values.length];
        sampled += 1;
      }
    }
    means.push(sum / values.length);
  }
  return { lower: quantile(means, 0.025), upper: quantile(means, 0.975) };
}

function fingerprintSeed(values: readonly number[]): number {
  const serialized = values.map((value) => value.toPrecision(12)).join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Descriptive robustness diagnostics for chronological OOS folds.
 * Wilson bounds quantify binomial win-rate uncertainty. The circular moving-
 * block bootstrap preserves short-range order in trade PnL; it is not a
 * significance test and does not correct for strategy search or regime shift.
 */
export function buildStatisticalRobustnessReport(
  evaluation: WalkForwardEvaluationResult,
  candidateCount: number,
): StatisticalRobustnessReport {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1) {
    throw new RangeError("candidateCount must be a positive integer");
  }
  if (!Number.isSafeInteger(evaluation.foldCount) || evaluation.foldCount !== evaluation.folds.length) {
    throw new RangeError("foldCount must match the supplied folds");
  }
  const trades = evaluation.folds.flatMap((fold) => fold.result.trades);
  const pnls = trades.map((trade) => {
    if (!Number.isFinite(trade.pnl)) throw new RangeError("Trade PnL must be finite");
    return trade.pnl;
  });
  const foldReturns = evaluation.folds.map((fold) => {
    if (!Number.isFinite(fold.result.totalReturnPct) ||
        !Number.isFinite(fold.result.maxDrawdownPct) || fold.result.maxDrawdownPct < 0) {
      throw new RangeError("Fold returns and drawdowns must be finite; drawdown must be non-negative");
    }
    return fold.result.totalReturnPct;
  });
  const completedTrades = pnls.length;
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const expectancy = completedTrades ? pnls.reduce((sum, pnl) => sum + pnl, 0) / completedTrades : null;
  const sortedReturns = [...foldReturns].sort((a, b) => a - b);
  const medianFoldReturnPct = sortedReturns.length
    ? sortedReturns.length % 2
      ? sortedReturns[Math.floor(sortedReturns.length / 2)]
      : (sortedReturns[sortedReturns.length / 2 - 1] + sortedReturns[sortedReturns.length / 2]) / 2
    : null;
  const positiveFoldPct = foldReturns.length
    ? foldReturns.filter((value) => value > 0).length / foldReturns.length * 100
    : null;
  const unresolved = evaluation.folds.filter((fold) =>
    fold.result.openPosition !== null ||
    ("pendingOrder" in fold.result && fold.result.pendingOrder !== null),
  ).length;
  const warnings: string[] = [];
  if (completedTrades < 30) warnings.push("Fewer than 30 completed out-of-sample trades.");
  if (foldReturns.length < 5) warnings.push("Fewer than 5 out-of-sample folds.");
  if (completedTrades > 0 && wins > 0 && wins < completedTrades) {
    warnings.push("Win-rate confidence bounds are descriptive and assume a binary trade outcome.");
  }
  if (expectancy !== null && expectancy <= 0) warnings.push("Net expectancy is not positive after modeled costs.");
  if (positiveFoldPct !== null && positiveFoldPct < 60) warnings.push("Fewer than 60% of out-of-sample folds are positive.");
  if (unresolved > 0) warnings.push("At least one test fold ends with an open position or pending order.");
  if (candidateCount > 1) warnings.push("Multiple candidates were evaluated; the best observed result is exposed to selection bias.");
  warnings.push("Intervals are uncertainty diagnostics, not proof of statistical significance or future profitability.");
  const insufficient = completedTrades < 30 || foldReturns.length < 5;
  const fragile = !insufficient && (
    expectancy === null || expectancy <= 0 ||
    positiveFoldPct === null || positiveFoldPct < 60 || unresolved > 0
  );
  const status: RobustnessStatus = insufficient ? "INSUFFICIENT_SAMPLE" : fragile ? "FRAGILE" : "REVIEW_FOR_PAPER";
  const interpretation = status === "INSUFFICIENT_SAMPLE"
    ? "Insufficient independent out-of-sample evidence. Do not qualify this strategy."
    : status === "FRAGILE"
      ? "Results fail one or more consistency, expectancy or execution-completion checks. Keep researching; do not promote."
      : "Basic sample and consistency gates passed. This only merits controlled paper observation, not automatic promotion.";
  return {
    status,
    completedTrades,
    foldCount: foldReturns.length,
    winRatePct: completedTrades ? wins / completedTrades * 100 : null,
    winRateConfidence95: completedTrades ? wilsonInterval(wins, completedTrades) : null,
    expectancyPerTrade: expectancy,
    expectancyBlockBootstrap95: completedTrades >= 30
      ? blockBootstrapInterval(pnls, fingerprintSeed(pnls))
      : null,
    positiveFoldPct,
    medianFoldReturnPct,
    worstFoldReturnPct: foldReturns.length ? Math.min(...foldReturns) : null,
    worstFoldDrawdownPct: foldReturns.length ? Math.max(...evaluation.folds.map((fold) => fold.result.maxDrawdownPct)) : null,
    foldsWithUnresolvedExposure: unresolved,
    candidateCount,
    warnings,
    interpretation,
  };
}
