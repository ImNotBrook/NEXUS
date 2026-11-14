import {
  validateDecisionJournalEvent,
  type DecisionJournalEvent,
  type DecisionJournalRecord,
} from "./decision-journal";
import type { Candle } from "./candles";
import {
  findFirstCausalDonchianTrigger,
  NO_SETUP_REPLAY_INTERVAL_MS,
  type NoSetupReplaySpec,
} from "./no-setup-replay";

export interface NoSetupReplayServiceJournal {
  list(): Promise<DecisionJournalRecord[]>;
  listEvents(decisionId: string): Promise<DecisionJournalEvent[]>;
  appendEvent(event: DecisionJournalEvent): Promise<DecisionJournalEvent>;
}

export interface NoSetupReplayServiceReport {
  decisionsScanned: number;
  replaySpecsFound: number;
  evaluated: number;
  triggersDetected: number;
  noTrigger: number;
  alreadyDetected: number;
  failures: Array<{ decisionId: string; reason: string }>;
}

export type NoSetupReplayHistoryFetcher = (
  spec: NoSetupReplaySpec,
  startTime: number,
  endTime: number,
) => Promise<readonly Candle[]>;

/**
 * Manually evaluates only decision-time registered replay specs. A detected
 * trigger is a Donchian-only diagnostic, not a simulated fill or full-strategy
 * missed trade. It is never promoted into shadow P&L statistics.
 */
export async function evaluateNoSetupReplays(input: {
  journal: NoSetupReplayServiceJournal;
  now: number;
  fetchHistory: NoSetupReplayHistoryFetcher;
}): Promise<NoSetupReplayServiceReport> {
  if (!input || !input.journal) throw new TypeError("A NO_SETUP replay journal is required");
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new RangeError("Replay evaluation time must be a non-negative safe integer");
  }
  const records = await input.journal.list();
  const report: NoSetupReplayServiceReport = {
    decisionsScanned: records.length,
    replaySpecsFound: 0,
    evaluated: 0,
    triggersDetected: 0,
    noTrigger: 0,
    alreadyDetected: 0,
    failures: [],
  };

  for (const record of records) {
    try {
      const events = await input.journal.listEvents(record.decisionId);
      const registration = events.find((event) => event.eventType === "no_setup_replay_registered");
      if (!registration) continue;
      report.replaySpecsFound += 1;
      if (record.status !== "NO_SETUP" || registration.occurredAt !== record.decisionAt) {
        throw new Error("Replay registration is not attached to its original NO_SETUP decision time");
      }
      const spec = registration.payload.spec as NoSetupReplaySpec | undefined;
      if (!spec || spec.decisionId !== record.decisionId || spec.decisionAt !== record.decisionAt) {
        throw new Error("Frozen replay specification is missing or mismatched");
      }
      if (events.some((event) => event.eventType === "missed_opportunity_detected")) {
        report.alreadyDetected += 1;
        continue;
      }
      const startTime = (Math.floor(spec.decisionAt / NO_SETUP_REPLAY_INTERVAL_MS) + 1) *
        NO_SETUP_REPLAY_INTERVAL_MS;
      const candles = input.now < startTime
        ? []
        : await input.fetchHistory(spec, startTime, input.now);
      const result = findFirstCausalDonchianTrigger(spec, candles, input.now);
      report.evaluated += 1;
      if (result.status === "no_trigger") {
        report.noTrigger += 1;
        continue;
      }
      const event: DecisionJournalEvent = {
        schemaVersion: 1,
        eventId: "missed-opportunity:" + record.decisionId + ":" + result.trigger.timestamp,
        decisionId: record.decisionId,
        eventType: "missed_opportunity_detected",
        occurredAt: input.now,
        payload: {
          detectorVersion: spec.detectorVersion,
          diagnosticScope: "donchian_only",
          fullStrategyFiltersReplayed: false,
          simulatedTrade: false,
          evaluationBars: result.evaluationBars,
          evaluationAsOf: input.now,
          trigger: result.trigger,
        },
      };
      validateDecisionJournalEvent(event);
      const persisted = await input.journal.appendEvent(event);
      if (persisted.eventId !== event.eventId) {
        throw new Error("Journal returned a different missed-opportunity event identity");
      }
      report.triggersDetected += 1;
    } catch (error) {
      report.failures.push({
        decisionId: record.decisionId,
        reason: error instanceof Error ? error.message : "Unknown NO_SETUP replay failure",
      });
    }
  }
  return report;
}
