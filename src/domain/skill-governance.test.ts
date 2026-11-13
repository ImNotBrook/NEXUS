import { describe, expect, it } from "vitest";
import { assessSkillProposal, promoteSkillProposal, type SkillProposal } from "./skill-governance";

function proposal(overrides: Partial<SkillProposal> = {}): SkillProposal {
  return {
    id: "proposal-001",
    skillId: "nexus-quant-research",
    baseVersion: "1.2.0",
    proposedVersion: "1.3.0",
    changeType: "knowledge",
    changedFiles: ["skills/knowledge/market-regimes.md"],
    title: "Add regime classification evidence",
    summary: "Add a documented volatility-regime diagnostic.",
    evidence: [{ source: "https://example.org/research", note: "Primary methodology reference" }],
    evaluation: {
      testsPassed: true,
      baselineScore: 82,
      candidateScore: 84,
      regressionCount: 0,
    },
    createdAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe("assessSkillProposal", () => {
  it("allows an evidence-backed knowledge update to auto-promote after passing evaluation", () => {
    const result = assessSkillProposal(proposal());
    expect(result.valid).toBe(true);
    expect(result.autoPromotable).toBe(true);
    expect(result.requiresHumanApproval).toBe(false);
  });

  it("does not trust a knowledge label when the changed files are outside the knowledge-only directory", () => {
    const result = assessSkillProposal(proposal({ changedFiles: ["AGENTS.md"] }));
    expect(result.valid).toBe(true);
    expect(result.autoPromotable).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it("requires explicit human approval for methodology, risk, policy and execution changes", () => {
    for (const changeType of ["methodology", "risk_policy", "system_policy", "execution_permission"] as const) {
      const result = assessSkillProposal(proposal({ changeType }));
      expect(result.valid).toBe(true);
      expect(result.autoPromotable).toBe(false);
      expect(result.requiresHumanApproval).toBe(true);
    }
  });

  it("rejects malformed and path-traversing change manifests without throwing", () => {
    expect(assessSkillProposal(proposal({
      changedFiles: [null as unknown as string],
    })).valid).toBe(false);
    expect(assessSkillProposal(proposal({
      changedFiles: ["skills/knowledge/../AGENTS.md"],
    })).valid).toBe(false);
    expect(assessSkillProposal(proposal({
      evidence: [{ source: null as unknown as string, note: "bad reference" }],
    })).valid).toBe(false);
  });

  it("blocks proposals with failed tests, regressions, missing evidence or no score improvement", () => {
    expect(assessSkillProposal(proposal({
      evaluation: { testsPassed: false, baselineScore: 82, candidateScore: 84, regressionCount: 0 },
    })).valid).toBe(false);
    expect(assessSkillProposal(proposal({
      evaluation: { testsPassed: true, baselineScore: 82, candidateScore: 84, regressionCount: 1 },
    })).valid).toBe(false);
    expect(assessSkillProposal(proposal({ evidence: [] })).valid).toBe(false);
    expect(assessSkillProposal(proposal({
      evaluation: { testsPassed: true, baselineScore: 82, candidateScore: 81, regressionCount: 0 },
    })).valid).toBe(false);
  });
});

describe("promoteSkillProposal", () => {
  it("promotes eligible knowledge changes as an immutable version record", () => {
    const promoted = promoteSkillProposal(proposal());
    expect(promoted.version).toBe("1.3.0");
    expect(promoted.status).toBe("active");
    expect(Object.isFrozen(promoted)).toBe(true);
  });

  it("refuses protected changes without explicit human approval", () => {
    expect(() => promoteSkillProposal(proposal({ changeType: "risk_policy" }))).toThrow(/human approval/i);
  });

  it("records the human approver for protected changes", () => {
    const promoted = promoteSkillProposal(
      proposal({ changeType: "risk_policy" }),
      { approvedBy: "owner", approvedAt: 1_800_000_000_100, rationale: "Reviewed risk impact and tests" },
    );
    expect(promoted.approval?.approvedBy).toBe("owner");
    expect(promoted.approval?.approvedAt).toBe(1_800_000_000_100);
  });

  it("rejects invalid semantic version transitions", () => {
    expect(assessSkillProposal(proposal({ proposedVersion: "1.2.0" })).valid).toBe(false);
    expect(assessSkillProposal(proposal({ proposedVersion: "invalid" })).valid).toBe(false);
  });
});
