export type AiMarketBias = "bullish" | "bearish" | "mixed" | "none";
export type AiMarketConfidence = "low" | "moderate" | "high";

export interface MarketAnalystEvidence {
  id: string;
  source: string;
  observedAt: number;
  statement: string;
}

export interface AiMarketClaim {
  evidenceId: string;
  statement: string;
}

export interface AiMarketAnalysis {
  schemaVersion: 1;
  bias: AiMarketBias;
  confidence: AiMarketConfidence;
  summary: string;
  bullCase: string;
  bearCase: string;
  contradictions: readonly string[];
  claims: readonly AiMarketClaim[];
  abstain: boolean;
  abstentionReason?: string;
}

const ANALYSIS_FIELDS = new Set([
  "schemaVersion", "bias", "confidence", "summary", "bullCase", "bearCase",
  "contradictions", "claims", "abstain", "abstentionReason",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
}

function validateEvidencePacket(evidence: readonly MarketAnalystEvidence[]): Set<string> {
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 32) {
    throw new TypeError("Evidence packet must contain between 1 and 32 items");
  }
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!isRecord(item) || typeof item.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(item.id) ||
        ids.has(item.id) || !boundedText(item.source, 2, 120) ||
        !Number.isSafeInteger(item.observedAt) || item.observedAt < 0 ||
        !boundedText(item.statement, 8, 500)) {
      throw new TypeError("Evidence packet contains invalid or non-unique evidence");
    }
    ids.add(item.id);
  }
  return ids;
}

/**
 * Validates an untrusted analyst response against the exact evidence packet
 * supplied to the model. Citation membership is enforced; semantic entailment
 * remains a human-review responsibility.
 */
export function parseAiMarketAnalysis(
  input: unknown,
  evidence: readonly MarketAnalystEvidence[],
): Readonly<AiMarketAnalysis> {
  const evidenceIds = validateEvidencePacket(evidence);
  if (!isRecord(input) || Object.keys(input).some((key) => !ANALYSIS_FIELDS.has(key))) {
    throw new TypeError("AI market analysis contains an unexpected field or is not an object");
  }
  if (input.schemaVersion !== 1 ||
      !["bullish", "bearish", "mixed", "none"].includes(String(input.bias)) ||
      !["low", "moderate", "high"].includes(String(input.confidence)) ||
      typeof input.abstain !== "boolean" ||
      !boundedText(input.summary, 20, 400) ||
      !Array.isArray(input.contradictions) || input.contradictions.length > 8 ||
      input.contradictions.some((item) => !boundedText(item, 8, 300)) ||
      !Array.isArray(input.claims) || input.claims.length > 12) {
    throw new TypeError("AI market analysis does not match the required schema");
  }

  const claims = input.claims.map((claim): AiMarketClaim => {
    if (!isRecord(claim) || Object.keys(claim).some((key) => key !== "evidenceId" && key !== "statement") ||
        typeof claim.evidenceId !== "string" || !evidenceIds.has(claim.evidenceId) ||
        !boundedText(claim.statement, 8, 300)) {
      throw new TypeError("AI market analysis contains a claim with unknown evidence");
    }
    return Object.freeze({ evidenceId: claim.evidenceId, statement: claim.statement.trim() });
  });

  const abstentionReason = input.abstentionReason;
  if (input.abstain) {
    if (input.bias !== "none" || input.confidence !== "low" || claims.length !== 0 ||
        input.bullCase !== "" || input.bearCase !== "" ||
        !boundedText(abstentionReason, 8, 240)) {
      throw new TypeError("AI market analysis abstention must contain no directional bias or unsupported claims");
    }
    return Object.freeze({
      schemaVersion: 1,
      bias: "none",
      confidence: "low",
      summary: input.summary.trim(),
      bullCase: "",
      bearCase: "",
      contradictions: Object.freeze([]),
      claims: Object.freeze([]),
      abstain: true,
      abstentionReason: abstentionReason.trim(),
    });
  }

  if (input.bias === "none" || "abstentionReason" in input ||
      !boundedText(input.bullCase, 20, 800) ||
      !boundedText(input.bearCase, 20, 800) ||
      claims.length < 1) {
    throw new TypeError("Non-abstaining analysis requires a bias, balanced bull and bear cases, and cited claims");
  }

  return Object.freeze({
    schemaVersion: 1,
    bias: input.bias as AiMarketBias,
    confidence: input.confidence as AiMarketConfidence,
    summary: input.summary.trim(),
    bullCase: input.bullCase.trim(),
    bearCase: input.bearCase.trim(),
    contradictions: Object.freeze(input.contradictions.map((item: string) => item.trim())),
    claims: Object.freeze(claims),
    abstain: false,
  });
}
