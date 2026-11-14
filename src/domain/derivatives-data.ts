export type DerivativesCategory = "linear" | "inverse";
export type DerivativesMetric = "funding_rate" | "open_interest" | "account_ratio";

interface DerivativesObservationBase {
  provider: string;
  symbol: string;
  category: DerivativesCategory;
  timestamp: number;
}

export interface FundingRateObservation extends DerivativesObservationBase {
  metric: "funding_rate";
  fundingRate: number;
  unit: "rate_per_settlement";
}

export interface OpenInterestObservation extends DerivativesObservationBase {
  metric: "open_interest";
  openInterest: number;
  unit: "base_asset" | "quote_currency";
}

export interface AccountRatioObservation extends DerivativesObservationBase {
  metric: "account_ratio";
  longAccountRatio: number;
  shortAccountRatio: number;
  measurement: "account_share";
}

export type DerivativesObservation =
  | FundingRateObservation
  | OpenInterestObservation
  | AccountRatioObservation;

/** Validate metric semantics before data is persisted or used in research. */
export function validateDerivativesObservations(
  input: readonly DerivativesObservation[],
): DerivativesObservation[] {
  if (!Array.isArray(input)) throw new TypeError("Derivatives observations must be an array");
  return input.map((observation) => {
    if (!observation || typeof observation !== "object") {
      throw new TypeError("Derivatives observation must be an object");
    }
    if (typeof observation.provider !== "string" || !observation.provider.trim()) {
      throw new TypeError("provider is required");
    }
    if (typeof observation.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(observation.symbol)) {
      throw new TypeError("symbol must be a normalized uppercase market symbol");
    }
    if (observation.category !== "linear" && observation.category !== "inverse") {
      throw new TypeError("category must be linear or inverse");
    }
    if (!Number.isSafeInteger(observation.timestamp) || observation.timestamp < 0) {
      throw new RangeError("timestamp must be a non-negative safe integer in milliseconds");
    }

    if (observation.metric === "funding_rate") {
      if (!Number.isFinite(observation.fundingRate)) throw new TypeError("fundingRate must be finite");
      if (observation.unit !== "rate_per_settlement") throw new TypeError("funding rate unit is invalid");
    } else if (observation.metric === "open_interest") {
      if (!Number.isFinite(observation.openInterest) || observation.openInterest < 0) {
        throw new RangeError("openInterest must be finite and non-negative");
      }
      const expectedUnit = observation.category === "linear" ? "base_asset" : "quote_currency";
      if (observation.unit !== expectedUnit) {
        throw new TypeError("open-interest unit does not match contract category");
      }
    } else if (observation.metric === "account_ratio") {
      if (observation.measurement !== "account_share") throw new TypeError("account ratio measurement is invalid");
      if (!Number.isFinite(observation.longAccountRatio) || observation.longAccountRatio < 0 ||
          observation.longAccountRatio > 1 || !Number.isFinite(observation.shortAccountRatio) ||
          observation.shortAccountRatio < 0 || observation.shortAccountRatio > 1) {
        throw new RangeError("account ratio values must be finite and between 0 and 1");
      }
    } else {
      throw new TypeError("Unsupported derivatives metric");
    }
    return { ...observation } as DerivativesObservation;
  });
}

function observationKey(item: DerivativesObservation): string {
  return [item.provider, item.symbol, item.category, item.metric, item.timestamp].join("|");
}

/**
 * Merge a new batch into a bounded history. Incoming observations replace the
 * same provider/market/metric/timestamp key; unrelated venues and units stay separate.
 */
export function mergeDerivativesHistory(
  existing: readonly DerivativesObservation[],
  incoming: readonly DerivativesObservation[],
  retentionCutoff: number,
): DerivativesObservation[] {
  if (!Number.isSafeInteger(retentionCutoff) || retentionCutoff < 0) {
    throw new RangeError("retention cutoff must be a non-negative safe integer timestamp");
  }
  const validated = [
    ...validateDerivativesObservations(existing),
    ...validateDerivativesObservations(incoming),
  ];
  const byKey = new Map<string, DerivativesObservation>();
  for (const observation of validated) {
    if (observation.timestamp >= retentionCutoff) byKey.set(observationKey(observation), observation);
  }
  return [...byKey.values()].sort((a, b) =>
    a.timestamp - b.timestamp ||
    a.provider.localeCompare(b.provider) ||
    a.symbol.localeCompare(b.symbol) ||
    a.metric.localeCompare(b.metric),
  );
}
