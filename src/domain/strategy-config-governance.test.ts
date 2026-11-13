import { describe, expect, it } from "vitest";
import { approveStrategyConfigProposal, assessStrategyConfigProposal, type StrategyConfigProposal } from "./strategy-config-governance";

const proposal: StrategyConfigProposal = {
  id: "proposal-001",
  strategyId: "baseline-sma-cross",
  baseVersion: "1.0.0",
  proposedVersion: "1.1.0",
  parameters: { fastPeriod: 12, slowPeriod: 36 },
  rationale: "Candidate showed better median out-of-sample return across the same folds.",
  evidence: [{ source: "experiment:run-123", note: "Same data fingerprint and fee assumptions." }],
  evaluation: { metric: "median-fold-return-pct", baselineScore: 0.8, candidateScore: 1.2, testsPassed: true, regressionCount: 0 },
  createdAt: 1000,
};

describe("strategy config governance", () => {
  it("accepts a versioned evidence-backed proposal but always requires human approval", () => {
    expect(assessStrategyConfigProposal(proposal)).toMatchObject({ valid: true, requiresHumanApproval: true, reasons: [] });
  });

  it("rejects non-increasing versions, missing evidence and failed regression checks", () => {
    expect(assessStrategyConfigProposal({ ...proposal, proposedVersion: "1.0.0" }).valid).toBe(false);
    expect(assessStrategyConfigProposal({ ...proposal, evidence: [] }).valid).toBe(false);
    expect(assessStrategyConfigProposal({ ...proposal, evaluation: { ...proposal.evaluation, regressionCount: 1 } }).valid).toBe(false);
  });

  it("creates immutable approved versions only after explicit attributable approval", () => {
    expect(() => approveStrategyConfigProposal(proposal, { approvedBy: "", rationale: "", approvedAt: 1001 })).toThrow(/human approval/i);
    const version = approveStrategyConfigProposal(proposal, {
      approvedBy: "owner", rationale: "Reviewed the evidence and approve this parameter revision.", approvedAt: 1001,
    });
    expect(version).toMatchObject({ strategyId: proposal.strategyId, version: "1.1.0", status: "approved" });
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.parameters)).toBe(true);
  });

  it("rejects proposals with a candidate score that does not improve the named metric", () => {
    expect(assessStrategyConfigProposal({
      ...proposal, evaluation: { ...proposal.evaluation, candidateScore: proposal.evaluation.baselineScore },
    }).valid).toBe(false);
  });
});
