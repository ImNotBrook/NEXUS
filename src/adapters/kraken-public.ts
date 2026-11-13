import { validateCandles, type Candle } from "../domain/candles";

export const KRAKEN_PUBLIC_OHLC_URL = "https://api.kraken.com/0/public/OHLC";

export interface KrakenCandleRequest {
  symbol: string;
  interval: "1h";
}

interface KrakenResponse {
  error?: unknown;
  result?: Record<string, unknown>;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "string" && typeof value !== "number") throw new TypeError("Kraken returned invalid " + field);
  if (typeof value === "string" && value.trim() === "") throw new TypeError("Kraken returned invalid " + field);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Kraken returned invalid " + field);
  return parsed;
}

/** Public Kraken OHLC adapter. The final row is always excluded because Kraken marks it as uncommitted. */
export async function fetchKrakenCandles(
  request: KrakenCandleRequest,
  fetcher: typeof fetch = fetch,
): Promise<Candle[]> {
  const symbol = request.symbol.trim().toUpperCase();
  const pairs: Record<string, string> = { BTCUSD: "XBTUSD", BTCUSDT: "XBTUSDT" };
  const pair = pairs[symbol];
  if (!pair) throw new RangeError("Unsupported Kraken symbol; supported pairs are BTCUSD and BTCUSDT");
  if (request.interval !== "1h") throw new RangeError("Unsupported Kraken interval; only 1h is enabled");

  const url = new URL(KRAKEN_PUBLIC_OHLC_URL);
  url.search = new URLSearchParams({ pair, interval: "60" }).toString();
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Kraken public market data request failed: HTTP " + response.status);

  const payload = await response.json() as KrakenResponse;
  if (!payload || !Array.isArray(payload.error) || payload.error.length > 0 || !payload.result) {
    throw new Error("Kraken returned an API error or invalid response");
  }

  const pairKey = Object.keys(payload.result).find((key) => key !== "last");
  if (!pairKey || !Array.isArray(payload.result[pairKey])) {
    throw new TypeError("Kraken returned an invalid OHLC payload");
  }
  const rows = payload.result[pairKey] as unknown[];
  if (rows.length < 2) throw new Error("Kraken returned fewer than two OHLC rows");

  const candles: Candle[] = rows.slice(0, -1).map((raw) => {
    if (!Array.isArray(raw) || raw.length < 7) throw new TypeError("Kraken returned a malformed OHLC row");
    const seconds = number(raw[0], "timestamp");
    const timestamp = seconds * 1000;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError("Kraken returned invalid candle timestamp");
    return {
      timestamp,
      open: number(raw[1], "open"),
      high: number(raw[2], "high"),
      low: number(raw[3], "low"),
      close: number(raw[4], "close"),
      volume: number(raw[6], "volume"),
    };
  });

  return validateCandles(candles);
}
