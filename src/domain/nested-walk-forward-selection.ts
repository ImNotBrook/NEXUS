import type { Candle } from "./candles";
import type { ResearchCandidate, ResearchPipelineConfig } from "./research-pipeline";
import type { ResearchCandidateResult, ResearchDatasetMetadata } from "./research-pipeline";
import { runResearchBatch } from "./research-pipeline";
import { buildWalkForwardFolds, type WalkForwardConfig } from "./walk-forward";
import { runProtectiveExitSensitivity, type ProtectiveExitSensitivityGrid } from "./protective-exit-sensitivity";
import type { StrategyScorecard } from "./strategy-scorecard";

export interface NestedWalkForwardConfig {
  /** Untouched outer evaluation windows. */
  outerFolds: WalkForwardConfig;
  /** Parameter-selection folds built strictly inside each outer training window. */
  innerFolds: WalkForwardConfig;
  grid: ProtectiveExitSensitivityGrid;
  /** Scenarios below this inner OOS trade count are ineligible. Defaults to 1. */
  minimumInnerTrades?: number;
}

export interface NestedInnerSelectionSummary {
  foldCount: number;
  compoundedReturnPct: number;
  meanFoldReturnPct: number;
  worstFoldDrawdownPct: number;
  completedTrades: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
}

export interface NestedCandidateOuterFold {
  outerFoldIndex: number;
  trainStartTimestamp: number;
  trainEndTimestamp: number;
  testStartTimestamp: number;
  testEndTimestamp: number;
  selectedStopLossPct?: number;
  selectedTakeProfitPct?: number;
  selectionReason: string;
  innerSelection: NestedInnerSelectionSummary;
  outerEvaluation: ResearchCandidateResult;
}

export interface NestedCandidateResult {
  id: string;
  name: string;
  folds: NestedCandidateOuterFold[];
  compoundedOuterReturnPct: number;
  meanOuterReturnPct: number;
  worstOuterFoldDrawdownPct: number;
  totalOuterCompletedTrades: number;
  parameterStability: Array<{
    stopLossPct?: number;
    takeProfitPct?: number;
    outerFoldCount: number;
  }>;
}

export interface NestedWalkForwardResult {
  datasetFingerprint: string;
  outerFoldCount: number;
  candidateResults: NestedCandidateResult[];
  selectionWarning: string;
}

const SELECTION_WARNING =
  "Nested selection reduces direct parameter-selection leakage: each configuration is selected only from inner OOS folds inside the corresponding outer training window, then frozen before the outer test. " +
  "Outer test results must not be used to revise the grid, metric, trade threshold, candidate set or strategy design. " +
  "Repeatedly inspecting outer results and changing the research process creates a new layer of selection bias; preserve a final untouched holdout for final claims.";

function validateMinimumTrades(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("minimumInnerTrades must be a non-negative safe integer");
  }
}

function scenarioKey(stopLossPct: number | undefined, takeProfitPct: number | undefined): string {
  return (stopLossPct === undefined ? "off" : String(stopLossPct)) + "|" +
    (takeProfitPct === undefined ? "off" : String(takeProfitPct));
}

function summarizeInner(scorecard: StrategyScorecard): NestedInnerSelectionSummary {
  return {
    foldCount: scorecard.foldCount,
    compoundedReturnPct: 0,
    meanFoldReturnPct: scorecard.meanFoldReturnPct ?? 0,
    worstFoldDrawdownPct: scorecard.worstFoldDrawdownPct ?? 0,
    completedTrades: scorecard.completedTrades,
    profitFactor: scorecard.profitFactor,
    expectancyPerTrade: scorecard.expectancyPerTrade,
  };
}

/**
 * Performs candidate-specific stop/target selection inside each outer training
 * window. Inner OOS results select parameters; a single subsequent outer test
 * evaluates the frozen choice. Outer test candles are never passed to the
 * sensitivity runner or to its strategy factories.
 */
