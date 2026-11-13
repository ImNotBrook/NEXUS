export type SkillChangeType =
  | "knowledge"
  | "methodology"
  | "risk_policy"
  | "system_policy"
  | "execution_permission";

export interface SkillEvidence {
  source: string;
  note: string;
}

export interface SkillEvaluation {
  testsPassed: boolean;
  baselineScore: number;
  candidateScore: number;
  regressionCount: number;
}

export interface SkillProposal {
  id: string;
  skillId: string;
  baseVersion: string;
  proposedVersion: string;
  changeType: SkillChangeType;
  changedFiles: readonly string[];
  title: string;
  summary: string;
  evidence: readonly SkillEvidence[];
  evaluation: SkillEvaluation;
  createdAt: number;
}

export interface SkillApproval {
  approvedBy: string;
  approvedAt: number;
  rationale: string;
}

export interface SkillAssessment {
  valid: boolean;
  autoPromotable: boolean;
  requiresHumanApproval: boolean;
  reasons: string[];
}

export interface ActiveSkillVersion {
  proposalId: string;
  skillId: string;
  version: string;
  changeType: SkillChangeType;
  status: "active";
  promotedAt: number;
  evidence: readonly SkillEvidence[];
  evaluation: Readonly<SkillEvaluation>;
  approval?: Readonly<SkillApproval>;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseVersion(version: unknown): [number, number, number] | null {
  if (typeof version !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return parts as [number, number, number];
}

function isVersionGreater(candidate: unknown, baseline: unknown): boolean {
  const next = parseVersion(candidate);
  const current = parseVersion(baseline);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

export function assessSkillProposal(proposal: SkillProposal): SkillAssessment {
  const reasons: string[] = [];
  if (!proposal.id.trim() || !proposal.skillId.trim() || !proposal.title.trim() || !proposal.summary.trim()) {
    reasons.push("Proposal identity, skill, title and summary are required");
  }
  const allowedChangeTypes: readonly string[] = [
    "knowledge", "methodology", "risk_policy", "system_policy", "execution_permission",
  ];
  if (!allowedChangeTypes.includes(proposal.changeType)) {
    reasons.push("Unknown skill change classification");
  }
  if (!Array.isArray(proposal.changedFiles) || proposal.changedFiles.length === 0 ||
      proposal.changedFiles.some((path) => !path.trim() || path.startsWith("/") ||
        path.includes("..") || path.includes("\\"))) {
    reasons.push("Proposal must identify safe, repository-relative changed file paths");
  }
  if (!isVersionGreater(proposal.proposedVersion, proposal.baseVersion)) {
    reasons.push("Proposed semantic version must be valid and greater than the active version");
  }
  if (!Number.isSafeInteger(proposal.createdAt) || proposal.createdAt < 0) {
    reasons.push("Proposal timestamp must be a non-negative safe integer");
  }
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0 ||
      proposal.evidence.some((item) => !item.source.trim() || !item.note.trim())) {
    reasons.push("At least one complete evidence reference is required");
  }
  const evaluation = proposal.evaluation;
  if (!evaluation || evaluation.testsPassed !== true) {
    reasons.push("Candidate skill evaluation tests must pass");
  }
  if (!evaluation || !Number.isFinite(evaluation.baselineScore) ||
      !Number.isFinite(evaluation.candidateScore) ||
      evaluation.baselineScore < 0 || evaluation.baselineScore > 100 ||
      evaluation.candidateScore < 0 || evaluation.candidateScore > 100 ||
      evaluation.candidateScore <= evaluation.baselineScore) {
    reasons.push("Candidate evaluation score must improve the baseline within the 0–100 range");
  }
  if (!evaluation || !Number.isSafeInteger(evaluation.regressionCount) || evaluation.regressionCount !== 0) {
    reasons.push("Candidate skill must introduce zero evaluation regressions");
  }

  const valid = reasons.length === 0;
  const knowledgeOnlyFiles = valid && proposal.changedFiles.every((path) =>
    path.startsWith("skills/knowledge/") && path.endsWith(".md"),
  );
  const autoPromotable = valid && proposal.changeType === "knowledge" && knowledgeOnlyFiles;
  const requiresHumanApproval = valid && !autoPromotable;
  return {
    valid,
    autoPromotable,
    requiresHumanApproval,
    reasons,
  };
}

/**
 * Promotes only evaluated, versioned proposals. Knowledge-only changes can
 * auto-promote after evaluation; methods, risk, policy and permission changes
 * require a separately recorded human approval.
 */
export function promoteSkillProposal(
  proposal: SkillProposal,
  approval?: SkillApproval,
): ActiveSkillVersion {
  const assessment = assessSkillProposal(proposal);
  if (!assessment.valid) {
    throw new Error("Skill proposal rejected: " + assessment.reasons.join("; "));
  }
  if (assessment.requiresHumanApproval) {
    if (!approval || !isNonBlankString(approval.approvedBy) || !isNonBlankString(approval.rationale) ||
        !Number.isSafeInteger(approval.approvedAt) || approval.approvedAt < proposal.createdAt) {
      throw new Error("This skill change requires explicit human approval");
    }
  }

  const evidence = Object.freeze(proposal.evidence.map((item) => Object.freeze({ ...item })));
  const evaluation = Object.freeze({ ...proposal.evaluation });
  const approved = approval ? Object.freeze({ ...approval }) : undefined;
  return Object.freeze({
    proposalId: proposal.id,
    skillId: proposal.skillId,
    version: proposal.proposedVersion,
    changeType: proposal.changeType,
    status: "active" as const,
    promotedAt: approved?.approvedAt ?? proposal.createdAt,
    evidence,
    evaluation,
    ...(approved ? { approval: approved } : {}),
  });
}
