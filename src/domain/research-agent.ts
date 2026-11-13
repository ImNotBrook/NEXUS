export type ResearchEvidenceType =
  | "experiment" | "paper" | "documentation" | "code" | "exchange-data" | "community" | "opinion";

export interface ResearchEvidence {
  sourceType: ResearchEvidenceType;
  reference: string;
  claim: string;
}

export interface ResearchHypothesisInput {
  title: string;
  question: string;
  rationale: string;
  sourceEvidence: readonly ResearchEvidence[];
  targetStrategyId: string;
  proposedVariables: readonly string[];
  primaryMetric: string;
  guardrailMetrics: readonly string[];
  createdAt: number;
}

export interface ResearchHypothesis extends ResearchHypothesisInput {
  id: string;
  status: "draft";
  protocol: {
    sameDatasetForControlAndCandidate: true;
    walkForwardRequired: true;
    feesAndSlippageRequired: true;
    finalHoldoutRequired: true;
    automaticPromotion: false;
  };
}

export interface ResearchHypothesisAssessment {
  valid: boolean;
  readyForExperiment: boolean;
  reasons: string[];
}

const EVIDENCE_TYPES = new Set<ResearchEvidenceType>([
  "experiment", "paper", "documentation", "code", "exchange-data", "community", "opinion",
]);

export function assessResearchHypothesis(
  hypothesis: ResearchHypothesisInput,
): ResearchHypothesisAssessment {
  const reasons: string[] = [];
  if (!hypothesis || typeof hypothesis !== "object") {
    return { valid: false, readyForExperiment: false, reasons: ["Hypothesis must be an object"] };
  }
  for (const [field, value] of [
    ["title", hypothesis.title], ["question", hypothesis.question],
    ["rationale", hypothesis.rationale], ["target strategy", hypothesis.targetStrategyId],
    ["primary metric", hypothesis.primaryMetric],
  ] as const) {
    if (typeof value !== "string" || value.trim().length < 5) reasons.push("A meaningful " + field + " is required");
  }
  if (!Number.isSafeInteger(hypothesis.createdAt) || hypothesis.createdAt < 0) {
    reasons.push("Timestamp must be a non-negative safe integer");
  }
  if (!Array.isArray(hypothesis.proposedVariables) || hypothesis.proposedVariables.length === 0 ||
      hypothesis.proposedVariables.some((item) => typeof item !== "string" || !item.trim()) ||
      new Set(hypothesis.proposedVariables).size !== hypothesis.proposedVariables.length) {
    reasons.push("At least one unique, named experimental variable is required");
  }
  if (!Array.isArray(hypothesis.guardrailMetrics) || hypothesis.guardrailMetrics.length === 0 ||
      hypothesis.guardrailMetrics.some((item) => typeof item !== "string" || !item.trim())) {
    reasons.push("At least one risk or sample-size guardrail metric is required");
  }
  const evidence = hypothesis.sourceEvidence;
  if (!Array.isArray(evidence) || evidence.length === 0 ||
      evidence.some((item) => !item || !EVIDENCE_TYPES.has(item.sourceType) ||
        typeof item.reference !== "string" || !item.reference.trim() ||
        typeof item.claim !== "string" || item.claim.trim().length < 8)) {
    reasons.push("Every evidence item needs a recognized source type, reference and specific claim");
  }
  const valid = reasons.length === 0;
  const independentEvidenceTypes = new Set(
    (Array.isArray(evidence) ? evidence : [])
      .filter((item) => item && EVIDENCE_TYPES.has(item.sourceType) && item.sourceType !== "opinion")
      .map((item) => item.sourceType),
  );
  const readyForExperiment = valid && independentEvidenceTypes.size >= 2;
  if (valid && !readyForExperiment) reasons.push("At least two distinct non-opinion evidence types are required before experiment design");
  return { valid, readyForExperiment, reasons };
}

export function createResearchHypothesis(input: ResearchHypothesisInput): ResearchHypothesis {
  const assessment = assessResearchHypothesis(input);
  if (!assessment.valid) throw new Error("Research hypothesis rejected: " + assessment.reasons.join("; "));
  return Object.freeze({
    ...input,
    sourceEvidence: Object.freeze(input.sourceEvidence.map((item) => Object.freeze({ ...item }))),
    proposedVariables: Object.freeze([...input.proposedVariables]),
    guardrailMetrics: Object.freeze([...input.guardrailMetrics]),
    id: "hypothesis-" + input.createdAt + "-" + input.targetStrategyId,
    status: "draft" as const,
    protocol: Object.freeze({
      sameDatasetForControlAndCandidate: true as const,
      walkForwardRequired: true as const,
      feesAndSlippageRequired: true as const,
      finalHoldoutRequired: true as const,
      automaticPromotion: false as const,
    }),
  });
}
