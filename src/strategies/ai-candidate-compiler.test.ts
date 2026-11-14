import { describe, expect, it } from "vitest";
import { compileAiStrategyProposals } from "./ai-candidate-compiler";

describe("AI candidate compiler", () => {
  it("compiles proposals only into reviewed strategy factories", () => {
    const candidates = compileAiStrategyProposals([
      { family: "sma-crossover", parameters: { fastPeriod: 7, slowPeriod: 28 }, rationale: "A faster signal may respond to trends earlier." },
      { family: "rsi-mean-reversion", parameters: { period: 12, oversold: 25, overbought: 75 }, rationale: "A narrower oversold band tests a more selective entry." },
      { family: "donchian-breakout", parameters: { period: 35 }, rationale: "A longer breakout channel tests slower momentum." },
    ]);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => typeof candidate.fit() === "function")).toBe(true);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "baseline-sma-cross-f7-s28",
      "baseline-rsi-reversion-p12-o25-b75",
      "baseline-donchian-breakout-p35",
    ]);
  });

  it("deduplicates identical generated parameters", () => {
    const candidates = compileAiStrategyProposals([
      { family: "donchian-breakout", parameters: { period: 35 }, rationale: "A longer breakout channel tests slower momentum." },
      { family: "donchian-breakout", parameters: { period: 35 }, rationale: "Duplicate candidate should not be evaluated twice." },
    ]);
    expect(candidates).toHaveLength(1);
  });
});
