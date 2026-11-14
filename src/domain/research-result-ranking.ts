export interface ResearchRankingInput {
  id: string;
  name: string;
  completedTrades: number;
  foldCount: number;
  reviewStatus: "INSUFFICIENT_SAMPLE" | "FRAGILE" | "REVIEW_FOR_PAPER";
  positiveFoldPct: number | null;
  worstFoldReturnPct: number | null;
  expectancy: number | null;
  worstDrawdownPct: number | null;
  compoundedReturnPct: number;
}

/** Conservative lexicographic ordering: sample and robustness precede raw return. */
export function rankResearchCandidates<T extends ResearchRankingInput>(items: readonly T[]): T[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || !item.id?.trim() || ids.has(item.id)) {
      throw new TypeError("Research candidate IDs must be present and unique");
    }
    ids.add(item.id);
    if (![item.completedTrades, item.foldCount, item.compoundedReturnPct].every(Number.isFinite)) {
      throw new TypeError("Research ranking metrics must be finite");
    }
  }
  const statusRank = (status: ResearchRankingInput["reviewStatus"]): number =>
    status === "REVIEW_FOR_PAPER" ? 2 : status === "FRAGILE" ? 1 : 0;
  const descendingNullable = (a: number | null, b: number | null): number =>
    (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
  const ascendingNullable = (a: number | null, b: number | null): number =>
    (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) =>
    statusRank(b.reviewStatus) - statusRank(a.reviewStatus) ||
    Math.min(b.completedTrades, 30) - Math.min(a.completedTrades, 30) ||
    Math.min(b.foldCount, 5) - Math.min(a.foldCount, 5) ||
    descendingNullable(a.positiveFoldPct, b.positiveFoldPct) ||
    descendingNullable(a.worstFoldReturnPct, b.worstFoldReturnPct) ||
    descendingNullable(a.expectancy, b.expectancy) ||
    ascendingNullable(a.worstDrawdownPct, b.worstDrawdownPct) ||
    b.compoundedReturnPct - a.compoundedReturnPct ||
    a.id.localeCompare(b.id),
  );
}
