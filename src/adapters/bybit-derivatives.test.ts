import { describe, expect, it, vi } from "vitest";
import {
  fetchBybitAccountRatio,
  fetchBybitFundingHistory,
  fetchBybitOpenInterest,
} from "./bybit-derivatives";

function response(result: unknown, retCode = 0, ok = true, status = 200): Response {
  return {
    ok, status,
    json: async () => ({ retCode, retMsg: retCode === 0 ? "OK" : "error", result }),
  } as Response;
}

describe("Bybit public derivatives data", () => {
  it("normalizes funding history to ascending millisecond observations", async () => {
    let url = "";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      url = String(input);
      return response({ list: [
        { symbol: "BTCUSDT", fundingRate: "0.0002", fundingRateTimestamp: "1700007200000" },
        { symbol: "BTCUSDT", fundingRate: "0.0001", fundingRateTimestamp: "1700000000000" },
      ] });
    });
    const result = await fetchBybitFundingHistory({ symbol: "btcusdt", category: "linear" }, fetcher);
    expect(result.map((item) => item.timestamp)).toEqual([1_700_000_000_000, 1_700_007_200_000]);
    expect(result[0]).toMatchObject({ provider: "bybit", symbol: "BTCUSDT", category: "linear", fundingRate: 0.0001 });
    expect(url).toContain("/v5/market/funding/history");
    expect(url).toContain("category=linear");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires start and end timestamps together for funding history", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchBybitFundingHistory({
      symbol: "BTCUSDT", category: "linear", startTime: 1_700_000_000_000,
    }, fetcher)).rejects.toThrow(/startTime and endTime must be supplied together/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the documented unit distinction for open interest", async () => {
    const result = await fetchBybitOpenInterest({
      symbol: "BTCUSDT", category: "linear", intervalTime: "1h",
    }, async () => response({ list: [
      { timestamp: "1700003600000", openInterest: "123.45" },
      { timestamp: "1700000000000", openInterest: "120.5" },
    ], nextPageCursor: "next" }));
    expect(result.observations.map((item) => item.timestamp)).toEqual([1_700_000_000_000, 1_700_003_600_000]);
    expect(result.observations[0]).toMatchObject({ openInterest: 120.5, unit: "base_asset" });
    expect(result.nextPageCursor).toBe("next");
  });

  it("labels inverse open interest in quote currency units", async () => {
    const result = await fetchBybitOpenInterest({
      symbol: "BTCUSD", category: "inverse", intervalTime: "1h",
    }, async () => response({ list: [{ timestamp: "1700000000000", openInterest: "1000000" }] }));
    expect(result.observations[0].unit).toBe("quote_currency");
  });

  it("normalizes account ratios without mislabelling them as notional positions", async () => {
    const result = await fetchBybitAccountRatio({
      symbol: "BTCUSDT", category: "linear", period: "1h",
    }, async () => response({ list: [
      { timestamp: "1700003600000", buyRatio: "0.55", sellRatio: "0.45" },
      { timestamp: "1700000000000", buyRatio: "0.52", sellRatio: "0.48" },
    ] }));
    expect(result.map((item) => item.timestamp)).toEqual([1_700_000_000_000, 1_700_003_600_000]);
    expect(result[0]).toMatchObject({ longAccountRatio: 0.52, shortAccountRatio: 0.48, measurement: "account_share" });
  });

  it("rejects provider errors, malformed values and duplicate timestamps", async () => {
    await expect(fetchBybitFundingHistory({ symbol: "BTCUSDT", category: "linear" },
      async () => response({ list: [] }, 10001))).rejects.toThrow(/retCode/);
    await expect(fetchBybitFundingHistory({ symbol: "BTCUSDT", category: "linear" },
      async () => response({ list: [{ symbol: "BTCUSDT", fundingRate: "bad", fundingRateTimestamp: "1700000000000" }] }))).rejects.toThrow(/fundingRate/);
    await expect(fetchBybitOpenInterest({ symbol: "BTCUSDT", category: "linear", intervalTime: "1h" },
      async () => response({ list: [
        { timestamp: "1700000000000", openInterest: "1" },
        { timestamp: "1700000000000", openInterest: "2" },
      ] }))).rejects.toThrow(/duplicate/i);
    await expect(fetchBybitAccountRatio({ symbol: "BTCUSDT", category: "linear", period: "1h" },
      async () => response({ list: [{ timestamp: "1700000000000", buyRatio: "1.2", sellRatio: "-0.2" }] }))).rejects.toThrow(/ratio/);
  });

  it("rejects unsupported symbols, categories, intervals and HTTP failures", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchBybitFundingHistory({ symbol: "BTC/USDT", category: "linear" }, fetcher)).rejects.toThrow(/symbol/);
    await expect(fetchBybitFundingHistory({ symbol: "BTCUSDT", category: "spot" as "linear" }, fetcher)).rejects.toThrow(/category/);
    await expect(fetchBybitOpenInterest({ symbol: "BTCUSDT", category: "linear", intervalTime: "2h" as "1h" }, fetcher)).rejects.toThrow(/intervalTime/);
    await expect(fetchBybitFundingHistory({ symbol: "BTCUSDT", category: "linear" },
      async () => response({}, 0, false, 429))).rejects.toThrow(/HTTP 429/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
