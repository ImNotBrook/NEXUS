import { evaluateDecision, type DecisionInput, type DecisionResult } from "./decision-engine";
import {
  createDecisionJournalId,
  DECISION_JOURNAL_SCHEMA_VERSION,
  type DecisionJournalRecord,
  type DecisionJournalSnapshotRef,
  type DecisionJournalThesis,
  type DecisionJournalVersions,
  validateDecisionJournalRecord,
} from "./decision-journal";

export interface DecisionJournalWriter {
  append(record: DecisionJournalRecord): Promise<DecisionJournalRecord>;
}

export interface DecisionJournalContext {
  /** Supply a pre-generated ID for deterministic replay; otherwise a secure UUID is generated. */
  decisionId?: string;
  clockSource: string;
  symbol: string;
  timeframe: string;
  marketSnapshotRefs: DecisionJournalSnapshotRef[];
  thesis: DecisionJournalThesis;
  versions: DecisionJournalVersions;
}

export interface JournalledDecisionResult {
  result: DecisionResult;
  record: DecisionJournalRecord;
}

/**
 * Evaluate and durably journal one decision. The result is returned only after
 * the append-only writer confirms persistence. Storage failure propagates.
 */
export async function evaluateAndJournalDecision(
  input: DecisionInput,
  context: DecisionJournalContext,
  journal: DecisionJournalWriter,
  randomUUID?: () => string,
): Promise<JournalledDecisionResult> {
  const result = evaluateDecision(input);
  const record: DecisionJournalRecord = {
    schemaVersion: DECISION_JOURNAL_SCHEMA_VERSION,
    decisionId: context.decisionId ?? createDecisionJournalId(randomUUID),
    decisionAt: input.evaluationTime,
    clockSource: context.clockSource,
    symbol: context.symbol,
    timeframe: context.timeframe,
    status: result.status,
    reasonCodes: [...result.reasonCodes],
    candidate: input.candidate ? structuredClone(input.candidate) : null,
    marketSnapshotRefs: structuredClone(context.marketSnapshotRefs),
    evidence: structuredClone(input.evidence),
    result: structuredClone(result),
    thesis: structuredClone(context.thesis),
    versions: structuredClone(context.versions),
  };

  validateDecisionJournalRecord(record);
  const persisted = await journal.append(record);
  return { result: structuredClone(result), record: structuredClone(persisted) };
}
