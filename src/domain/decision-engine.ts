export type EvidenceFamily =
  | "macro_regime"
  | "market_structure"
  | "liquidity_location"
  | "momentum_volume"
  | "derivatives_positioning"
  | "timeframe_alignment"
  | "trade_economics"
  | "external_context";

export type EvidencePolarity = "supports" | "contradicts" | "neutral" | "unknown";
export type DecisionStatus = "ENTER" | "WAIT" | "REJECT" | "NO_SETUP";

export interface EvidenceItem {
  id: string;
  family: EvidenceFamily;
  claim: string;
  polarity: EvidencePolarity;
  /** Diagnostic strength on a declared [0, 1] scale; not a probability. */
  strength: number;
  /** Source/data quality on a [0, 1] scale. */
  quality: number;
  symbol: string;
  timeframe: string;
  availableAt: number;
  observedAt: number;
  sourceRef: string;
  calculationVersion: string;
  /** Observations sharing a key are dependent and must not be counted as separate evidence. */
  correlationKey?: string;
}

export interface TradePlan {
  entryPrice: number;
  stopPrice: number;
  targetPrices: number[];
  quantity: number;
}

export interface DecisionCandidate {
  id: string;
  symbol: string;
  side: "long" | "short";
  setupFamily: string;
  timeframe: string;
  triggerConfirmed: boolean;
  expiresAt: number;
  plan: TradePlan;
}

export interface DecisionGate {
  eligible: boolean;
  reasonCodes: string[];
}

export interface DecisionInput {
  evaluationTime: number;
  candidate: DecisionCandidate | null;
  marketDataStatus: "pass" | "degraded" | "fail";
  riskGate: DecisionGate;
  economicsGate: DecisionGate;
  minimumSupportingFamilies: number;
  evidence: EvidenceItem[];
}

export type InvalidEvidenceReason =
  | "FUTURE_EVIDENCE"
  | "INVALID_TIMESTAMP"
  | "INVALID_VALUE"
  | "MISSING_PROVENANCE"
  | "SYMBOL_MISMATCH";

export interface InvalidEvidence {
  evidenceId: string;
  reason: InvalidEvidenceReason;
}

