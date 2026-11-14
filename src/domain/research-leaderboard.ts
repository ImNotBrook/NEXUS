import type { StoredResearchRun } from "../adapters/research-run-store";
import { buildStatisticalRobustnessReport } from "./statistical-robustness";

export interface ResearchLeaderboardEntry {
  runId: string;
  createdAt: number;
  candidateId: string;
  name: string;
  returnPct: number;
  completedTrades: number;
  foldCount: number;
  worstFoldReturnPct: number | null;
  worstDrawdownPct: number | null;
  expectancy: number | null;
  reviewStatus: "INSUFFICIENT_SAMPLE" | "FRAGILE" | "REVIEW_FOR_PAPER";
}

export interface ResearchLeaderboardGroup {
  id: string;
  label: string;
  comparable: boolean;
  comparisonNote: string;
  runIds: string[];
  bestHistorical: ResearchLeaderboardEntry[];
  mostRobust: ResearchLeaderboardEntry[];
}

export interface ResearchLeaderboard {
  groups: ResearchLeaderboardGroup[];
  nonComparableRunIds: string[];
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(stableSerialize).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ":" + stableSerialize(record[key]),
  ).join(",") + "}";
}

function validProvenance(record: StoredResearchRun): boolean {
  const metadata = record.report.dataset.metadata;
  return !!metadata && typeof metadata.symbol === "string" && metadata.symbol.trim().length > 0 &&
    typeof metadata.interval === "string" && metadata.interval.trim().length > 0 &&
    typeof metadata.provider === "string" && metadata.provider.trim().length > 0 &&
    typeof record.report.dataset.fingerprint === "string" && record.report.dataset.fingerprint.length > 0 &&
    Number.isSafeInteger(record.report.dataset.candleCount) &&
    Number.isSafeInteger(record.report.dataset.firstTimestamp) &&
    Number.isSafeInteger(record.report.dataset.lastTimestamp);
}

function compatibilityKey(record: StoredResearchRun): string {
  return stableSerialize({
    symbol: record.report.dataset.metadata?.symbol,
    interval: record.report.dataset.metadata?.interval,
    provider: record.report.dataset.metadata?.provider,
    fingerprint: record.report.dataset.fingerprint,
    candleCount: record.report.dataset.candleCount,
    firstTimestamp: record.report.dataset.firstTimestamp,
    lastTimestamp: record.report.dataset.lastTimestamp,
    config: record.report.config,
  });
}

function statusRank(status: ResearchLeaderboardEntry["reviewStatus"]): number {
  return status === "REVIEW_FOR_PAPER" ? 2 : status === "FRAGILE" ? 1 : 0;
}

/**
 * Builds local-only research leaderboards. Runs are comparable only when the
 * complete dataset identity, provenance and execution/research configuration
 * match exactly. Missing provenance is isolated to a single-run group.
 */
export function buildResearchLeaderboard(records: readonly StoredResearchRun[]): ResearchLeaderboard {
  const runIds = new Set<string>();
  const buckets = new Map<string, StoredResearchRun[]>();
  const nonComparableRunIds: string[] = [];

  for (const record of records) {
    if (!record || typeof record.id !== "string" || !record.id.trim() || runIds.has(record.id)) {
      throw new TypeError("Research leaderboard run IDs must be present and unique");
    }
    runIds.add(record.id);
    const comparable = validProvenance(record);
    if (!comparable) nonComparableRunIds.push(record.id);
    const key = comparable ? compatibilityKey(record) : "isolated:" + record.id;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }

  const groups: ResearchLeaderboardGroup[] = [];
  for (const [key, bucket] of buckets) {
    const orderedRuns = [...bucket].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const entries: ResearchLeaderboardEntry[] = [];
    for (const record of orderedRuns) {
      const candidates = record.report.candidateResults;
      const candidateIds = new Set<string>();
      for (const candidate of candidates) {
        if (!candidate.id?.trim() || candidateIds.has(candidate.id)) {
          throw new TypeError("Candidate IDs must be present and unique within each saved run");
        }
        candidateIds.add(candidate.id);
        const robustness = buildStatisticalRobustnessReport(candidate.evaluation, candidates.length);
        if (!Number.isFinite(candidate.evaluation.compoundedReturnPct) ||
            !Number.isFinite(candidate.scorecard.completedTrades) ||
            !Number.isFinite(candidate.evaluation.foldCount)) {
          throw new TypeError("Research leaderboard metrics must be finite");
        }
        entries.push({
          runId: record.id,
          createdAt: record.createdAt,
          candidateId: candidate.id,
          name: candidate.name,
          returnPct: candidate.evaluation.compoundedReturnPct,
          completedTrades: candidate.scorecard.completedTrades,
          foldCount: candidate.evaluation.foldCount,
          worstFoldReturnPct: robustness.worstFoldReturnPct,
          worstDrawdownPct: candidate.scorecard.worstFoldDrawdownPct,
          expectancy: candidate.scorecard.expectancyPerTrade,
          reviewStatus: robustness.status,
        });
      }
    }

    const bestHistorical = [...entries].sort((a, b) =>
      b.returnPct - a.returnPct ||
      (a.worstDrawdownPct ?? Number.POSITIVE_INFINITY) - (b.worstDrawdownPct ?? Number.POSITIVE_INFINITY) ||
      (b.expectancy ?? Number.NEGATIVE_INFINITY) - (a.expectancy ?? Number.NEGATIVE_INFINITY) ||
      a.runId.localeCompare(b.runId) || a.candidateId.localeCompare(b.candidateId),
    );
    const mostRobust = [...entries].sort((a, b) =>
      statusRank(b.reviewStatus) - statusRank(a.reviewStatus) ||
      Math.min(b.completedTrades, 30) - Math.min(a.completedTrades, 30) ||
      Math.min(b.foldCount, 5) - Math.min(a.foldCount, 5) ||
      (b.worstFoldReturnPct ?? Number.NEGATIVE_INFINITY) - (a.worstFoldReturnPct ?? Number.NEGATIVE_INFINITY) ||
      (b.expectancy ?? Number.NEGATIVE_INFINITY) - (a.expectancy ?? Number.NEGATIVE_INFINITY) ||
      (a.worstDrawdownPct ?? Number.POSITIVE_INFINITY) - (b.worstDrawdownPct ?? Number.POSITIVE_INFINITY) ||
      a.runId.localeCompare(b.runId) || a.candidateId.localeCompare(b.candidateId),
    );
    const metadata = orderedRuns[0].report.dataset.metadata;
    const comparable = validProvenance(orderedRuns[0]);
    const label = metadata
      ? metadata.symbol + " · " + metadata.interval + " · " + metadata.provider + " · " + orderedRuns[0].report.dataset.fingerprint
      : "Unverified provenance · " + orderedRuns[0].id;
    groups.push({
      id: key,
      label,
      comparable,
      comparisonNote: comparable
        ? "Exact dataset fingerprint, market provenance and research/execution configuration match."
        : "Missing or invalid provenance. This run is isolated and must not be compared with other runs.",
      runIds: orderedRuns.map((record) => record.id),
      bestHistorical,
      mostRobust,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { groups, nonComparableRunIds: nonComparableRunIds.sort() };
}
