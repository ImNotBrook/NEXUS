import type { DecisionCandidate, DecisionResult, DecisionStatus, EvidenceItem } from "./decision-engine";

export const DECISION_JOURNAL_SCHEMA_VERSION = 1 as const;

export interface DecisionJournalSnapshotRef {
  snapshotId: string;
  contentHash: string;
}

export interface DecisionJournalThesis {
  bullCase: string[];
  bearCase: string[];
  alternatives: string[];
  invalidation: string[];
}

export interface DecisionJournalVersions {
  engine: string;
  score: string;
  strategy: string;
  riskPolicy: string;
}

/** Frozen decision-time facts. Later fills and outcomes belong in linked events. */
export interface DecisionJournalRecord {
  schemaVersion: typeof DECISION_JOURNAL_SCHEMA_VERSION;
  decisionId: string;
  decisionAt: number;
  clockSource: string;
  symbol: string;
  timeframe: string;
  status: DecisionStatus;
  reasonCodes: string[];
  candidate: DecisionCandidate | null;
  marketSnapshotRefs: DecisionJournalSnapshotRef[];
  /** Includes rejected inputs so the audit record preserves what the kernel saw. */
  evidence: EvidenceItem[];
  result: DecisionResult;
  thesis: DecisionJournalThesis;
  versions: DecisionJournalVersions;
}

export type DecisionJournalEventType =
  | "paper_execution_linked"
  | "outcome_appended"
  | "correction_appended";

export interface DecisionJournalEvent {
  schemaVersion: typeof DECISION_JOURNAL_SCHEMA_VERSION;
  eventId: string;
  decisionId: string;
  eventType: DecisionJournalEventType;
  occurredAt: number;
  payload: Record<string, unknown>;
}


function secureUuid(): string {
  const generator = globalThis.crypto?.randomUUID;
  if (typeof generator !== "function") {
    throw new Error("Secure UUID generation is unavailable in this environment");
  }
  return generator.call(globalThis.crypto);
}

/** Collision-resistant identifiers; wall-clock time is deliberately not used as identity. */
export function createDecisionJournalId(randomUUID: () => string = secureUuid): string {
  const value = randomUUID();
  if (!requiredString(value)) throw new TypeError("A secure UUID is required for a decision ID");
  return "decision:" + value;
}

export function createDecisionJournalEventId(randomUUID: () => string = secureUuid): string {
  const value = randomUUID();
  if (!requiredString(value)) throw new TypeError("A secure UUID is required for an event ID");
  return "event:" + value;
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

export function validateDecisionJournalRecord(record: DecisionJournalRecord): void {
  if (!record || typeof record !== "object") throw new TypeError("A decision journal record is required");
  if (record.schemaVersion !== DECISION_JOURNAL_SCHEMA_VERSION) throw new TypeError("Unsupported decision journal schema version");
  if (!requiredString(record.decisionId)) throw new TypeError("decisionId is required");
  if (!validTimestamp(record.decisionAt)) throw new RangeError("decisionAt must be a non-negative safe integer");
  if (!requiredString(record.clockSource)) throw new TypeError("clockSource is required");
  if (!requiredString(record.symbol) || !requiredString(record.timeframe)) throw new TypeError("Decision symbol and timeframe are required");
  if (!["ENTER", "WAIT", "REJECT", "NO_SETUP"].includes(record.status)) throw new TypeError("Decision status is invalid");
  if (!Array.isArray(record.reasonCodes) || record.reasonCodes.some((code) => !requiredString(code))) {
    throw new TypeError("Decision reason codes must be non-empty strings");
  }
  if (!record.result || record.result.status !== record.status) throw new TypeError("Journal status must match the kernel result");
  if (!Array.isArray(record.marketSnapshotRefs) || record.marketSnapshotRefs.length === 0 ||
      record.marketSnapshotRefs.some((ref) => !requiredString(ref.snapshotId) || !requiredString(ref.contentHash))) {
    throw new TypeError("At least one market snapshot reference with a content hash is required");
  }
  if (!Array.isArray(record.evidence)) throw new TypeError("Evidence snapshot must be an array");
  const evidenceIds = new Set<string>();
  for (const item of record.evidence) {
    if (!item || !requiredString(item.id)) throw new TypeError("Every journalled evidence item requires an ID");
    if (evidenceIds.has(item.id)) throw new TypeError("Evidence IDs must be unique within a decision");
    evidenceIds.add(item.id);
  }
  const referencedIds = [
    ...record.result.supportingEvidenceIds,
    ...record.result.contradictingEvidenceIds,
    ...record.result.invalidEvidence.map((item) => item.evidenceId),
  ];
  if (referencedIds.some((id) => !evidenceIds.has(id))) {
    throw new TypeError("Kernel result references evidence absent from the immutable input snapshot");
  }
  if (record.status === "ENTER" && !record.candidate) throw new TypeError("ENTER requires a candidate");
  if (record.status === "NO_SETUP" && record.candidate) throw new TypeError("NO_SETUP cannot contain a candidate");
  if (record.candidate && (
    !requiredString(record.candidate.id) ||
    record.candidate.symbol !== record.symbol ||
    record.candidate.timeframe !== record.timeframe
  )) {
    throw new TypeError("Candidate identity and scope must match the journal record");
  }
  if (!record.thesis || !["bullCase", "bearCase", "alternatives", "invalidation"].every((key) =>
    Array.isArray(record.thesis[key as keyof DecisionJournalThesis]) &&
    record.thesis[key as keyof DecisionJournalThesis].every(requiredString)
  )) {
    throw new TypeError("Thesis cases and invalidation must be arrays of non-empty statements");
  }
  if (!record.versions || !["engine", "score", "strategy", "riskPolicy"].every((key) =>
    requiredString(record.versions[key as keyof DecisionJournalVersions])
  )) {
    throw new TypeError("Engine, score, strategy and risk-policy versions are required");
  }
}

export function validateDecisionJournalEvent(event: DecisionJournalEvent): void {
  if (!event || typeof event !== "object") throw new TypeError("A decision journal event is required");
  if (event.schemaVersion !== DECISION_JOURNAL_SCHEMA_VERSION) throw new TypeError("Unsupported decision event schema version");
  if (!requiredString(event.eventId) || !requiredString(event.decisionId)) throw new TypeError("Event and decision IDs are required");
  if (!["paper_execution_linked", "outcome_appended", "correction_appended"].includes(event.eventType)) {
    throw new TypeError("Decision event type is invalid");
  }
  if (!validTimestamp(event.occurredAt)) throw new RangeError("occurredAt must be a non-negative safe integer");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload) || !isJsonValue(event.payload)) {
    throw new TypeError("Event payload must be a JSON-safe object");
  }
}
