import { describe, expect, it } from "vitest";
import {
  mergeDerivativesHistory,
  validateDerivativesObservations,
  type DerivativesObservation,
} from "./derivatives-data";

const funding: DerivativesObservation = {
  metric: "funding_rate", provider: "bybit", symbol: "BTCUSDT", category: "linear",
  timestamp: 1_700_000_000_000, fundingRate: 0.0001, unit: "rate_per_settlement",
};

const openInterest: DerivativesObservation = {
  metric: "open_interest", provider: "bybit", symbol: "BTCUSDT", category: "linear",
  timestamp: 1_700_000_000_000, openInterest: 12.5, unit: "base_asset",
};

const accountRatio: DerivativesObservation = {
  metric: "account_ratio", provider: "bybit", symbol: "BTCUSDT", category: "linear",
  timestamp: 1_700_000_000_000, longAccountRatio: 0.55, shortAccountRatio: 0.45,
  measurement: "account_share",
};

describe("derivatives observation validation", () => {
  it("accepts valid metric-specific observations and keeps provider semantics", () => {
    expect(validateDerivativesObservations([funding, openInterest, accountRatio])).toEqual([
      funding, openInterest, accountRatio,
    ]);
  });

  it("rejects invalid timestamps, non-finite values and metric/unit mismatches", () => {
    expect(() => validateDerivativesObservations([{ ...funding, timestamp: -1 }])).toThrow(/timestamp/);
    expect(() => validateDerivativesObservations([{ ...openInterest, openInterest: Number.NaN }])).toThrow(/openInterest/);
    expect(() => validateDerivativesObservations([{ ...accountRatio, longAccountRatio: 1.2 }])).toThrow(/account ratio/);
    expect(() => validateDerivativesObservations([{ ...openInterest, unit: "quote_currency" }])).toThrow(/unit/);
    expect(() => validateDerivativesObservations([{ ...funding, fundingRate: Infinity }])).toThrow(/fundingRate/);
    expect(() => validateDerivativesObservations([{ ...funding, provider: "bad|provider" }])).toThrow(/provider/);
  });
});

describe("mergeDerivativesHistory", () => {
  it("deduplicates by provider, instrument, category, metric and timestamp", () => {
    const revised = { ...funding, fundingRate: 0.0002 };
    const merged = mergeDerivativesHistory([funding], [revised, openInterest, accountRatio], 0);
    expect(merged).toHaveLength(3);
    expect(merged.find((item) => item.metric === "funding_rate")).toEqual(revised);
  });

  it("sorts observations chronologically and trims records before the retention cutoff", () => {
    const older = { ...funding, timestamp: 1_699_000_000_000 };
    const newer = { ...funding, timestamp: 1_701_000_000_000 };
    const merged = mergeDerivativesHistory([older], [newer], 1_700_000_000_000);
    expect(merged).toEqual([newer]);
  });

  it("does not merge observations from different providers or contract categories", () => {
    const otherProvider = { ...funding, provider: "other" };
    const inverse = {
      ...openInterest, symbol: "BTCUSD", category: "inverse" as const,
      unit: "quote_currency" as const,
    };
    expect(mergeDerivativesHistory([funding], [otherProvider, inverse], 0)).toHaveLength(3);
  });

  it("rejects an invalid retention cutoff", () => {
    expect(() => mergeDerivativesHistory([], [], -1)).toThrow(/cutoff/);
  });
});
