import { describe, expect, it } from "vitest";
import {
  AUTOMATED_CANDIDATE_GENERATOR_VERSION,
  AUTOMATED_CANDIDATE_LIMIT,
  createAutomatedResearchCandidates,
} from "./automated-strategy-search";

describe("automated strategy candidate search", () => {
  it("generates a deterministic, bounded set of transparent candidates", () => {
    const first = createAutomatedResearchCandidates();
    const second = createAutomatedResearchCandidates();
    expect(first).toHaveLength(16);
    expect(first.length).toBeLessThanOrEqual(AUTOMATED_CANDIDATE_LIMIT);
    expect(first.map((candidate) => candidate.id)).toEqual(second.map((candidate) => candidate.id));
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(first.length);
    expect(AUTOMATED_CANDIDATE_GENERATOR_VERSION).toBe("1.0.0");
  });

  it("includes SMA, RSI and Donchian families with explicit parameterized IDs", () => {
    const ids = createAutomatedResearchCandidates().map((candidate) => candidate.id);
    expect(ids.some((id) => id.startsWith("baseline-sma-cross-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("baseline-rsi-reversion-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("baseline-donchian-breakout-"))).toBe(true);
  });

  it("provides a fresh strategy factory for each candidate", () => {
    for (const candidate of createAutomatedResearchCandidates()) {
      expect(typeof candidate.fit).toBe("function");
      expect(candidate.fit([])).toBeTypeOf("function");
    }
  });
});
