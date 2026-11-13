import { validateCandles, type Candle } from "../domain/candles";

export const BINANCE_PUBLIC_DATA_URL = "https://data-api.binance.vision/api/v3/klines";

export const BINANCE_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type BinanceInterval = (typeof BINANCE_INTERVALS)[number];

export interface BinanceCandleRequest {
  symbol: string;
  interval: BinanceInterval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

type BinanceKlineRow = unknown[];

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new TypeError("Binance returned invalid " + field);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new TypeError("Binance returned invalid " + field);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Binance returned invalid " + field);
  return parsed;
}

/**
 * Fetches public spot OHLCV only. No API key or private account permission is used.
 * Open candles are excluded so callers never backtest against a candle that has not closed.
 */
export async function fetchBinanceCandles(
  request: BinanceCandleRequest,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Candle[]> {
  const symbol = request.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new RangeError("symbol must be a valid alphanumeric market pair");
  if (!BINANCE_INTERVALS.includes(request.interval)) throw new RangeError("Unsupported Binance candle interval");
  const limit = request.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("limit must be an integer between 1 and 1000");
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("now must be a non-negative timestamp");
  if (request.startTime !== undefined && (!Number.isSafeInteger(request.startTime) || request.startTime < 0)) {
    throw new RangeError("startTime must be a non-negative safe integer");
  }
  if (request.endTime !== undefined && (!Number.isSafeInteger(request.endTime) || request.endTime < 0)) {
    throw new RangeError("endTime must be a non-negative safe integer");
  }
  if (request.startTime !== undefined && request.endTime !== undefined && request.startTime > request.endTime) {
    throw new RangeError("startTime must be less than or equal to endTime");
  }

  const url = new URL(BINANCE_PUBLIC_DATA_URL);
  url.search = new URLSearchParams({
    symbol,
    interval: request.interval,
    limit: String(limit),
    ...(request.startTime === undefined ? {} : { startTime: String(request.startTime) }),
    ...(request.endTime === undefined ? {} : { endTime: String(request.endTime) }),
  }).toString();

  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Binance public market data request failed: HTTP " + response.status);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new TypeError("Binance returned an invalid candle payload");

  const candles: Candle[] = [];
  for (const raw of payload as BinanceKlineRow[]) {
    if (!Array.isArray(raw) || raw.length < 7) {
      throw new TypeError("Binance returned a malformed kline row");
    }
    const timestamp = parseNumber(raw[0], "open time");
    const closeTime = parseNumber(raw[6], "close time");
    if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(closeTime) || closeTime < timestamp) {
      throw new RangeError("Binance returned invalid candle timestamps");
    }
    if (closeTime > now) continue;

    candles.push({
      timestamp,
      open: parseNumber(raw[1], "open"),
      high: parseNumber(raw[2], "high"),
      low: parseNumber(raw[3], "low"),
      close: parseNumber(raw[4], "close"),
      volume: parseNumber(raw[5], "volume"),
    });
  }

  return validateCandles(candles);
}


const FIXED_BINANCE_INTERVAL_MS: Partial<Record<BinanceInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

export interface BinanceHistoryRequest extends Omit<BinanceCandleRequest, "limit" | "startTime" | "endTime"> {
  startTime: number;
  endTime: number;
  pageLimit?: number;
  maxCandles?: number;
}

/**
 * Bounded, sequential historical backfill. The cursor advances from the last
 * returned candle open time, and a non-advancing provider page fails closed.
 * Monthly candles are excluded because their duration is calendar-dependent.
 */
export async function fetchBinanceHistory(
  request: BinanceHistoryRequest,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Candle[]> {
  if (!Number.isSafeInteger(request.startTime) || request.startTime < 0 ||
      !Number.isSafeInteger(request.endTime) || request.endTime < 0 ||
      request.startTime > request.endTime) {
    throw new RangeError("startTime must be a non-negative timestamp less than or equal to endTime");
  }
  const intervalMs = FIXED_BINANCE_INTERVAL_MS[request.interval];
  if (!intervalMs) throw new RangeError("Historical pagination does not support calendar-month intervals");
  const pageLimit = request.pageLimit ?? 1000;
  const maxCandles = request.maxCandles ?? 10_000;
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000) {
    throw new RangeError("pageLimit must be an integer between 1 and 1000");
  }
  if (!Number.isInteger(maxCandles) || maxCandles < 1 || maxCandles > 100_000) {
    throw new RangeError("maxCandles must be an integer between 1 and 100000");
  }

  const history: Candle[] = [];
  let cursor = request.startTime;
  while (cursor <= request.endTime && history.length < maxCandles) {
    const remaining = maxCandles - history.length;
    const requestedLimit = Math.min(pageLimit, remaining);
    const responsePage = await fetchBinanceCandles({
      symbol: request.symbol,
      interval: request.interval,
      startTime: cursor,
      endTime: request.endTime,
      limit: requestedLimit,
    }, fetcher, now);
    const page = responsePage.slice(0, requestedLimit);
    if (page.length === 0) break;

    const previous = history[history.length - 1];
    if (previous && page[0].timestamp <= previous.timestamp) {
      throw new Error("Binance history pagination did not advance");
    }
    history.push(...page);

    const last = page[page.length - 1];
    const nextCursor = last.timestamp + intervalMs;
    if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor) {
      throw new Error("Binance history pagination did not advance");
    }
    cursor = nextCursor;
    if (page.length < requestedLimit) break;
  }

  return validateCandles(history);
}
