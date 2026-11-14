import { validateCandles, type Candle } from "./candles";
import type { ResearchCandidate, ResearchDatasetMetadata, ResearchPipelineConfig, ResearchBatchResult } from "./research-pipeline";
import { runResearchBatch } from "./research-pipeline";

export interface SealedHoldoutIdentity {
  symbol: string;
  interval: string;
  startTimestamp: number;
  endTimestamp: number;
}

export interface SealedHoldoutPlan {
  identity: SealedHoldoutIdentity;
  provider: string;
  fullDatasetFingerprint: string;
  developmentFingerprint: string;
  holdoutFingerprint: string;
  developmentCandles: readonly Candle[];
  embargoCandles: readonly Candle[];
  holdoutCandles: readonly Candle[];
}

export interface SealedHoldoutSeal {
  protocol: "NEXUS_FINAL_HOLDOUT_V1";
  identity: SealedHoldoutIdentity;
  provider: string;
  datasetFingerprint: string;
  developmentFingerprint: string;
  holdoutFingerprint: string;
  candidateIds: string[];
  candidateFingerprint: string;
  pipelineFingerprint: string;
  developmentBars: number;
  embargoBars: number;
  holdoutBars: number;
  fraction: number;
}

export interface SealedHoldoutEvaluation {
  seal: SealedHoldoutSeal;
  report: ResearchBatchResult;
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0");
}

export function prepareSealedHoldout(
  inputCandles: readonly Candle[],
  metadata: ResearchDatasetMetadata,
  fraction = 0.2,
  embargoBars = 2,
): SealedHoldoutPlan {
  if (!metadata || typeof metadata.symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(metadata.symbol) ||
      typeof metadata.interval !== "string" || !metadata.interval.trim() ||
      typeof metadata.provider !== "string" || !metadata.provider.trim()) {
    throw new TypeError("Valid symbol, interval and provider metadata are required");
  }
  if (!Number.isFinite(fraction) || fraction < 0.1 || fraction > 0.3) {
    throw new RangeError("Final holdout fraction must be between 10% and 30%");
  }
  if (!Number.isSafeInteger(embargoBars) || embargoBars < 1 || embargoBars > 20) {
    throw new RangeError("Holdout embargo must be between 1 and 20 candles");
  }
  const candles = validateCandles(inputCandles);
  const holdoutBars = Math.floor(candles.length * fraction);
  const developmentBars = candles.length - holdoutBars - embargoBars;
  if (developmentBars < 100 || holdoutBars < 20) {
    throw new RangeError("Insufficient history: require at least 100 development candles and 20 final holdout candles");
  }
  const developmentCandles = candles.slice(0, developmentBars);
  const embargoCandles = candles.slice(developmentBars, developmentBars + embargoBars);
  const holdoutCandles = candles.slice(developmentBars + embargoBars);
  const identity: SealedHoldoutIdentity = {
    symbol: metadata.symbol,
    interval: metadata.interval,
    startTimestamp: holdoutCandles[0].timestamp,
    endTimestamp: holdoutCandles[holdoutCandles.length - 1].timestamp,
  };
  return {
    identity,
    provider: metadata.provider,
    fullDatasetFingerprint: fingerprint(candles),
    developmentFingerprint: fingerprint(developmentCandles),
    holdoutFingerprint: fingerprint(holdoutCandles),
    developmentCandles: Object.freeze(developmentCandles.map((candle) => Object.freeze({ ...candle }))),
    embargoCandles: Object.freeze(embargoCandles.map((candle) => Object.freeze({ ...candle }))),
    holdoutCandles: Object.freeze(holdoutCandles.map((candle) => Object.freeze({ ...candle }))),
  };
}

/**
 * Fits on the development segment only, skips the explicit embargo, and
 * evaluates exactly one disjoint final test window. This is a one-shot
 * diagnostic; it does not claim statistical significance or future edge.
 */
export function evaluateSealedHoldout(
  plan: SealedHoldoutPlan,
  candidates: readonly ResearchCandidate[],
  pipeline: ResearchPipelineConfig,
  fraction = 0.2,
): SealedHoldoutEvaluation {
  if (!plan || !Array.isArray(plan.developmentCandles) || !Array.isArray(plan.embargoCandles) ||
      !Array.isArray(plan.holdoutCandles)) {
    throw new TypeError("A prepared final holdout plan is required");
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new RangeError("At least one frozen strategy candidate is required");
  }
  const candidateIds = candidates.map((candidate) => candidate.id);
  if (candidateIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("Frozen candidates require unique stable IDs");
  }
  const candidateFingerprint = fingerprint(candidates.map((candidate) => ({
    id: candidate.id, name: candidate.name, factorySource: candidate.fit.toString(),
  })));
  const pipelineFingerprint = fingerprint(pipeline);
  const series = [...plan.developmentCandles, ...plan.embargoCandles, ...plan.holdoutCandles];
  const report = runResearchBatch(series, candidates, {
    ...pipeline,
    folds: {
      trainBars: plan.developmentCandles.length,
      testBars: plan.holdoutCandles.length,
      stepBars: plan.holdoutCandles.length,
      embargoBars: plan.embargoCandles.length,
      expanding: true,
    },
  }, {
    symbol: plan.identity.symbol,
    interval: plan.identity.interval,
    provider: plan.provider,
  });
  if (report.candidateResults.some((candidate) => candidate.evaluation.foldCount !== 1)) {
    throw new Error("Final holdout must produce exactly one test fold per candidate");
  }
  return {
    seal: {
      protocol: "NEXUS_FINAL_HOLDOUT_V1",
      identity: { ...plan.identity },
      provider: plan.provider,
      datasetFingerprint: plan.fullDatasetFingerprint,
      developmentFingerprint: plan.developmentFingerprint,
      holdoutFingerprint: plan.holdoutFingerprint,
      candidateIds,
      candidateFingerprint,
      pipelineFingerprint,
      developmentBars: plan.developmentCandles.length,
      embargoBars: plan.embargoCandles.length,
      holdoutBars: plan.holdoutCandles.length,
      fraction,
    },
    report,
  };
}
