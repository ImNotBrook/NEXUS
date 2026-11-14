import { describe, expect, it } from "vitest";
import {
  createHumanReviewedStrategyDefinition,
  parseAutomatedResearchAiArtifact,
} from "./ai-strategy-review";

const proposal = {
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
    const first = createHumanReviewedStrategyDefinition(parsed.proposals[0], 1_800_000_000_000);
    const second = createHumanReviewedStrategyDefinition(parsed.proposals[0], 1_800_000_000_000);
    expect(first).toEqual(second);
    expect(first.id).toMatch(/^ai-sma-crossover-[a-f0-9]{8}$/);
    expect(first.version).toBe("1.0.0");
    expect(first.origin).toBe("human");
    expect(first.parameters).toEqual(proposal.parameters);
    expect(first.description).toContain(proposal.rationale);
  });

  it("rejects invalid approval timestamps", () => {
    expect(() => createHumanReviewedStrategyDefinition(proposal, -1)).toThrow(/timestamp/i);
    expect(() => createHumanReviewedStrategyDefinition(proposal, Number.NaN)).toThrow(/timestamp/i);
  });
});
