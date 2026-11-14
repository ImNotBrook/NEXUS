import type { ResearchCandidate } from "./research-pipeline";
import {
  createDonchianBreakout,
  createRsiMeanReversion,
  createSmaCrossover,
} from "../strategies/baseline-strategies";

export const STRATEGY_DEFINITION_SCHEMA_VERSION = 1 as const;
export const STRATEGY_TRIAL_GENERATOR_VERSION = "1.0.0";
export const STRATEGY_TRIAL_LIMIT = 25;

export type StrategyFamily = "sma-crossover" | "rsi-mean-reversion" | "donchian-breakout";
export type StrategyOrigin = "human" | "template" | "ai-proposal";

export type StrategyParameters =
  | { fastPeriod: number; slowPeriod: number }
  | { period: number; oversold: number; overbought: number }
  | { period: number };

export interface StrategyDefinition {
  schemaVersion: typeof STRATEGY_DEFINITION_SCHEMA_VERSION;
  id: string;
  version: string;
  name: string;
  family: StrategyFamily;
  parameters: StrategyParameters;
  createdAt: number;
  origin: StrategyOrigin;
  description: string;
}

export interface StrategyTemplate {
  id: StrategyFamily;
  name: string;
  description: string;
  definition: StrategyDefinition;
}

export interface StrategyDefinitionValidation {
  valid: boolean;
  reasons: string[];
}

export interface StrategyTrialManifest {
  generatorVersion: string;
  baseStrategyId: string;
  baseVersion: string;
  trialCount: number;
  trialIds: string[];
  parameterGrid: Readonly<Record<string, readonly number[]>>;
  selectionBiasWarning: string;
}

export interface StrategyTrialSet {
  trialCount: number;
  candidates: ResearchCandidate[];
  definitions: StrategyDefinition[];
  manifest: StrategyTrialManifest;
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\\.(0|[1-9]\d*)\\.(0|[1-9]\d*)$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function finiteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validCommon(definition: StrategyDefinition): string[] {
  const reasons: string[] = [];
  if (definition.schemaVersion !== STRATEGY_DEFINITION_SCHEMA_VERSION) reasons.push("Unsupported strategy schema version");
  if (typeof definition.id !== "string" || !ID_PATTERN.test(definition.id)) reasons.push("Strategy ID must be a lowercase kebab-case identifier");
  if (typeof definition.version !== "string" || !VERSION_PATTERN.test(definition.version)) reasons.push("Strategy version must use semantic versioning");
  if (typeof definition.name !== "string" || !definition.name.trim() || definition.name.length > 80) reasons.push("Strategy name is required and limited to 80 characters");
  if (!Number.isSafeInteger(definition.createdAt) || definition.createdAt < 0) reasons.push("Creation timestamp must be a non-negative safe integer");
  if (!["human", "template", "ai-proposal"].includes(definition.origin)) reasons.push("Unknown strategy origin");
  if (typeof definition.description !== "string" || definition.description.length > 500) reasons.push("Description is required and limited to 500 characters");
  return reasons;
}

export function validateStrategyDefinition(input: unknown): StrategyDefinitionValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, reasons: ["Strategy definition must be an object"] };
  }
  const definition = input as StrategyDefinition;
  const reasons = validCommon(definition);
  const parameters = definition.parameters as Record<string, unknown> | undefined;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    reasons.push("Strategy parameters must be an object");
  } else if (definition.family === "sma-crossover") {
    if (Object.keys(parameters).sort().join(",") !== "fastPeriod,slowPeriod" ||
        !finiteInteger(parameters.fastPeriod, 2, 100) ||
        !finiteInteger(parameters.slowPeriod, 3, 300) ||
        (parameters.fastPeriod as number) >= (parameters.slowPeriod as number)) {
      reasons.push("SMA parameters require fastPeriod 2–100, slowPeriod 3–300 and fastPeriod less than slowPeriod");
    }
  } else if (definition.family === "rsi-mean-reversion") {
    if (Object.keys(parameters).sort().join(",") !== "overbought,oversold,period" ||
        !finiteInteger(parameters.period, 2, 100) ||
        !finiteInteger(parameters.oversold, 5, 45) ||
        !finiteInteger(parameters.overbought, 55, 95) ||
        (parameters.oversold as number) >= (parameters.overbought as number)) {
      reasons.push("RSI parameters require period 2–100, oversold 5–45, overbought 55–95 and oversold less than overbought");
    }
  } else if (definition.family === "donchian-breakout") {
    if (Object.keys(parameters).sort().join(",") !== "period" || !finiteInteger(parameters.period, 2, 300)) {
      reasons.push("Donchian period must be an integer from 2 to 300");
    }
  } else {
    reasons.push("Unsupported strategy family");
  }
  return { valid: reasons.length === 0, reasons };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Validates and returns a detached immutable strategy definition. */
export function createStrategyDefinition(input: StrategyDefinition): Readonly<StrategyDefinition> {
  const detached = structuredClone(input);
  const assessment = validateStrategyDefinition(detached);
  if (!assessment.valid) throw new TypeError("Invalid strategy definition: " + assessment.reasons.join("; "));
  return deepFreeze(detached);
}

