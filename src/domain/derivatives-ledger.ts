import {
  mergeDerivativesHistory,
  validateDerivativesObservations,
  type DerivativesObservation,
} from "./derivatives-data";

export interface StoredDerivativesHistoryEntry {
  observation: DerivativesObservation;
  ingestedAt: number;
}

function seriesKey(item: DerivativesObservation): string {
  return [item.provider.toLowerCase(), item.symbol, item.category, item.metric].join("|");
}

function observationKey(item: DerivativesObservation): string {
  return seriesKey(item) + "|" + item.timestamp;
}

/** Merge one metric series while preserving original ingestion timestamps. */
export function mergeStoredDerivativesHistory(
  existing: readonly StoredDerivativesHistoryEntry[],
  incoming: readonly DerivativesObservation[],
  retentionCutoff: number,
  ingestedAt: number,
): StoredDerivativesHistoryEntry[] {
  if (!Number.isSafeInteger(ingestedAt) || ingestedAt < 0) {
    throw new RangeError("ingestedAt must be a non-negative safe integer timestamp");
  }
  const existingObservations = validateDerivativesObservations(existing.map((entry) => {
    if (!entry || !Number.isSafeInteger(entry.ingestedAt) || entry.ingestedAt < 0) {
      throw new RangeError("stored ingestedAt must be a non-negative safe integer timestamp");
    }
    return entry.observation;
  }));
  const incomingObservations = validateDerivativesObservations(incoming);
  const all = [...existingObservations, ...incomingObservations];
  if (all.length > 0 && all.some((item) => seriesKey(item) !== seriesKey(all[0]))) {
    throw new TypeError("All derivatives ledger observations must belong to the same series");
  }
  const priorByKey = new Map(existing.map((entry) => [observationKey(entry.observation), entry.ingestedAt]));
  const incomingKeys = new Set(incomingObservations.map(observationKey));
  return mergeDerivativesHistory(existingObservations, incomingObservations, retentionCutoff).map((observation) => {
    const key = observationKey(observation);
    return {
      observation,
      ingestedAt: incomingKeys.has(key) ? ingestedAt : (priorByKey.get(key) ?? ingestedAt),
    };
  });
}
