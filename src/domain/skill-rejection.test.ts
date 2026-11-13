import { describe, expect, it } from "vitest";
import { createSkillRecord, rejectSkill, type SkillInput } from "./skill-intelligence";

const validInput: SkillInput = {
  id: "sample-skill", name: "Sample trading skill", description: "A sufficiently detailed skill description.",
  repositoryUrl: "https://github.com/example/sample-skill", version: "abc1234", license: "MIT",
  lastCommitAt: Date.now() - 86_400_000, stars: 10, openIssues: 1,
  capabilities: ["research"], hasTests: true, hasDocumentation: true, securityReviewed: true,
  provenance: "Reviewed source revision abc1234 and its repository metadata.", discoveredAt: Date.now() - 1_000,
};

describe("rejectSkill", () => {
  it("records a human rejection without granting execution permission", () => {
    const candidate = createSkillRecord(validInput);
    const rejected = rejectSkill(candidate, "Reviewer", "Source review found unsafe dependency behavior.", Date.now());
    expect(rejected.status).toBe("rejected");
    expect(rejected.executable).toBe(false);
    expect(rejected.approvedBy).toBeNull();
    expect(rejected.rejectedBy).toBe("Reviewer");
    expect(rejected.approvalRationale).toContain("unsafe");
    expect(rejected.reviewedAt).toBeTypeOf("number");
    expect(rejected.id).not.toBe(candidate.id);
  });

  it("rejects missing reviewer rationale and already reviewed records", () => {
    const candidate = createSkillRecord(validInput);
    expect(() => rejectSkill(candidate, "", "A sufficiently long rationale.", Date.now())).toThrow();
    expect(() => rejectSkill(candidate, "Reviewer", "short", Date.now())).toThrow();
    const rejected = rejectSkill(candidate, "Reviewer", "A sufficiently long rejection rationale.", Date.now());
    expect(() => rejectSkill(rejected, "Reviewer", "Another sufficiently long rationale.", Date.now())).toThrow();
  });
});