export const STRATEGY_TEMPLATE_CATALOG: readonly StrategyTemplate[] = deepFreeze([
  {
    id: "sma-crossover",
    name: "SMA trend crossover",
    description: "Long-only moving-average crossover baseline using completed candle closes.",
    definition: {
      schemaVersion: 1, id: "template-sma-crossover", version: "1.0.0",
      name: "SMA crossover", family: "sma-crossover",
      parameters: { fastPeriod: 10, slowPeriod: 30 }, createdAt: 0,
      origin: "template", description: "Long-only moving-average crossover baseline.",
    },
  },
  {
    id: "rsi-mean-reversion",
    name: "RSI mean reversion",
    description: "Wilder RSI threshold-cross strategy; thresholds are explicit and bounded.",
    definition: {
      schemaVersion: 1, id: "template-rsi-mean-reversion", version: "1.0.0",
      name: "RSI mean reversion", family: "rsi-mean-reversion",
      parameters: { period: 14, oversold: 30, overbought: 70 }, createdAt: 0,
      origin: "template", description: "RSI threshold-cross mean-reversion baseline.",
    },
  },
  {
    id: "donchian-breakout",
    name: "Donchian breakout",
    description: "Breakout from the prior rolling high/low channel, excluding the current candle.",
    definition: {
      schemaVersion: 1, id: "template-donchian-breakout", version: "1.0.0",
      name: "Donchian breakout", family: "donchian-breakout",
      parameters: { period: 20 }, createdAt: 0,
      origin: "template", description: "Prior-channel Donchian breakout baseline.",
    },
  },
]);

export function createResearchCandidateFromDefinition(definitionInput: StrategyDefinition): ResearchCandidate {
  const definition = createStrategyDefinition(definitionInput);
  let fit: ResearchCandidate["fit"];
  switch (definition.family) {
    case "sma-crossover":
      fit = () => createSmaCrossover({ ...definition.parameters as { fastPeriod: number; slowPeriod: number } });
      break;
    case "rsi-mean-reversion":
      fit = () => createRsiMeanReversion({ ...definition.parameters as { period: number; oversold: number; overbought: number } });
      break;
    case "donchian-breakout":
      fit = () => createDonchianBreakout({ ...definition.parameters as { period: number } });
      break;
  }
  return {
    id: definition.id + "@" + definition.version,
    name: definition.name,
    fit,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

/**
 * Creates a deterministic, bounded Cartesian trial set. This records the full
 * number of trials and explicitly warns that selecting the best trial on the
 * same OOS sample creates multiple-testing/selection bias.
 */
export function buildStrategyParameterTrials(
  baseInput: StrategyDefinition,
  gridInput: Readonly<Record<string, readonly number[]>>,
): StrategyTrialSet {
  const base = createStrategyDefinition(baseInput);
  if (!gridInput || typeof gridInput !== "object" || Array.isArray(gridInput)) {
    throw new TypeError("A parameter grid is required");
  }
  const allowed = Object.keys(base.parameters).sort();
  const keys = Object.keys(gridInput).sort();
  if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) {
    throw new RangeError("Parameter grid must contain one or more parameters from the selected strategy family");
  }
  const grid: Record<string, number[]> = {};
  let trialCount = 1;
  for (const key of keys) {
    const values = gridInput[key];
    if (!Array.isArray(values) || values.length === 0 ||
        values.some((value) => !Number.isFinite(value)) ||
        new Set(values).size !== values.length) {
      throw new RangeError("Parameter grid values must be non-empty, finite and contain no duplicate values");
    }
    grid[key] = [...values];
    trialCount *= values.length;
    if (!Number.isSafeInteger(trialCount) || trialCount > STRATEGY_TRIAL_LIMIT) {
      throw new RangeError("Parameter grid exceeds the mobile trial limit of " + STRATEGY_TRIAL_LIMIT);
    }
  }

  const definitions: StrategyDefinition[] = [];
  const candidates: ResearchCandidate[] = [];
  const valuesFor = (index: number): Record<string, number> => {
    const selected: Record<string, number> = {};
    let remainder = index;
    for (let cursor = keys.length - 1; cursor >= 0; cursor -= 1) {
      const key = keys[cursor];
      const values = grid[key];
      selected[key] = values[remainder % values.length];
      remainder = Math.floor(remainder / values.length);
    }
    return selected;
  };

  for (let index = 0; index < trialCount; index += 1) {
    const parameters = { ...base.parameters, ...valuesFor(index) } as StrategyParameters;
    const definition = createStrategyDefinition({
      ...base,
      version: base.version,
      parameters,
    });
    const parameterHash = hash(canonical(parameters));
    const trialId = base.id + "@" + base.version + "#trial-" + String(index + 1).padStart(2, "0") + "-" + parameterHash;
    definitions.push(definition);
    candidates.push({
      id: trialId,
      name: base.name + " · trial " + (index + 1),
      fit: createResearchCandidateFromDefinition(definition).fit,
    });
  }

  const trialIds = candidates.map((candidate) => candidate.id);
  return {
    trialCount,
    candidates,
    definitions,
    manifest: deepFreeze({
      generatorVersion: STRATEGY_TRIAL_GENERATOR_VERSION,
      baseStrategyId: base.id,
      baseVersion: base.version,
      trialCount,
      trialIds,
      parameterGrid: grid,
      selectionBiasWarning: "Selecting the best of multiple parameter trials on the same out-of-sample data creates multiple-testing and selection bias. Use nested walk-forward selection or a fresh sealed holdout for independent confirmation.",
    }),
  };
}
