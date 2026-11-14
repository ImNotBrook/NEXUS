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
  /** Explicit disposition and reasons when a reviewed generator cannot supply a candidate. */
  candidateAbsenceStatus?: "WAIT" | "REJECT" | "NO_SETUP";
  candidateAbsenceReasonCodes?: string[];
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

function validCandidate(candidate: DecisionCandidate): boolean {
  return Boolean(
    candidate &&
    typeof candidate.id === "string" && candidate.id.trim() &&
    typeof candidate.symbol === "string" && candidate.symbol.trim() &&
    typeof candidate.setupFamily === "string" && candidate.setupFamily.trim() &&
    typeof candidate.timeframe === "string" && candidate.timeframe.trim() &&
    (candidate.side === "long" || candidate.side === "short") &&
    typeof candidate.triggerConfirmed === "boolean" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.plan && typeof candidate.plan === "object"
  );
}

function validPlan(candidate: DecisionCandidate): boolean {
  if (!candidate.plan || typeof candidate.plan !== "object") return false;
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

function independentFamilies(items: EvidenceItem[]): EvidenceFamily[] {
  const families = unique(items.map((item) => item.family)).sort();
  const familiesByCorrelation = new Map<string, Set<EvidenceFamily>>();

  for (const item of items) {
    const key = item.correlationKey?.trim();
    if (!key) continue;
    const associated = familiesByCorrelation.get(key) ?? new Set<EvidenceFamily>();
    associated.add(item.family);
    familiesByCorrelation.set(key, associated);
  }

  return families.filter((family) => {
    const familyItems = items.filter((item) => item.family === family);
    if (familyItems.some((item) => !item.correlationKey?.trim())) return true;
    return familyItems.some((item) => {
      const key = item.correlationKey?.trim();
      if (!key) return true;
      const associated = [...(familiesByCorrelation.get(key) ?? [])].sort();
      return associated[0] === family;
    });
  });
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
    const absenceStatus = input.candidateAbsenceStatus ?? "NO_SETUP";
    const absenceReasons = input.candidateAbsenceReasonCodes ?? [];
    if (
      !["WAIT", "REJECT", "NO_SETUP"].includes(absenceStatus) ||
      !Array.isArray(absenceReasons) ||
      absenceReasons.some((reason) => typeof reason !== "string" || !reason.trim()) ||
      !["pass", "degraded", "fail"].includes(input.marketDataStatus)
    ) {
      result.status = "REJECT";
      result.reasonCodes.push("INVALID_DECISION_CONFIGURATION");
      return result;
    }
    result.status = absenceStatus;
    result.reasonCodes.push("NO_CANDIDATE", ...unique(absenceReasons));
    if (absenceStatus === "WAIT" && input.marketDataStatus !== "pass" &&
        !result.reasonCodes.includes("MARKET_DATA_NOT_READY")) {
      result.reasonCodes.push("MARKET_DATA_NOT_READY");
    }
    return result;
  }

  const candidate = input.candidate;
  if (!validCandidate(candidate)) {
    result.status = "REJECT";
    result.reasonCodes.push("INVALID_CANDIDATE");
    return result;
  }

  if (
    !Number.isInteger(input.minimumSupportingFamilies) ||
    input.minimumSupportingFamilies < 1 ||
    !Array.isArray(input.evidence) ||
    !input.riskGate ||
    !Array.isArray(input.riskGate.reasonCodes) ||
    !input.economicsGate ||
    !Array.isArray(input.economicsGate.reasonCodes) ||
    !["pass", "degraded", "fail"].includes(input.marketDataStatus)
  ) {
    result.status = "REJECT";
    result.reasonCodes.push("INVALID_DECISION_CONFIGURATION");
    return result;
  }

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

  result.supportingFamilies = independentFamilies(supporting);
  result.contradictingFamilies = independentFamilies(contradicting);
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
