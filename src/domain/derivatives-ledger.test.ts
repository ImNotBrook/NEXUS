import { describe, expect, it } from "vitest";
import { mergeStoredDerivativesHistory, type StoredDerivativesHistoryEntry } from "./derivatives-ledger";
import type { FundingRateObservation } from "./derivatives-data";

const first: FundingRateObservation = {
  metric: "funding_rate", provider: "bybit", symbol: "BTCUSDT", category: "linear",
  timestamp: 1_700_000_000_000, fundingRate: 0.0001, unit: "rate_per_settlement",
};

describe("mergeStoredDerivativesHistory", () => {
  it("preserves original ingestion timestamps and refreshes revised observations", () => {
    const old: StoredDerivativesHistoryEntry[] = [{ observation: first, ingestedAt: 10 }];
    const next = mergeStoredDerivativesHistory(old, [
      { ...first, timestamp: first.timestamp + 1000 },
      { ...first, fundingRate: 0.0002 },
    ], 0, 20);
    expect(next).toEqual([
      { observation: { ...first, fundingRate: 0.0002 }, ingestedAt: 20 },
      { observation: { ...first, timestamp: first.timestamp + 1000 }, ingestedAt: 20 },
    ]);
  });

  it("drops observations older than the configured retention cutoff", () => {
    const old: StoredDerivativesHistoryEntry[] = [{ observation: first, ingestedAt: 10 }];
    expect(mergeStoredDerivativesHistory(old, [], first.timestamp + 1, 20)).toEqual([]);
  });

  it("rejects mixed metric series and invalid ingestion times", () => {
    const other = { ...first, metric: "account_ratio" as const, longAccountRatio: 0.5, shortAccountRatio: 0.5, measurement: "account_share" as const };
    expect(() => mergeStoredDerivativesHistory([], [first, other], 0, 20)).toThrow(/same series/);
    expect(() => mergeStoredDerivativesHistory([], [first], 0, -1)).toThrow(/ingestedAt/);
  });
});
