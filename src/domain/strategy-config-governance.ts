export interface StrategyConfigEvidence {
  source: string;
  note: string;
}

export interface StrategyConfigEvaluation {
  metric: string;
  baselineScore: number;
  candidateScore: number;
  testsPassed: boolean;
  regressionCount: number;
}

export interface StrategyConfigProposal {
  id: string;
  strategyId: string;
  baseVersion: string;
  proposedVersion: string;
  parameters: Readonly<Record<string, number | string | boolean>>;
  rationale: string;
  evidence: readonly StrategyConfigEvidence[];
  evaluation: StrategyConfigEvaluation;
  createdAt: number;
}

export interface StrategyConfigApproval {
  approvedBy: string;
  rationale: string;
  approvedAt: number;
}

export interface StrategyConfigAssessment {
  valid: boolean;
  requiresHumanApproval: true;
  reasons: string[];
}

export interface ApprovedStrategyConfigVersion {
  id: string;
  strategyId: string;
  version: string;
  parameters: Readonly<Record<string, number | string | boolean>>;
  proposalId: string;
  evidence: readonly StrategyConfigEvidence[];
  evaluation: Readonly<StrategyConfigEvaluation>;
  approval: Readonly<StrategyConfigApproval>;
  status: "approved";
}

function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts as [number, number, number] : null;
}

function greaterVersion(nextValue: unknown, baseValue: unknown): boolean {
  const next = parseVersion(nextValue);
  const base = parseVersion(baseValue);
  if (!next || !base) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== base[index]) return next[index] > base[index];
  }
  return false;
}

export function assessStrategyConfigProposal(proposal: StrategyConfigProposal): StrategyConfigAssessment {
  const reasons: string[] = [];
  if (!proposal || typeof proposal !== "object") {
    return { valid: false, requiresHumanApproval: true, reasons: ["Proposal must be an object"] };
  }
  if (![proposal.id, proposal.strategyId, proposal.rationale].every((value) =>
    typeof value === "string" && value.trim().length > 0,
  )) reasons.push("Proposal ID, strategy ID and rationale are required");
  if (!greaterVersion(proposal.proposedVersion, proposal.baseVersion)) {
    reasons.push("Proposed semantic version must be greater than the base version");
  }
  if (!Number.isSafeInteger(proposal.createdAt) || proposal.createdAt < 0) {
    reasons.push("Proposal timestamp must be a non-negative safe integer");
  }
  const entries = Object.entries(proposal.parameters ?? {});
  if (entries.length === 0 || entries.some(([key, value]) =>
    !key.trim() || (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value)),
  )) reasons.push("Parameters must contain finite primitive values");
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0 ||
      proposal.evidence.some((item) => !item || !item.source?.trim() || !item.note?.trim())) {
    reasons.push("At least one source-backed evidence item is required");
  }
  const evaluation = proposal.evaluation;
  if (!evaluation || typeof evaluation.metric !== "string" || !evaluation.metric.trim() ||
      !Number.isFinite(evaluation.baselineScore) || !Number.isFinite(evaluation.candidateScore) ||
      evaluation.candidateScore <= evaluation.baselineScore) {
    reasons.push("Candidate must improve a named, finite evaluation metric");
  }
  if (!evaluation || evaluation.testsPassed !== true ||
      !Number.isSafeInteger(evaluation.regressionCount) || evaluation.regressionCount !== 0) {
    reasons.push("All candidate tests must pass with zero regressions");
  }
  return { valid: reasons.length === 0, requiresHumanApproval: true, reasons };
}

/** Creates an immutable approved version. It never changes an active strategy or execution setting. */
export function approveStrategyConfigProposal(
  proposal: StrategyConfigProposal,
  approval: StrategyConfigApproval,
): ApprovedStrategyConfigVersion {
  const assessment = assessStrategyConfigProposal(proposal);
  if (!assessment.valid) throw new Error("Strategy config proposal rejected: " + assessment.reasons.join("; "));
  if (!approval || !approval.approvedBy?.trim() || !approval.rationale?.trim() ||
      !Number.isSafeInteger(approval.approvedAt) || approval.approvedAt < proposal.createdAt) {
    throw new Error("Explicit human approval with actor, rationale and valid timestamp is required");
  }
  return Object.freeze({
    id: proposal.strategyId + "@" + proposal.proposedVersion,
    strategyId: proposal.strategyId,
    version: proposal.proposedVersion,
    parameters: Object.freeze({ ...proposal.parameters }),
    proposalId: proposal.id,
    evidence: Object.freeze(proposal.evidence.map((item) => Object.freeze({ ...item }))),
    evaluation: Object.freeze({ ...proposal.evaluation }),
    approval: Object.freeze({ ...approval }),
    status: "approved" as const,
  });
}
