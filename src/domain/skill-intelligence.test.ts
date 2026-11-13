import { describe, expect, it } from "vitest";
import { approveSkill, assessSkill, createSkillRecord, type SkillInput } from "./skill-intelligence";

const input: SkillInput = {
  id: "skill-ta-001", name: "Technical analysis patterns", description: "Reusable indicator and signal research patterns.",
  repositoryUrl: "https://github.com/example/ta-patterns", version: "1.0.0", license: "MIT",
  lastCommitAt: 1_790_000_000_000, stars: 120, openIssues: 3,
  capabilities: ["indicator-research", "backtesting"], hasTests: true, hasDocumentation: true,
  securityReviewed: false, provenance: "GitHub repository metadata checked 2026-11-14",
  discoveredAt: 1_792_000_000_000,
};

describe("NEXUS skill intelligence", () => {
  it("quarantines every newly discovered skill until review and explicit approval", () => {
    const skill = createSkillRecord(input);
    expect(skill.status).toBe("quarantined");
    expect(skill.executable).toBe(false);
    expect(skill.approvedBy).toBeNull();
  });

  it("requires a recognised permissive licence and security review before approval eligibility", () => {
    expect(assessSkill(input).eligibleForApproval).toBe(false);
    expect(assessSkill({ ...input, securityReviewed: true }).eligibleForApproval).toBe(true);
    expect(assessSkill({ ...input, license: "Unknown" }).eligibleForApproval).toBe(false);
    expect(assessSkill({ ...input, license: "GPL-3.0" }).eligibleForApproval).toBe(false);
  });

  it("rejects stale, invalid or unverifiable metadata", () => {
    expect(assessSkill({ ...input, lastCommitAt: 0 }).reasons).toContain("Repository maintenance date is missing or invalid");
    expect(assessSkill({ ...input, repositoryUrl: "https://example.com/code" }).eligibleForApproval).toBe(false);
    expect(() => createSkillRecord({ ...input, stars: -1 })).toThrow();
  });

  it("never grants execution permission, even to an approved catalogue entry", () => {
    const skill = createSkillRecord({ ...input, securityReviewed: true });
    expect(skill.executable).toBe(false);
  });
});
