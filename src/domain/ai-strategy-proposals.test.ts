import { describe, expect, it } from "vitest";
import { parseAiStrategyProposals } from "./ai-strategy-proposals";

describe("bounded AI strategy proposal parser", () => {
  it("accepts valid whitelisted parameter proposals", () => {
    expect(parseAiStrategyProposals({ candidates: [
      { family: "sma-crossover", parameters: { fastPeriod: 8, slowPeriod: 24 }, rationale: "A faster trend signal may capture earlier directional transitions." },
      { family: "rsi-mean-reversion", parameters: { period: 14, oversold: 25, overbought: 75 }, rationale: "Symmetric outer thresholds test a more selective mean-reversion entry." },
      { family: "donchian-breakout", parameters: { period: 30 }, rationale: "A longer channel tests persistence in directional breakouts." },
    ] })).toHaveLength(3);
  });

  it("rejects generated code, unknown families, invalid ranges and oversized output", () => {
    expect(() => parseAiStrategyProposals({ candidates: [{ code: "return fetch('/secrets')" }] })).toThrow();
    expect(() => parseAiStrategyProposals({ candidates: [{ family: "custom-code", parameters: {}, rationale: "This is a sufficiently long rationale." }] })).toThrow();
    expect(() => parseAiStrategyProposals({ candidates: [{ family: "sma-crossover", parameters: { fastPeriod: 30, slowPeriod: 8 }, rationale: "This is a sufficiently long rationale." }] })).toThrow();
    expect(() => parseAiStrategyProposals({ candidates: Array(5).fill({}) })).toThrow();
  });

  it("requires an explanation for every generated proposal", () => {
    expect(() => parseAiStrategyProposals({ candidates: [
      { family: "donchian-breakout", parameters: { period: 20 }, rationale: "short" },
    ] })).toThrow();
  });
});
