import type { ResearchBatchResult } from "./research-pipeline";

export interface ResearchCandidateDelta {
  candidateId: string;
  name: string;
  returnDeltaPct: number;
  worstFoldDrawdownDeltaPct: number | null;
  tradeCountDelta: number;
  winRateDeltaPct: number | null;
  positiveFoldDeltaPct: number | null;
}

export interface ResearchComparison {
  comparable: boolean;
  reasons: string[];
  candidateDeltas: ResearchCandidateDelta[];
}

/** Deltas are descriptive only; mismatched data/configuration is never presented as apples-to-apples. */
export function compareResearchRuns(
  baseline: ResearchBatchResult,
  candidate: ResearchBatchResult,
): ResearchComparison {
  const reasons: string[] = [];
  if (baseline.dataset.fingerprint !== candidate.dataset.fingerprint ||
      baseline.dataset.candleCount !== candidate.dataset.candleCount ||
      baseline.dataset.firstTimestamp !== candidate.dataset.firstTimestamp ||
      baseline.dataset.lastTimestamp !== candidate.dataset.lastTimestamp) {
    reasons.push("Market dataset differs");
  }
  if (!baseline.dataset.metadata || !candidate.dataset.metadata) {
    reasons.push("Market provenance is missing");
  } else if (baseline.dataset.metadata.symbol !== candidate.dataset.metadata.symbol ||
      baseline.dataset.metadata.interval !== candidate.dataset.metadata.interval ||
      baseline.dataset.metadata.provider !== candidate.dataset.metadata.provider) {
    reasons.push("Market symbol, interval or provider differs");
  }
  if (JSON.stringify(baseline.config) !== JSON.stringify(candidate.config)) {
    reasons.push("Walk-forward or execution assumptions differ");
  }

  const candidateById = new Map(candidate.candidateResults.map((item) => [item.id, item]));
  const candidateDeltas = baseline.candidateResults.flatMap((base) => {
    const next = candidateById.get(base.id);
    if (!next) return [];
    const baseDrawdown = base.scorecard.worstFoldDrawdownPct;
    const nextDrawdown = next.scorecard.worstFoldDrawdownPct;
    const baseWinRate = base.scorecard.winRatePct;
    const nextWinRate = next.scorecard.winRatePct;
    const basePositiveFolds = base.scorecard.positiveFoldPct;
    const nextPositiveFolds = next.scorecard.positiveFoldPct;
    return [{
      candidateId: base.id,
      name: base.name,
      returnDeltaPct: next.evaluation.compoundedReturnPct - base.evaluation.compoundedReturnPct,
      worstFoldDrawdownDeltaPct: baseDrawdown === null || nextDrawdown === null
        ? null : nextDrawdown - baseDrawdown,
      tradeCountDelta: next.scorecard.completedTrades - base.scorecard.completedTrades,
      winRateDeltaPct: baseWinRate === null || nextWinRate === null ? null : nextWinRate - baseWinRate,
      positiveFoldDeltaPct: basePositiveFolds === null || nextPositiveFolds === null
        ? null : nextPositiveFolds - basePositiveFolds,
    }];
  });

  return { comparable: reasons.length === 0, reasons, candidateDeltas };
}