export interface DecisionResult {
  status: DecisionStatus;
  reasonCodes: string[];
  supportingFamilies: EvidenceFamily[];
  contradictingFamilies: EvidenceFamily[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  invalidEvidence: InvalidEvidence[];
  /** Diagnostic aggregates only. These are not calibrated probabilities. */
  supportScore: number;
  contradictionScore: number;
  coverageScore: number;
  uncertaintyScore: number;
  riskEligible: boolean;
}

const VALID_FAMILIES = new Set<EvidenceFamily>([
  "macro_regime",
  "market_structure",
  "liquidity_location",
  "momentum_volume",
  "derivatives_positioning",
  "timeframe_alignment",
  "trade_economics",
  "external_context",
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validPlan(candidate: DecisionCandidate): boolean {
  const { entryPrice, stopPrice, targetPrices, quantity } = candidate.plan;
  if (
    !isFiniteNumber(entryPrice) ||
    !isFiniteNumber(stopPrice) ||
    !isFiniteNumber(quantity) ||
    entryPrice <= 0 ||
    stopPrice <= 0 ||
    quantity <= 0 ||
    !Array.isArray(targetPrices) ||
    targetPrices.length === 0 ||
    targetPrices.some((target) => !isFiniteNumber(target) || target <= 0)
  ) {
    return false;
  }

  if (candidate.side === "long") {
    return stopPrice < entryPrice && targetPrices.every((target) => target > entryPrice);
  }
  return stopPrice > entryPrice && targetPrices.every((target) => target < entryPrice);
}

function validateEvidence(
  item: EvidenceItem,
  evaluationTime: number,
  candidate: DecisionCandidate,
): InvalidEvidenceReason | null {
  if (
    !isFiniteNumber(item.availableAt) ||
    !isFiniteNumber(item.observedAt) ||
    item.availableAt < 0 ||
    item.observedAt < 0
  ) {
    return "INVALID_TIMESTAMP";
  }
  if (item.availableAt > evaluationTime || item.observedAt > evaluationTime) {
    return "FUTURE_EVIDENCE";
  }
  if (
    !VALID_FAMILIES.has(item.family) ||
    !["supports", "contradicts", "neutral", "unknown"].includes(item.polarity) ||
    !isFiniteNumber(item.strength) ||
    item.strength < 0 ||
    item.strength > 1 ||
    !isFiniteNumber(item.quality) ||
    item.quality < 0 ||
    item.quality > 1
  ) {
    return "INVALID_VALUE";
  }
  if (
    !item.id.trim() ||
    !item.claim.trim() ||
    !item.symbol.trim() ||
    !item.timeframe.trim() ||
    !item.sourceRef.trim() ||
    !item.calculationVersion.trim()
  ) {
    return "MISSING_PROVENANCE";
  }
  if (item.symbol !== candidate.symbol) {
    return "SYMBOL_MISMATCH";
  }
  return null;
}

/**
 * Pure, deterministic decision kernel. It produces a paper-research eligibility
 * decision only; it does not execute orders or estimate a probability of profit.
 */
export function evaluateDecision(input: DecisionInput): DecisionResult {
  const result: DecisionResult = {
    status: "WAIT",
    reasonCodes: [],
    supportingFamilies: [],
    contradictingFamilies: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    invalidEvidence: [],
    supportScore: 0,
    contradictionScore: 0,
    coverageScore: 0,
    uncertaintyScore: 1,
    riskEligible: input.riskGate.eligible,
  };

  if (!isFiniteNumber(input.evaluationTime) || input.evaluationTime < 0) {
    result.status = "REJECT";
    result.reasonCodes.push("INVALID_EVALUATION_TIME");
    return result;
  }

  if (!input.candidate) {
    result.status = "NO_SETUP";
    result.reasonCodes.push("NO_CANDIDATE");
    return result;
  }

  const candidate = input.candidate;
  if (!Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= input.evaluationTime) {
    result.status = "REJECT";
    result.reasonCodes.push("CANDIDATE_EXPIRED");
    return result;
  }

  if (!validPlan(candidate)) {
    result.status = "REJECT";
    result.reasonCodes.push("INVALID_TRADE_PLAN");
    return result;
  }

  if (!input.riskGate.eligible) {
    result.status = "REJECT";
    result.reasonCodes.push("RISK_GATE_BLOCKED", ...input.riskGate.reasonCodes);
    return result;
  }

  if (!input.economicsGate.eligible) {
    result.status = "REJECT";
    result.reasonCodes.push("ECONOMICS_GATE_BLOCKED", ...input.economicsGate.reasonCodes);
    return result;
  }

  if (input.marketDataStatus !== "pass") {
    result.status = "WAIT";
    result.reasonCodes.push("MARKET_DATA_NOT_READY");
    if (input.marketDataStatus === "fail") result.uncertaintyScore = 1;
    return result;
  }

  const accepted: EvidenceItem[] = [];
  for (const item of input.evidence) {
    const reason = validateEvidence(item, input.evaluationTime, candidate);
    if (reason) {
      result.invalidEvidence.push({ evidenceId: item.id, reason });
    } else {
      accepted.push(item);
    }
  }

  // Count each evidence family once. Correlated items within a family are
  // retained for traceability but cannot manufacture additional independent families.
  const supporting = accepted.filter((item) => item.polarity === "supports" && item.quality > 0);
  const contradicting = accepted.filter((item) => item.polarity === "contradicts" && item.quality > 0);

  result.supportingFamilies = unique(supporting.map((item) => item.family)).sort();
  result.contradictingFamilies = unique(contradicting.map((item) => item.family)).sort();
  result.supportingEvidenceIds = supporting.map((item) => item.id).sort();
  result.contradictingEvidenceIds = contradicting.map((item) => item.id).sort();

  result.supportScore = result.supportingFamilies.length
    ? result.supportingFamilies.reduce((sum, family) => {
        const familyItems = supporting.filter((item) => item.family === family);
        const familyScore = familyItems.reduce((best, item) => Math.max(best, item.strength * item.quality), 0);
        return sum + familyScore;
      }, 0) / result.supportingFamilies.length
    : 0;

  result.contradictionScore = result.contradictingFamilies.length
    ? result.contradictingFamilies.reduce((sum, family) => {
        const familyItems = contradicting.filter((item) => item.family === family);
        const familyScore = familyItems.reduce((best, item) => Math.max(best, item.strength * item.quality), 0);
        return sum + familyScore;
      }, 0) / result.contradictingFamilies.length
    : 0;

  const observedFamilies = unique(accepted.map((item) => item.family));
  result.coverageScore = observedFamilies.length / VALID_FAMILIES.size;
  result.uncertaintyScore = Math.min(
    1,
    result.invalidEvidence.length / Math.max(1, input.evidence.length) +
      (input.minimumSupportingFamilies > 0
        ? Math.max(0, input.minimumSupportingFamilies - result.supportingFamilies.length) /
          input.minimumSupportingFamilies
        : 0),
  );

  if (result.supportingFamilies.length < input.minimumSupportingFamilies) {
    result.reasonCodes.push("INSUFFICIENT_INDEPENDENT_SUPPORT");
  }
  if (!candidate.triggerConfirmed) {
    result.reasonCodes.push("TRIGGER_NOT_CONFIRMED");
  }

  if (result.reasonCodes.length > 0) {
    result.status = "WAIT";
    return result;
  }

  result.status = "ENTER";
  result.reasonCodes.push("PAPER_ENTRY_ELIGIBLE");
  return result;
}
