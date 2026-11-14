import { describe, expect, it } from "vitest";
import type { AiStrategyProposal } from "./ai-strategy-proposals";
import {
  createHumanReviewedComposedStrategyDefinition,
  createHumanReviewedStrategyDefinition,
  parseAutomatedResearchAiArtifact,
} from "./ai-strategy-review";

const proposal: AiStrategyProposal = {
  family: "sma-crossover",
  parameters: { fastPeriod: 8, slowPeriod: 24 },
  rationale: "Tests a faster trend trigger against a slower baseline.",
};

const artifact = {
  schemaVersion: 1,
  createdAt: "2026-11-14T00:00:00.000Z",
  symbol: "BTCUSDT",
  interval: "1h",
  aiGeneration: {
    status: "generated",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    proposals: [proposal],
    composedStrategies: [{
      schemaVersion: 1,
      id: "trend-pullback-confirmed",
      name: "Trend pullback confirmation",
      marketHypothesis: "Momentum recovery after a pullback may resume an established trend.",
      regimeScope: "uptrend",
      timeframe: "1h",
      entry: { trigger: { type: "rsi_recovery", period: 14, oversold: 30 }, confirmations: [{ type: "ema_alignment", fastPeriod: 10, slowPeriod: 30 }] },
      exit: { type: "rsi_overbought", period: 14, threshold: 70 },
      invalidation: "A loss of bullish EMA alignment invalidates the trend continuation hypothesis.",
    }],
    attempts: [{ provider: "groq", status: "generated" }],
  },
};

describe("AI strategy review boundary", () => {
  it("parses only a successful, versioned automated-research AI artifact", () => {
    const parsed = parseAutomatedResearchAiArtifact(artifact);
    expect(parsed.provider).toBe("groq");
    expect(parsed.model).toBe("openai/gpt-oss-120b");
    expect(parsed.symbol).toBe("BTCUSDT");
    expect(parsed.proposals).toEqual([proposal]);
    expect(parsed.composedStrategies).toHaveLength(1);
  });

  it("rejects deterministic fallback artifacts and malformed proposals", () => {
    expect(() => parseAutomatedResearchAiArtifact({
      ...artifact, aiGeneration: { ...artifact.aiGeneration, status: "fallback", proposals: [] },
    })).toThrow(/AI-generated proposals/);
    expect(() => parseAutomatedResearchAiArtifact({
      ...artifact, aiGeneration: { ...artifact.aiGeneration, proposals: [{ ...proposal, parameters: { fastPeriod: 40, slowPeriod: 8 } }] },
    })).toThrow();
    expect(() => parseAutomatedResearchAiArtifact({ ...artifact, schemaVersion: 2 })).toThrow(/schema/i);
  });

  it("creates a deterministic, validated human-reviewed version only when approval time is supplied", () => {
    const parsed = parseAutomatedResearchAiArtifact(artifact);
    const first = createHumanReviewedStrategyDefinition(parsed.proposals[0], 1_800_000_000_000, parsed);
    const second = createHumanReviewedStrategyDefinition(parsed.proposals[0], 1_800_000_000_000, parsed);
    expect(first).toEqual(second);
    expect(first.id).toMatch(/^ai-sma-crossover-[a-f0-9]{8}$/);
    expect(first.version).toBe("1.0.0");
    expect(first.origin).toBe("human");
    expect(first.parameters).toEqual(proposal.parameters);
    expect(first.description).toContain(proposal.rationale);
    expect(first.aiProvenance).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", generatedAt: "2026-11-14T00:00:00.000Z", symbol: "BTCUSDT", interval: "1h" });
  });

  it("creates a human-approved immutable composed strategy with original AI provenance", () => {
    const parsed = parseAutomatedResearchAiArtifact(artifact);
    const definition = createHumanReviewedComposedStrategyDefinition(parsed.composedStrategies[0], 1_800_000_000_000, parsed);
    expect(definition.family).toBe("composed-rule");
    expect(definition.origin).toBe("human");
    expect(definition.aiProvenance?.provider).toBe("groq");
    expect(Object.isFrozen(definition.parameters)).toBe(true);
    const alteredRules = { ...parsed.composedStrategies[0], exit: { type: "rsi_overbought" as const, period: 14, threshold: 75 } };
    const altered = createHumanReviewedComposedStrategyDefinition(alteredRules, 1_800_000_000_000, parsed);
    expect(altered.id).not.toBe(definition.id);
  });

  it("rejects invalid approval timestamps", () => {
    const parsed = parseAutomatedResearchAiArtifact(artifact);
    expect(() => createHumanReviewedStrategyDefinition(parsed.proposals[0], -1, parsed)).toThrow(/timestamp/i);
    expect(() => createHumanReviewedStrategyDefinition(parsed.proposals[0], Number.NaN, parsed)).toThrow(/timestamp/i);
  });
});
