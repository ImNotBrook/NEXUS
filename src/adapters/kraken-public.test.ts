import { describe, expect, it, vi } from "vitest";
import { fetchKrakenCandles } from "./kraken-public";

function response(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as Response;
}

describe("fetchKrakenCandles", () => {
  it("maps XBTUSD data and excludes Kraken's uncommitted final row", async () => {
    let requestedUrl = "";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return response({
      error: [],
      result: {
        XXBTZUSD: [
          [1_700_000_000, "100", "110", "90", "105", "101", "12", 10],
          [1_700_003_600, "105", "115", "100", "112", "108", "15", 11],
          [1_700_007_200, "112", "120", "110", "118", "116", "8", 9],
        ],
        last: 1_700_010_000,
      },
    });
    });
    const candles = await fetchKrakenCandles({ symbol: "BTCUSD", interval: "1h" }, fetcher);
    expect(candles).toEqual([
      { timestamp: 1_700_000_000_000, open: 100, high: 110, low: 90, close: 105, volume: 12 },
      { timestamp: 1_700_003_600_000, open: 105, high: 115, low: 100, close: 112, volume: 15 },
    ]);
    expect(requestedUrl).toContain("pair=XBTUSD");
  });

  it("rejects unsupported symbols and intervals", async () => {
    await expect(fetchKrakenCandles({ symbol: "DOGEUSDT", interval: "1h" })).rejects.toThrow(/unsupported/i);
    await expect(fetchKrakenCandles({ symbol: "BTCUSD", interval: "15m" })).rejects.toThrow(/unsupported/i);
  });

  it("surfaces Kraken API errors and malformed payloads", async () => {
    await expect(fetchKrakenCandles({ symbol: "BTCUSD", interval: "1h" }, async () => response({ error: ["EGeneral:Temporary lockout"], result: {} }))).rejects.toThrow(/Kraken/i);
    await expect(fetchKrakenCandles({ symbol: "BTCUSD", interval: "1h" }, async () => response({ error: [], result: { last: 1 } }))).rejects.toThrow(/payload/i);
  });

  it("rejects non-finite candle fields", async () => {
    await expect(fetchKrakenCandles({ symbol: "BTCUSD", interval: "1h" }, async () => response({
      error: [], result: { XXBTZUSD: [[1_700_000_000, "bad", "110", "90", "105", "101", "12", 10], [1_700_003_600, "105", "115", "100", "112", "108", "15", 11]], last: 1 },
    }))).rejects.toThrow(/invalid/i);
  });
});
