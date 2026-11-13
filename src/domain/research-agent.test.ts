import { describe, expect, it } from "vitest";
import { assessResearchHypothesis, createResearchHypothesis, type ResearchHypothesisInput } from "./research-agent";

const input: ResearchHypothesisInput = {
  title: "Test whether a volatility filter improves SMA crossover stability",
  question: "Does excluding high-volatility entries improve median out-of-sample return without increasing worst-fold drawdown?",
  rationale: "High volatility may increase adverse execution and false breakouts.",
  sourceEvidence: [
    { sourceType: "experiment", reference: "run:abc123", claim: "Baseline SMA strategy has negative returns in high-volatility folds." },
    { sourceType: "paper", reference: "https://example.org/research", claim: "Volatility clustering affects return distributions." },
  ],
  targetStrategyId: "baseline-sma-cross-f10-s30",
  proposedVariables: ["atrPercentileThreshold"],
  primaryMetric: "median-fold-return-pct",
  guardrailMetrics: ["worst-fold-drawdown-pct", "completed-trades"],
  createdAt: 1000,
};

describe("research agent hypothesis", () => {
  it("creates a testable, evidence-linked hypothesis in draft state", () => {
    const hypothesis = createResearchHypothesis(input);
    expect(hypothesis).toMatchObject({
      status: "draft",
      title: input.title,
      primaryMetric: input.primaryMetric,
      targetStrategyId: input.targetStrategyId,
    });
    expect(hypothesis.id).toContain("hypothesis-");
  });

  it("rejects hypotheses without falsifiable metrics or evidence", () => {
    expect(assessResearchHypothesis({ ...input, primaryMetric: "" }).valid).toBe(false);
    expect(assessResearchHypothesis({ ...input, sourceEvidence: [] }).valid).toBe(false);
    expect(assessResearchHypothesis({ ...input, guardrailMetrics: [] }).valid).toBe(false);
  });

  it("requires independent out-of-sample evidence and guardrails before marking a hypothesis test-ready", () => {
    const hypothesis = createResearchHypothesis(input);
    expect(assessResearchHypothesis(hypothesis).readyForExperiment).toBe(true);
    expect(assessResearchHypothesis({
      ...hypothesis,
      sourceEvidence: [{ sourceType: "opinion", reference: "manual", claim: "I think it works" }],
    }).readyForExperiment).toBe(false);
  });

  it("rejects invalid timestamps and duplicate variable names", () => {
    expect(() => createResearchHypothesis({ ...input, createdAt: -1 })).toThrow();
    expect(() => createResearchHypothesis({ ...input, proposedVariables: ["period", "period"] })).toThrow();
  });
});
