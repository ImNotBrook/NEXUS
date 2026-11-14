import { describe, expect, it } from "vitest";
import {
  STRATEGY_TEMPLATE_CATALOG,
  createStrategyDefinition,
  createResearchCandidateFromDefinition,
  buildStrategyParameterTrials,
  validateStrategyDefinition,
} from "./strategy-studio";
import type { StrategyDefinition } from "./strategy-studio";

const base: StrategyDefinition = {
  schemaVersion: 1,
  id: "my-sma-system",
  version: "1.0.0",
  name: "My SMA system",
  family: "sma-crossover",
  parameters: { fastPeriod: 8, slowPeriod: 24 },
  createdAt: 1_800_000_000_000,
  origin: "human",
  description: "Test crossover definition",
};

describe("Strategy Studio domain contract", () => {
  it("publishes validated reusable templates with unique IDs", () => {
    expect(STRATEGY_TEMPLATE_CATALOG.map((item) => item.id)).toEqual([
      "sma-crossover", "rsi-mean-reversion", "donchian-breakout",
    ]);
    expect(new Set(STRATEGY_TEMPLATE_CATALOG.map((item) => item.id)).size)
      .toBe(STRATEGY_TEMPLATE_CATALOG.length);
    for (const template of STRATEGY_TEMPLATE_CATALOG) {
      expect(validateStrategyDefinition(template.definition).valid).toBe(true);
    }
  });

  it("creates deeply immutable, validated definitions", () => {
    const definition = createStrategyDefinition(base);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.parameters)).toBe(true);
    expect(definition).toEqual(base);
    expect(() => createStrategyDefinition({ ...base, parameters: { fastPeriod: 24, slowPeriod: 8 } }))
      .toThrow(/fastPeriod/);
  });

  it("rejects unsupported schema, invalid versions, parameters and timestamps", () => {
    expect(validateStrategyDefinition({ ...base, schemaVersion: 2 }).valid).toBe(false);
    expect(validateStrategyDefinition({ ...base, version: "1.0" }).valid).toBe(false);
    expect(validateStrategyDefinition({ ...base, parameters: { fastPeriod: 8, slowPeriod: 8 } }).valid).toBe(false);
    expect(validateStrategyDefinition({ ...base, createdAt: -1 }).valid).toBe(false);
    expect(validateStrategyDefinition({ ...base, parameters: { fastPeriod: 8, slowPeriod: 24, hidden: 1 } }).valid).toBe(false);
  });

  it("maps a reviewed definition into a stable research candidate without execution side effects", () => {
    const first = createResearchCandidateFromDefinition(base);
    const second = createResearchCandidateFromDefinition({ ...base, parameters: { slowPeriod: 24, fastPeriod: 8 } });
    expect(first.id).toBe("my-sma-system@1.0.0");
    expect(first.id).toBe(second.id);
    expect(first.name).toBe("My SMA system");
    expect(first.fit).not.toBe(second.fit);
  });

  it("builds deterministic bounded parameter trials and records the full trial count", () => {
    const first = buildStrategyParameterTrials(base, {
      fastPeriod: [6, 8, 10],
      slowPeriod: [20, 24],
    });
    const second = buildStrategyParameterTrials(base, {
      slowPeriod: [20, 24],
      fastPeriod: [6, 8, 10],
    });
    expect(first.trialCount).toBe(6);
    expect(first.candidates.map((candidate) => candidate.id))
      .toEqual(second.candidates.map((candidate) => candidate.id));
    expect(first.candidates).toHaveLength(first.trialCount);
    expect(first.manifest.trialIds).toEqual(first.candidates.map((candidate) => candidate.id));
    expect(first.manifest.selectionBiasWarning).toContain("multiple");
  });

  it("rejects duplicate values, invalid parameter combinations and grids above the mobile cap", () => {
    expect(() => buildStrategyParameterTrials(base, { fastPeriod: [8, 8] })).toThrow(/duplicate/);
    expect(() => buildStrategyParameterTrials(base, { fastPeriod: [24] })).toThrow(/fastPeriod/);
    expect(() => buildStrategyParameterTrials(base, {
      fastPeriod: [4, 6, 8, 10, 12, 14],
      slowPeriod: [20, 22, 24, 26, 28],
    })).toThrow(/25/);
  });

  it("does not mutate the source definition or parameter grid", () => {
    const definition = structuredClone(base);
    const grid = { fastPeriod: [6, 8], slowPeriod: [20, 24] };
    buildStrategyParameterTrials(definition, grid);
    expect(definition).toEqual(base);
    expect(grid).toEqual({ fastPeriod: [6, 8], slowPeriod: [20, 24] });
  });
});
