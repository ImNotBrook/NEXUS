import type { Candle } from "./candles";
import {
  runResearchBatch,
  type ResearchBatchResult,
  type ResearchCandidate,
  type ResearchPipelineConfig,
  type ResearchDatasetMetadata,
} from "./research-pipeline";
import { validateMarketExecutionConfig } from "./execution-model";

export interface ExecutionStressScenario {
  id: string;
  label: string;
  costMultiplier: number;
  participationMultiplier: number;
  report: ResearchBatchResult;
}

export interface ExecutionStressReport {
  datasetFingerprint: string;
  scenarioCount: number;
  scenarios: ExecutionStressScenario[];
  selectionWarning: string;
}

export interface ExecutionStressOptions {
  /** Optional bounded overrides for deterministic friction scenarios. */
  costMultipliers?: readonly number[];
  participationMultipliers?: readonly number[];
}

const DEFAULT_COST_MULTIPLIERS = [1, 1.5, 2, 3] as const;
const DEFAULT_PARTICIPATION_MULTIPLIERS = [0.5] as const;
const MAX_SCENARIOS = 8;
const SELECTION_WARNING =
  "Execution stress is a survivability diagnostic, not an optimisation grid. Do not select the best scenario or tune against these same out-of-sample results. " +
  "Real fills can be worse because candle-volume models omit order-book depth, latency, queue position and venue-specific liquidity.";

function validateMultipliers(values: readonly number[], label: string, minimum: number): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(label + " must be a non-empty array");
  }
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value) || value < minimum || value > 5) {
      throw new RangeError(label + " values must be finite and between " + minimum + " and 5");
    }
    if (seen.has(value)) throw new RangeError(label + " values must be unique");
    seen.add(value);
  }
}

/**
 * Replays identical candidates, candles and walk-forward folds under fixed
 * adverse execution assumptions. It never ranks or selects scenarios.
 */
export function runExecutionStressTest(
  candles: readonly Candle[],
  candidates: readonly ResearchCandidate[],
  config: ResearchPipelineConfig,
  options: ExecutionStressOptions,
  metadata?: ResearchDatasetMetadata,
): ExecutionStressReport {
  if (!options || typeof options !== "object") throw new TypeError("Execution stress options are required");
  const execution = config.executionModel;
  if (!execution) throw new RangeError("Execution stress requires an execution-aware pipeline");
  validateMarketExecutionConfig(execution);
  if (Math.abs(config.backtest.feeRate - execution.feeRate) > 1e-12 ||
      Math.abs(config.backtest.slippageBps - execution.baseSlippageBps) > 1e-12) {
    throw new RangeError("Backtest and execution-model fee/slippage assumptions must match");
  }

  const costMultipliers = options.costMultipliers ?? DEFAULT_COST_MULTIPLIERS;
  const participationMultipliers = options.participationMultipliers ?? DEFAULT_PARTICIPATION_MULTIPLIERS;
  validateMultipliers(costMultipliers, "costMultipliers", 1);
  validateMultipliers(participationMultipliers, "participationMultipliers", 0.05);
  const scenarioSpecs = [
    ...costMultipliers.map((costMultiplier) => ({
      id: costMultiplier === 1 ? "baseline" : "friction-" + String(costMultiplier).replace(".", "_") + "x",
      label: costMultiplier === 1 ? "Baseline execution" : costMultiplier + "× fees, slippage, spread and impact",
      costMultiplier,
      participationMultiplier: 1,
    })),
    ...participationMultipliers.map((participationMultiplier) => ({
      id: "capacity-" + String(participationMultiplier).replace(".", "_") + "x",
      label: participationMultiplier * 100 + "% of baseline participation capacity",
      costMultiplier: 1,
      participationMultiplier,
    })),
  ];
  if (scenarioSpecs.length > MAX_SCENARIOS) {
    throw new RangeError("Execution stress is limited to " + MAX_SCENARIOS + " scenarios");
  }
  if (!scenarioSpecs.some((scenario) => scenario.id === "baseline")) {
    throw new RangeError("Execution stress must include a 1× baseline cost scenario");
  }

  let datasetFingerprint: string | undefined;
  const scenarios: ExecutionStressScenario[] = scenarioSpecs.map((spec) => {
    const stressedExecution = {
      feeRate: execution.feeRate * spec.costMultiplier,
      baseSlippageBps: execution.baseSlippageBps * spec.costMultiplier,
      halfSpreadBps: execution.halfSpreadBps * spec.costMultiplier,
      maxParticipationRate: execution.maxParticipationRate * spec.participationMultiplier,
      marketImpactBpsAtMaxParticipation: execution.marketImpactBpsAtMaxParticipation * spec.costMultiplier,
    };
    validateMarketExecutionConfig(stressedExecution);
    const scenarioConfig: ResearchPipelineConfig = {
      ...config,
      folds: { ...config.folds },
      backtest: {
        ...config.backtest,
        feeRate: stressedExecution.feeRate,
        slippageBps: stressedExecution.baseSlippageBps,
        ...(config.backtest.protectiveOrders ? {
          protectiveOrders: { ...config.backtest.protectiveOrders },
        } : {}),
      },
      executionModel: stressedExecution,
      regime: { ...config.regime },
    };
    const report = runResearchBatch(candles, candidates, scenarioConfig, metadata);
    if (datasetFingerprint === undefined) datasetFingerprint = report.dataset.fingerprint;
    else if (datasetFingerprint !== report.dataset.fingerprint) {
      throw new Error("Execution stress scenarios did not use the same market dataset");
    }
    return { ...spec, report };
  });

  return {
    datasetFingerprint: datasetFingerprint!,
    scenarioCount: scenarios.length,
    scenarios,
    selectionWarning: SELECTION_WARNING,
  };
}