export function runNestedWalkForwardSelection(
  inputCandles: readonly Candle[],
  candidates: readonly ResearchCandidate[],
  pipeline: ResearchPipelineConfig,
  config: NestedWalkForwardConfig,
  metadata?: ResearchDatasetMetadata,
): NestedWalkForwardResult {
  const minimumInnerTrades = config.minimumInnerTrades ?? 1;
  validateMinimumTrades(minimumInnerTrades);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new RangeError("At least one research candidate is required");
  }

  const outerFolds = buildWalkForwardFolds(inputCandles, config.outerFolds);
  const candidateFolds = new Map<string, NestedCandidateOuterFold[]>();
  const candidateNames = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim() ||
        typeof candidate.name !== "string" || !candidate.name.trim() || typeof candidate.fit !== "function") {
      throw new TypeError("Every candidate requires a stable ID, name and strategy factory");
    }
    if (candidateFolds.has(candidate.id)) throw new RangeError("Candidate IDs must be unique");
    candidateFolds.set(candidate.id, []);
    candidateNames.set(candidate.id, candidate.name);
  }

  for (const outerFold of outerFolds) {
    // This validation also proves that the outer training window can support
    // at least one complete inner train/embargo/test fold.
    buildWalkForwardFolds(outerFold.train, config.innerFolds);

    const innerPipeline: ResearchPipelineConfig = {
      ...pipeline,
      folds: { ...config.innerFolds },
      backtest: { ...pipeline.backtest },
      ...(pipeline.executionModel ? { executionModel: { ...pipeline.executionModel } } : {}),
      regime: { ...pipeline.regime },
    };
    const inner = runProtectiveExitSensitivity(
      outerFold.train,
      candidates,
      innerPipeline,
      config.grid,
      metadata,
    );

    const outerSeries = [...outerFold.train, ...outerFold.embargo, ...outerFold.test];
    const outerPipelineBase: ResearchPipelineConfig = {
      ...pipeline,
      folds: {
        trainBars: outerFold.train.length,
        testBars: outerFold.test.length,
        stepBars: outerFold.test.length,
        embargoBars: outerFold.embargo.length,
        expanding: true,
      },
      backtest: { ...pipeline.backtest },
      ...(pipeline.executionModel ? { executionModel: { ...pipeline.executionModel } } : {}),
      regime: { ...pipeline.regime },
    };

    for (const candidate of candidates) {
      const eligible = inner.scenarios
        .map((scenario) => ({
          scenario,
          result: scenario.report.candidateResults.find((item) => item.id === candidate.id),
        }))
        .filter((item): item is { scenario: typeof inner.scenarios[number]; result: ResearchCandidateResult } =>
          item.result !== undefined && item.result.scorecard.completedTrades >= minimumInnerTrades)
        .sort((a, b) => {
          const returnDelta = b.result.evaluation.compoundedReturnPct - a.result.evaluation.compoundedReturnPct;
          if (Math.abs(returnDelta) > 1e-12) return returnDelta;
          const drawdownDelta = (a.result.scorecard.worstFoldDrawdownPct ?? Number.POSITIVE_INFINITY) -
            (b.result.scorecard.worstFoldDrawdownPct ?? Number.POSITIVE_INFINITY);
          if (Math.abs(drawdownDelta) > 1e-12) return drawdownDelta;
          // Stable scenario order makes exact ties deterministic; baseline is first.
          return 0;
        });

      const selected = eligible[0];
      const baseline = inner.scenarios[0];
      const chosenScenario = selected?.scenario ?? baseline;
      const chosenScorecard = selected?.result.scorecard ?? baseline.report.candidateResults.find((item) => item.id === candidate.id)!.scorecard;
      const protectiveOrders = chosenScenario.stopLossPct === undefined && chosenScenario.takeProfitPct === undefined
        ? undefined
        : {
          ...(chosenScenario.stopLossPct === undefined ? {} : { stopLossPct: chosenScenario.stopLossPct }),
          ...(chosenScenario.takeProfitPct === undefined ? {} : { takeProfitPct: chosenScenario.takeProfitPct }),
        };
      const outerPipeline: ResearchPipelineConfig = {
        ...outerPipelineBase,
        backtest: {
          ...outerPipelineBase.backtest,
          ...(protectiveOrders ? { protectiveOrders } : {}),
        },
      };
      if (!protectiveOrders) delete outerPipeline.backtest.protectiveOrders;

      const outerReport = runResearchBatch(
        outerSeries,
        [candidate],
        outerPipeline,
        metadata,
      );
      const outerEvaluation = outerReport.candidateResults[0];
      const folds = candidateFolds.get(candidate.id)!;
      folds.push({
        outerFoldIndex: outerFold.index,
        trainStartTimestamp: outerFold.train[0].timestamp,
        trainEndTimestamp: outerFold.train[outerFold.train.length - 1].timestamp,
        testStartTimestamp: outerFold.test[0].timestamp,
        testEndTimestamp: outerFold.test[outerFold.test.length - 1].timestamp,
        ...(chosenScenario.stopLossPct === undefined ? {} : { selectedStopLossPct: chosenScenario.stopLossPct }),
        ...(chosenScenario.takeProfitPct === undefined ? {} : { selectedTakeProfitPct: chosenScenario.takeProfitPct }),
        selectionReason: selected
          ? "Selected by highest inner compounded OOS return, then lower worst-fold drawdown; exact ties retain the baseline-first grid order."
          : "No inner scenario met the minimum trade requirement; disabled protective-exit baseline retained.",
        innerSelection: {
          ...summarizeInner(chosenScorecard),
          compoundedReturnPct: selected?.result.evaluation.compoundedReturnPct ?? 0,
        },
        outerEvaluation,
      });
    }
  }

  const candidateResults: NestedCandidateResult[] = candidates.map((candidate) => {
    const folds = candidateFolds.get(candidate.id)!;
    const returns = folds.map((fold) => fold.outerEvaluation.evaluation.compoundedReturnPct);
    const growth = returns.reduce((value, result) => value * (1 + result / 100), 1);
    const stability = new Map<string, { stopLossPct?: number; takeProfitPct?: number; outerFoldCount: number }>();
    for (const fold of folds) {
      const key = scenarioKey(fold.selectedStopLossPct, fold.selectedTakeProfitPct);
      const current = stability.get(key) ?? {
        ...(fold.selectedStopLossPct === undefined ? {} : { stopLossPct: fold.selectedStopLossPct }),
        ...(fold.selectedTakeProfitPct === undefined ? {} : { takeProfitPct: fold.selectedTakeProfitPct }),
        outerFoldCount: 0,
      };
      current.outerFoldCount += 1;
      stability.set(key, current);
    }
    return {
      id: candidate.id,
      name: candidateNames.get(candidate.id)!,
      folds,
      compoundedOuterReturnPct: (growth - 1) * 100,
      meanOuterReturnPct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0,
      worstOuterFoldDrawdownPct: Math.max(...folds.map((fold) => fold.outerEvaluation.scorecard.worstFoldDrawdownPct ?? 0)),
      totalOuterCompletedTrades: folds.reduce((sum, fold) => sum + fold.outerEvaluation.scorecard.completedTrades, 0),
      parameterStability: [...stability.values()],
    };
  });

  return {
    datasetFingerprint: innerFingerprint(inputCandles),
    outerFoldCount: outerFolds.length,
    candidateResults,
    selectionWarning: SELECTION_WARNING,
  };
}

function innerFingerprint(candles: readonly Candle[]): string {
  // Use the same deterministic dataset fingerprint as research reports.
  const serialized = JSON.stringify(candles);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0");
}
