import type { StoredResearchRun } from "../adapters/research-run-store";
import { rankExecutionStressCandidates, type ExecutionStressCandidateRank } from "./execution-stress-ranking";
import type { ExecutionStressReport } from "./execution-stress-test";

export interface ExecutionStressFamilyMetadata {
  version: 1;
  familyId: string;
  scenarioId: string;
  scenarioIndex: number;
  scenarioCount: number;
  expectedScenarioIds: string[];
  label: string;
  costMultiplier: number;
  participationMultiplier: number;
}

export interface ExecutionStressFamilyResult {
  familyId: string;
  label: string;
  status: "COMPLETE";
  scenarioCount: number;
  runIds: string[];
  rankedCandidates: ExecutionStressCandidateRank[];
}

export interface ExecutionStressLeaderboard {
  families: ExecutionStressFamilyResult[];
  excludedFamilyIds: string[];
  unassignedRunIds: string[];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
}

function validMetadata(value: unknown): value is ExecutionStressFamilyMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as ExecutionStressFamilyMetadata;
  return item.version === 1 && typeof item.familyId === "string" && !!item.familyId.trim() &&
    typeof item.scenarioId === "string" && !!item.scenarioId.trim() &&
    Number.isSafeInteger(item.scenarioIndex) && item.scenarioIndex >= 0 &&
    Number.isSafeInteger(item.scenarioCount) && item.scenarioCount >= 1 && item.scenarioCount <= 8 &&
    Array.isArray(item.expectedScenarioIds) && item.expectedScenarioIds.length === item.scenarioCount &&
    item.expectedScenarioIds.every((id) => typeof id === "string" && !!id.trim()) &&
    new Set(item.expectedScenarioIds).size === item.expectedScenarioIds.length &&
    item.expectedScenarioIds[item.scenarioIndex] === item.scenarioId &&
    typeof item.label === "string" && !!item.label.trim() &&
    Number.isFinite(item.costMultiplier) && item.costMultiplier >= 1 &&
    Number.isFinite(item.participationMultiplier) && item.participationMultiplier > 0 &&
    item.participationMultiplier <= 1;
}

function sameCandidateManifest(a: StoredResearchRun, b: StoredResearchRun): boolean {
  return stable(a.report.candidateResults.map((item) => item.id)) ===
    stable(b.report.candidateResults.map((item) => item.id));
}

/** Rebuilds only complete, internally consistent scenario families; partial writes never rank. */
export function buildExecutionStressLeaderboard(records: readonly StoredResearchRun[]): ExecutionStressLeaderboard {
  const runIds = new Set<string>();
  const families = new Map<string, StoredResearchRun[]>();
  const unassignedRunIds: string[] = [];
  for (const record of records) {
    if (!record || typeof record.id !== "string" || !record.id.trim() || runIds.has(record.id)) {
      throw new TypeError("Execution stress leaderboard run IDs must be present and unique");
    }
    runIds.add(record.id);
    if (!validMetadata(record.stressFamily)) {
      unassignedRunIds.push(record.id);
      continue;
    }
    const bucket = families.get(record.stressFamily.familyId) ?? [];
    bucket.push(record);
    families.set(record.stressFamily.familyId, bucket);
  }

  const complete: ExecutionStressFamilyResult[] = [];
  const excludedFamilyIds: string[] = [];
  for (const [familyId, bucket] of families) {
    const first = bucket[0].stressFamily!;
    const byScenario = new Map<string, StoredResearchRun>();
    let valid = bucket.length === first.scenarioCount;
    for (const record of bucket) {
      const metadata = record.stressFamily!;
      if (!validMetadata(metadata) || metadata.familyId !== familyId ||
          metadata.scenarioCount !== first.scenarioCount ||
          stable(metadata.expectedScenarioIds) !== stable(first.expectedScenarioIds) ||
          metadata.label !== first.label || byScenario.has(metadata.scenarioId) ||
          record.report.dataset.fingerprint !== bucket[0].report.dataset.fingerprint ||
          stable(record.report.dataset.metadata) !== stable(bucket[0].report.dataset.metadata) ||
          record.report.dataset.candleCount !== bucket[0].report.dataset.candleCount ||
          record.report.dataset.firstTimestamp !== bucket[0].report.dataset.firstTimestamp ||
          record.report.dataset.lastTimestamp !== bucket[0].report.dataset.lastTimestamp ||
          !sameCandidateManifest(bucket[0], record)) {
        valid = false;
      }
      byScenario.set(metadata.scenarioId, record);
    }
    if (!valid || first.expectedScenarioIds.some((id) => !byScenario.has(id))) {
      excludedFamilyIds.push(familyId);
      continue;
    }
    const scenarios = first.expectedScenarioIds.map((scenarioId) => {
      const record = byScenario.get(scenarioId)!;
      const metadata = record.stressFamily!;
      return {
        id: metadata.scenarioId,
        label: metadata.label + " · " + metadata.scenarioId,
        costMultiplier: metadata.costMultiplier,
        participationMultiplier: metadata.participationMultiplier,
        report: record.report,
      };
    });
    const report = {
      datasetFingerprint: bucket[0].report.dataset.fingerprint,
      scenarioCount: scenarios.length,
      scenarios,
      selectionWarning: "Persisted scenario family; descriptive ranking only.",
    } as unknown as ExecutionStressReport;
    complete.push({
      familyId,
      label: first.label,
      status: "COMPLETE",
      scenarioCount: scenarios.length,
      runIds: first.expectedScenarioIds.map((id) => byScenario.get(id)!.id),
      rankedCandidates: rankExecutionStressCandidates(report),
    });
  }
  complete.sort((a, b) => a.label.localeCompare(b.label) || a.familyId.localeCompare(b.familyId));
  return {
    families: complete,
    excludedFamilyIds: excludedFamilyIds.sort(),
    unassignedRunIds: unassignedRunIds.sort(),
  };
}
