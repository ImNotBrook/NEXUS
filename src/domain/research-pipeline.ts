import { validateCandles, type Candle } from "./candles";
import type { MarketExecutionConfig } from "./execution-model";
import { buildRegimeScorecard, type MarketRegimeConfig, type RegimeScorecard } from "./market-regimes";
import { buildStrategyScorecard, type StrategyScorecard } from "./strategy-scorecard";
import {
  evaluateWalkForward,
  type StrategyFactory,
  type WalkForwardEvaluationConfig,
  type WalkForwardEvaluationResult,
} from "./walk-forward-evaluation";

export interface ResearchCandidate {
  /** Stable, unique identifier; use a new ID when strategy logic or parameters change. */
  id: string;
  name: string;
  /** Factory is called independently for every training fold. */
  fit: StrategyFactory;
}

export interface ResearchPipelineConfig {
  folds: WalkForwardEvaluationConfig["folds"];
  backtest: WalkForwardEvaluationConfig["backtest"];
  /** When present, all folds use the candle-volume-aware partial-fill simulator. */
  executionModel?: MarketExecutionConfig;
  regime: MarketRegimeConfig;
}

export interface ResearchCandidateResult {
  id: string;
  name: string;
  evaluation: WalkForwardEvaluationResult;
  scorecard: StrategyScorecard;
  regimeScorecard: RegimeScorecard;
}

export interface ResearchDatasetMetadata {
  symbol: string;
  interval: string;
  provider: string;
}

export interface ResearchBatchResult {
  dataset: {
    candleCount: number;
    firstTimestamp: number;
    lastTimestamp: number;
    /** Non-cryptographic fingerprint for reproducibility checks, not security. */
    fingerprint: string;
    metadata?: ResearchDatasetMetadata;
  };
  config: ResearchPipelineConfig;
  candidateResults: ResearchCandidateResult[];
}

function fingerprintCandles(candles: readonly Candle[]): string {
  const serialized = JSON.stringify(candles);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Runs every candidate against the same chronological folds and execution
 * assumptions. It deliberately does not rank, select, tune, promote or execute
 * candidates. The caller must version candidate IDs when code/parameters change.
 */
export function runResearchBatch(
  inputCandles: readonly Candle[],
  candidates: readonly ResearchCandidate[],
  config: ResearchPipelineConfig,
  metadata?: ResearchDatasetMetadata,
): ResearchBatchResult {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new RangeError("At least one research candidate is required");
  }

  const candles = validateCandles(inputCandles);
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      throw new TypeError("Every candidate requires a non-empty stable ID");
    }
    if (ids.has(candidate.id)) throw new RangeError("Candidate IDs must be unique within a research batch");
    ids.add(candidate.id);
    if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
      throw new TypeError("Every candidate requires a non-empty name");
    }
    if (typeof candidate.fit !== "function") throw new TypeError("Every candidate requires a strategy factory");
  }

  const candidateResults = candidates.map((candidate): ResearchCandidateResult => {
    const evaluation = evaluateWalkForward(candles, {
      folds: config.folds,
      backtest: config.backtest,
      executionModel: config.executionModel,
      fit: candidate.fit,
    });
    return {
      id: candidate.id,
      name: candidate.name,
      evaluation,
      scorecard: buildStrategyScorecard(evaluation),
      regimeScorecard: buildRegimeScorecard(candles, evaluation, config.regime),
    };
  });

  return {
    dataset: {
      candleCount: candles.length,
      firstTimestamp: candles[0].timestamp,
      lastTimestamp: candles[candles.length - 1].timestamp,
      fingerprint: fingerprintCandles(candles),
      ...(metadata ? { metadata: { ...metadata } } : {}),
    },
    config: {
      folds: { ...config.folds },
      backtest: { ...config.backtest },
      ...(config.executionModel ? { executionModel: { ...config.executionModel } } : {}),
      regime: { ...config.regime },
    },
    candidateResults,
  };
}
