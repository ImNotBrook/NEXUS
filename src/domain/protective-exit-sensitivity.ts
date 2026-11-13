import type { Candle } from "./candles";
import {
  runResearchBatch,
  type ResearchBatchResult,
  type ResearchCandidate,
  type ResearchPipelineConfig,
} from "./research-pipeline";

export interface ProtectiveExitSensitivityGrid {
  /** Empty means the disabled baseline only. Values are percentages, not fractions. */
  stopLossValuesPct: readonly number[];
  /** Empty means the disabled baseline only. Values are percentages, not fractions. */
  takeProfitValuesPct: readonly number[];
}

export interface ProtectiveExitSensitivityScenario {
  id: string;
  label: string;
  stopLossPct?: number;
  takeProfitPct?: number;
  report: ResearchBatchResult;
}

export interface ProtectiveExitSensitivityResult {
  datasetFingerprint: string;
  scenarioCount: number;
  scenarios: ProtectiveExitSensitivityScenario[];
  selectionWarning: string;
}

const MAX_SCENARIOS = 25;
const SELECTION_WARNING =
  "Exploratory sensitivity only: selecting the best stop/target on these same out-of-sample folds creates selection bias. " +
  "Treat this grid as robustness evidence, not an unbiased performance estimate. " +
  "Use nested walk-forward selection or a final untouched holdout before claiming selected-parameter performance.";

function validateAxis(values: readonly number[], label: string, upperExclusive?: number): void {
  if (!Array.isArray(values)) throw new TypeError(label + " must be an array");
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0 || (upperExclusive !== undefined && value >= upperExclusive)) {
      throw new RangeError(label + " values must be positive finite percentages" +
        (upperExclusive === undefined ? "" : " below " + upperExclusive));
    }
    if (seen.has(value)) throw new RangeError(label + " values must be unique");
    seen.add(value);
  }
}

function axis(values: readonly number[]): Array<number | undefined> {
  return [undefined, ...values];
}

function format(value: number | undefined): string {
  return value === undefined ? "off" : value + "%";
}

function scenarioId(stopLossPct: number | undefined, takeProfitPct: number | undefined): string {
  const token = (value: number | undefined): string =>
    value === undefined ? "off" : String(value).replace(".", "_");
  return "sl-" + token(stopLossPct) + "_tp-" + token(takeProfitPct);
}

/**
 * Re-runs the same candidate factories, data and walk-forward schedule across
 * a bounded Cartesian grid. No scenario is ranked or selected. Every result is
 * out-of-sample relative to its fold's training data, but selecting a parameter
 * using these same OOS results still introduces multiple-testing/selection bias.
 */
export function runProtectiveExitSensitivity(
  candles: readonly Candle[],
  candidates: readonly ResearchCandidate[],
  config: ResearchPipelineConfig,
  grid: ProtectiveExitSensitivityGrid,
): ProtectiveExitSensitivityResult {
  validateAxis(grid.stopLossValuesPct, "stopLossValuesPct", 100);
  validateAxis(grid.takeProfitValuesPct, "takeProfitValuesPct");

  const stops = axis(grid.stopLossValuesPct);
  const targets = axis(grid.takeProfitValuesPct);
  const scenarioCount = stops.length * targets.length;
  if (scenarioCount > MAX_SCENARIOS) {
    throw new RangeError("Sensitivity grid exceeds " + MAX_SCENARIOS + " scenarios; reduce stop/target values");
  }

  const scenarios: ProtectiveExitSensitivityScenario[] = [];
  let datasetFingerprint: string | undefined;
  for (const stopLossPct of stops) {
    for (const takeProfitPct of targets) {
      const protectiveOrders = stopLossPct === undefined && takeProfitPct === undefined
        ? undefined
        : {
          ...(stopLossPct === undefined ? {} : { stopLossPct }),
          ...(takeProfitPct === undefined ? {} : { takeProfitPct }),
        };
      const scenarioConfig: ResearchPipelineConfig = {
        ...config,
        folds: { ...config.folds },
        backtest: {
          ...config.backtest,
          ...(protectiveOrders ? { protectiveOrders } : {}),
        },
        ...(config.executionModel ? { executionModel: { ...config.executionModel } } : {}),
        regime: { ...config.regime },
      };
      if (!protectiveOrders) delete scenarioConfig.backtest.protectiveOrders;

      const report = runResearchBatch(candles, candidates, scenarioConfig);
      if (datasetFingerprint === undefined) datasetFingerprint = report.dataset.fingerprint;
      else if (datasetFingerprint !== report.dataset.fingerprint) {
        throw new Error("Sensitivity scenarios did not use the same market dataset");
      }
      scenarios.push({
        id: scenarioId(stopLossPct, takeProfitPct),
        label: "Stop " + format(stopLossPct) + " · target " + format(takeProfitPct),
        ...(stopLossPct === undefined ? {} : { stopLossPct }),
        ...(takeProfitPct === undefined ? {} : { takeProfitPct }),
        report,
      });
    }
  }

  return {
    datasetFingerprint: datasetFingerprint!,
    scenarioCount: scenarios.length,
    scenarios,
    selectionWarning: SELECTION_WARNING,
  };
}
