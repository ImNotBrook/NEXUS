export type SkillStatus = "quarantined" | "review-required" | "approved" | "rejected";
export type SkillLicense = "MIT" | "Apache-2.0" | "BSD-2-Clause" | "BSD-3-Clause" | string;

export interface SkillInput {
  id: string;
  name: string;
  description: string;
  repositoryUrl: string;
  version: string;
  license: SkillLicense;
  lastCommitAt: number;
  stars: number;
  openIssues: number;
  capabilities: readonly string[];
  hasTests: boolean;
  hasDocumentation: boolean;
  securityReviewed: boolean;
  provenance: string;
  discoveredAt: number;
}

export interface SkillRecord extends SkillInput {
  status: SkillStatus;
  executable: false;
  approvedBy: string | null;
  approvalRationale: string | null;
  reviewedAt: number | null;
  rejectedBy?: string | null;
}

export interface SkillAssessment {
  eligibleForApproval: boolean;
  reasons: string[];
}

const ACCEPTED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);
const MAX_MAINTENANCE_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function assessSkill(input: SkillInput, now = Date.now()): SkillAssessment {
  const reasons: string[] = [];
  if (!input || typeof input !== "object") {
    return { eligibleForApproval: false, reasons: ["Skill metadata must be an object"] };
  }
  if (typeof input.repositoryUrl !== "string" ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(input.repositoryUrl)) {
    reasons.push("A canonical GitHub repository URL is required");
  }
  if (!ACCEPTED_LICENSES.has(input.license)) reasons.push("License is not on the NEXUS permissive allowlist");
  if (!Number.isSafeInteger(input.lastCommitAt) || input.lastCommitAt <= 0 ||
      input.lastCommitAt > now || now - input.lastCommitAt > MAX_MAINTENANCE_AGE_MS) {
    reasons.push("Repository maintenance date is missing or invalid");
  }
  if (!Number.isSafeInteger(input.stars) || input.stars < 0 ||
      !Number.isSafeInteger(input.openIssues) || input.openIssues < 0) {
    reasons.push("Repository engagement metadata must be non-negative integers");
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 ||
      input.capabilities.some((value) => typeof value !== "string" || value.trim().length < 2) ||
      new Set(input.capabilities).size !== input.capabilities.length) {
    reasons.push("At least one unique, named capability is required");
  }
  if (typeof input.name !== "string" || input.name.trim().length < 3 ||
      typeof input.description !== "string" || input.description.trim().length < 10 ||
      typeof input.version !== "string" || !input.version.trim()) {
    reasons.push("Skill name, description and version are required");
  }
  if (typeof input.hasTests !== "boolean" || !input.hasTests) reasons.push("Automated tests are not verified");
  if (typeof input.hasDocumentation !== "boolean" || !input.hasDocumentation) reasons.push("Documentation is not verified");
  if (input.securityReviewed !== true) reasons.push("Security review has not been completed");
  if (typeof input.provenance !== "string" || input.provenance.trim().length < 10) {
    reasons.push("Source provenance is required");
  }
  if (!Number.isSafeInteger(input.discoveredAt) || input.discoveredAt <= 0 || input.discoveredAt > now) {
    reasons.push("Discovery timestamp is missing or invalid");
  }
  return { eligibleForApproval: reasons.length === 0, reasons };
}

/** New external skills are metadata-only and quarantined by default. */
export function createSkillRecord(input: SkillInput): SkillRecord {
  const assessment = assessSkill(input);
  if (!input || !Number.isSafeInteger(input.stars) || input.stars < 0 ||
      !Number.isSafeInteger(input.openIssues) || input.openIssues < 0 ||
      !Number.isSafeInteger(input.discoveredAt) || input.discoveredAt <= 0 ||
      !Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new TypeError("Invalid skill metadata");
  }
  return Object.freeze({
    ...input,
    capabilities: Object.freeze([...input.capabilities]),
    status: assessment.eligibleForApproval ? "review-required" : "quarantined",
    executable: false as const,
    approvedBy: null,
    approvalRationale: null,
    reviewedAt: null,
  });
}

/** Explicit human review changes catalogue status only; it never enables code execution. */
export function approveSkill(
  skill: SkillRecord,
  actor: string,
  rationale: string,
  reviewedAt: number,
): SkillRecord {
  const assessment = assessSkill(skill, reviewedAt);
  if (!assessment.eligibleForApproval) {
    throw new Error("Skill is not eligible for approval: " + assessment.reasons.join("; "));
  }
  if (typeof actor !== "string" || actor.trim().length < 2 ||
      typeof rationale !== "string" || rationale.trim().length < 10 ||
      !Number.isSafeInteger(reviewedAt) || reviewedAt <= 0) {
    throw new TypeError("A named human reviewer, rationale and valid timestamp are required");
  }
  return Object.freeze({
    ...skill,
    id: skill.id + "@approved-" + reviewedAt,
    capabilities: Object.freeze([...skill.capabilities]),
    status: "approved" as const,
    executable: false as const,
    approvedBy: actor.trim(),
    approvalRationale: rationale.trim(),
    reviewedAt,
  });
}


/** Records an explicit human rejection as a new immutable, non-executable ledger entry. */
export function rejectSkill(
  skill: SkillRecord,
  actor: string,
  rationale: string,
  reviewedAt: number,
): SkillRecord {
  if (!skill || (skill.status !== "quarantined" && skill.status !== "review-required")) {
    throw new Error("Only an unreviewed skill candidate can be rejected");
  }
  if (typeof actor !== "string" || actor.trim().length < 2 ||
      typeof rationale !== "string" || rationale.trim().length < 10 ||
      !Number.isSafeInteger(reviewedAt) || reviewedAt <= 0) {
    throw new TypeError("A named human reviewer, rationale and valid timestamp are required");
  }
  return Object.freeze({
    ...skill,
    id: skill.id + "@rejected-" + reviewedAt,
    capabilities: Object.freeze([...skill.capabilities]),
    status: "rejected" as const,
    executable: false as const,
    approvedBy: null,
    rejectedBy: actor.trim(),
    approvalRationale: rationale.trim(),
    reviewedAt,
  });
}
