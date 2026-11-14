import type { DecisionJournalRecord } from "./decision-journal";

export interface DecisionJournalListItem {
  decisionId: string;
  symbol: string;
  timeframe: string;
  status: DecisionJournalRecord["status"];
  reasonSummary: string;
  thesisSummary: string;
  decisionAt: number;
}

function readableCode(value: string): string {
  return value.replaceAll("_", " ").toUpperCase();
}

/** Derives a display-only row; the immutable journal record is never modified. */
export function buildDecisionJournalListItem(
  record: DecisionJournalRecord,
): DecisionJournalListItem {
  return {
    decisionId: record.decisionId,
    symbol: record.symbol,
    timeframe: record.timeframe,
    status: record.status,
    reasonSummary: record.reasonCodes.map(readableCode).join(" · ") || "NO REASON CODE",
    thesisSummary: record.thesis.bullCase[0] ?? record.thesis.bearCase[0] ??
      record.thesis.alternatives[0] ?? "No thesis summary recorded",
    decisionAt: record.decisionAt,
  };
}

/** Export the complete immutable records, not their abbreviated display rows. */
export function serializeDecisionJournalExport(
  records: readonly DecisionJournalRecord[],
): string {
  return JSON.stringify(records, null, 2);
}
