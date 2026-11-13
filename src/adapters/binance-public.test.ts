import { describe, expect, it, vi } from "vitest";
import { fetchBinanceCandles, fetchBinanceHistory } from "./binance-public";

const closed = [0, "100", "110", "90", "105", "12.5", 59_999, "0", 4, "100", "1250", "0"];
const open = [60_000, "105", "112", "101", "108", "9", 119_999, "0", 3, "100", "972", "0"];

describe("fetchBinanceCandles", () => {
  it("requests public spot klines and excludes the currently open candle", async () => {
    let requestedUrl: URL | undefined;
    const fetcher: typeof fetch = async (input) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify([closed, open]), { status: 200 });
    };

    const result = await fetchBinanceCandles(
      { symbol: "btcusdt", interval: "1m", limit: 100 },
      fetcher,
      60_000,
    );

    expect(result).toEqual([{
      timestamp: 0, open: 100, high: 110, low: 90, close: 105, volume: 12.5,
    }]);
    expect(requestedUrl?.hostname).toBe("data-api.binance.vision");
    expect(requestedUrl?.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(requestedUrl?.searchParams.get("interval")).toBe("1m");
    expect(requestedUrl?.searchParams.get("limit")).toBe("100");
  });

  it("rejects invalid symbol, interval and limit before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchBinanceCandles({ symbol: "BTC/USDT", interval: "1m" }, fetcher)).rejects.toThrow(/symbol/);
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "2m" as "1m" }, fetcher)).rejects.toThrow(/interval/);
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m", limit: 1001 }, fetcher)).rejects.toThrow(/limit/);
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m", endTime: -1 }, fetcher)).rejects.toThrow(/endTime/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects malformed rows and invalid OHLC values", async () => {
    const malformed: typeof fetch = async () => new Response(JSON.stringify([[1, "1"]]), { status: 200 });
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m" }, malformed, 100_000)).rejects.toThrow(/malformed/);

    const invalidOhlc = [0, "100", "99", "90", "105", "1", 59_999];
    const invalid: typeof fetch = async () => new Response(JSON.stringify([invalidOhlc]), { status: 200 });
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m" }, invalid, 60_000)).rejects.toThrow(/OHLC/);

    const nullOpen: typeof fetch = async () => new Response(JSON.stringify([[0, null, "110", "90", "105", "1", 59_999]]), { status: 200 });
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m" }, nullOpen, 60_000)).rejects.toThrow(/open/);
  });

  it("surfaces HTTP errors without treating them as empty market data", async () => {
    const failing: typeof fetch = async () => new Response("rate limited", { status: 429 });
    await expect(fetchBinanceCandles({ symbol: "BTCUSDT", interval: "1m" }, failing, 60_000)).rejects.toThrow(/HTTP 429/);
  });
});

describe("fetchBinanceHistory", () => {
  const rows = [
    [0, "100", "110", "90", "105", "12.5", 59_999],
    [60_000, "105", "112", "101", "108", "9", 119_999],
    [120_000, "108", "115", "104", "112", "7", 179_999],
  ];

  it("paginates sequentially from startTime without duplicates", async () => {
    const requestedStarts: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requestedStarts.push(url.searchParams.get("startTime") ?? "");
      const start = Number(url.searchParams.get("startTime"));
      const limit = Number(url.searchParams.get("limit"));
      return new Response(JSON.stringify(rows.filter((row) => Number(row[0]) >= start).slice(0, limit)), { status: 200 });
    };

    const result = await fetchBinanceHistory({
      symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 179_999, pageLimit: 2,
    }, fetcher, 240_000);

    expect(result.map((candle) => candle.timestamp)).toEqual([0, 60_000, 120_000]);
    expect(requestedStarts).toEqual(["0", "120000"]);
  });

  it("rejects a provider page that does not advance the pagination cursor", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(rows.slice(0, 2)), { status: 200 });
    };
    await expect(fetchBinanceHistory({
      symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 300_000, pageLimit: 2,
    }, fetcher, 400_000)).rejects.toThrow(/pagination did not advance/i);
    expect(calls).toBe(2);
  });

  it("validates the date range before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchBinanceHistory({
      symbol: "BTCUSDT", interval: "1m", startTime: 100, endTime: 99,
    }, fetcher, 200_000)).rejects.toThrow(/startTime.*endTime/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enforces a maximum candle budget across pages", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify(rows), { status: 200 });
    const result = await fetchBinanceHistory({
      symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 300_000,
      pageLimit: 2, maxCandles: 2,
    }, fetcher, 400_000);
    expect(result).toHaveLength(2);
  });
});
