export const BYBIT_PUBLIC_API_BASE = "https://api.bybit.com";

export type BybitCategory = "linear" | "inverse";
export type BybitMarketInterval = "5min" | "15min" | "30min" | "1h" | "4h" | "1d";

interface BaseRequest {
  symbol: string;
  category: BybitCategory;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface BybitFundingRequest extends BaseRequest {}

export interface BybitOpenInterestRequest extends BaseRequest {
  intervalTime: BybitMarketInterval;
  cursor?: string;
}

export interface BybitAccountRatioRequest extends BaseRequest {
  period: BybitMarketInterval;
  cursor?: string;
}

interface BybitObservationBase {
  provider: "bybit";
  symbol: string;
  category: BybitCategory;
  timestamp: number;
}

export interface FundingRateObservation extends BybitObservationBase {
  fundingRate: number;
  unit: "rate_per_settlement";
}

export interface OpenInterestObservation extends BybitObservationBase {
  openInterest: number;
  /** Bybit documents linear OI in base asset and inverse OI in quote currency (USD). */
  unit: "base_asset" | "quote_currency";
}

export interface AccountRatioObservation extends BybitObservationBase {
  longAccountRatio: number;
  shortAccountRatio: number;
  measurement: "account_share";
}

export interface BybitOpenInterestPage {
  observations: OpenInterestObservation[];
  nextPageCursor: string | null;
}

interface BybitEnvelope {
  retCode?: unknown;
  retMsg?: unknown;
  result?: unknown;
}

function validateRequest(request: BaseRequest, maxLimit: number, defaultLimit: number): {
  symbol: string; category: BybitCategory; limit: number;
} {
  if (!request || typeof request !== "object") throw new TypeError("request is required");
  const symbol = typeof request.symbol === "string" ? request.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,30}$/.test(symbol)) throw new RangeError("symbol must be an alphanumeric market symbol");
  if (request.category !== "linear" && request.category !== "inverse") {
    throw new RangeError("category must be linear or inverse");
  }
  const limit = request.limit ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new RangeError("limit must be between 1 and " + maxLimit);
  }
  for (const [field, value] of [["startTime", request.startTime], ["endTime", request.endTime]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(field + " must be a non-negative safe integer");
    }
  }
  if (request.startTime !== undefined && request.endTime !== undefined && request.startTime > request.endTime) {
    throw new RangeError("startTime must be less than or equal to endTime");
  }
  return { symbol, category: request.category, limit };
}

function numeric(value: unknown, field: string): number {
  if ((typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "string" && value.trim() === "")) {
    throw new TypeError("Bybit returned invalid " + field);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Bybit returned invalid " + field);
  return parsed;
}

function timestamp(value: unknown): number {
  const parsed = numeric(value, "timestamp");
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError("Bybit returned invalid timestamp");
  return parsed;
}

async function requestList(
  path: string,
  params: Record<string, string>,
  fetcher: typeof fetch,
): Promise<{ list: unknown[]; nextPageCursor: string | null }> {
  const url = new URL(path, BYBIT_PUBLIC_API_BASE);
  url.search = new URLSearchParams(params).toString();
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Bybit public derivatives request failed: HTTP " + response.status);
  const payload = await response.json() as BybitEnvelope;
  if (!payload || payload.retCode !== 0) {
    throw new Error("Bybit returned non-zero retCode: " + String(payload?.retCode ?? "missing"));
  }
  if (!payload.result || typeof payload.result !== "object") {
    throw new TypeError("Bybit returned an invalid result object");
  }
  const result = payload.result as { list?: unknown; nextPageCursor?: unknown };
  if (!Array.isArray(result.list)) throw new TypeError("Bybit returned an invalid list");
  const nextPageCursor = result.nextPageCursor;
  if (nextPageCursor !== undefined && typeof nextPageCursor !== "string") {
    throw new TypeError("Bybit returned an invalid nextPageCursor");
  }
  return { list: result.list, nextPageCursor: typeof nextPageCursor === "string" && nextPageCursor ? nextPageCursor : null };
}

function sortAndValidate<T extends { timestamp: number }>(items: T[]): T[] {
  items.sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].timestamp === items[index - 1].timestamp) {
      throw new RangeError("Bybit returned duplicate observation timestamps");
    }
  }
  return items;
}

/** Public funding history. Bybit rejects a startTime without an endTime. */
export async function fetchBybitFundingHistory(
  request: BybitFundingRequest,
  fetcher: typeof fetch = fetch,
): Promise<FundingRateObservation[]> {
  const normalized = validateRequest(request, 200, 200);
  if ((request.startTime === undefined) !== (request.endTime === undefined)) {
    throw new RangeError("startTime and endTime must be supplied together for funding history");
  }
  const params: Record<string, string> = {
    category: normalized.category, symbol: normalized.symbol, limit: String(normalized.limit),
  };
  if (request.startTime !== undefined) params.startTime = String(request.startTime);
  if (request.endTime !== undefined) params.endTime = String(request.endTime);
  const { list } = await requestList("/v5/market/funding/history", params, fetcher);
  return sortAndValidate(list.map((row): FundingRateObservation => {
    if (!row || typeof row !== "object") throw new TypeError("Bybit returned a malformed funding row");
    const item = row as Record<string, unknown>;
    if (item.symbol !== normalized.symbol) throw new TypeError("Bybit funding symbol did not match request");
    return {
      provider: "bybit", symbol: normalized.symbol, category: normalized.category,
      timestamp: timestamp(item.fundingRateTimestamp),
      fundingRate: numeric(item.fundingRate, "fundingRate"),
      unit: "rate_per_settlement",
    };
  }));
}

/** One bounded public OI page. The caller persists nextPageCursor and resumes deliberately. */
export async function fetchBybitOpenInterest(
  request: BybitOpenInterestRequest,
  fetcher: typeof fetch = fetch,
): Promise<BybitOpenInterestPage> {
  const normalized = validateRequest(request, 200, 50);
  if (!["5min", "15min", "30min", "1h", "4h", "1d"].includes(request.intervalTime)) {
    throw new RangeError("intervalTime is unsupported");
  }
  const params: Record<string, string> = {
    category: normalized.category, symbol: normalized.symbol,
    intervalTime: request.intervalTime, limit: String(normalized.limit),
  };
  if (request.startTime !== undefined) params.startTime = String(request.startTime);
  if (request.endTime !== undefined) params.endTime = String(request.endTime);
  if (request.cursor) params.cursor = request.cursor;
  const { list, nextPageCursor } = await requestList("/v5/market/open-interest", params, fetcher);
  const unit = normalized.category === "linear" ? "base_asset" : "quote_currency";
  const observations = sortAndValidate(list.map((row): OpenInterestObservation => {
    if (!row || typeof row !== "object") throw new TypeError("Bybit returned a malformed open-interest row");
    const item = row as Record<string, unknown>;
    return {
      provider: "bybit", symbol: normalized.symbol, category: normalized.category,
      timestamp: timestamp(item.timestamp),
      openInterest: numeric(item.openInterest, "openInterest"),
      unit,
    };
  }));
  if (observations.some((item) => item.openInterest < 0)) throw new RangeError("openInterest cannot be negative");
  return { observations, nextPageCursor };
}

/** Public long/short account ratio. These are account shares, not notional position sizes. */
export async function fetchBybitAccountRatio(
  request: BybitAccountRatioRequest,
  fetcher: typeof fetch = fetch,
): Promise<AccountRatioObservation[]> {
  const normalized = validateRequest(request, 500, 50);
  if (!["5min", "15min", "30min", "1h", "4h", "1d"].includes(request.period)) {
    throw new RangeError("period is unsupported");
  }
  const params: Record<string, string> = {
    category: normalized.category, symbol: normalized.symbol,
    period: request.period, limit: String(normalized.limit),
  };
  if (request.startTime !== undefined) params.startTime = String(request.startTime);
  if (request.endTime !== undefined) params.endTime = String(request.endTime);
  if (request.cursor) params.cursor = request.cursor;
  const { list } = await requestList("/v5/market/account-ratio", params, fetcher);
  const observations = sortAndValidate(list.map((row): AccountRatioObservation => {
    if (!row || typeof row !== "object") throw new TypeError("Bybit returned a malformed account-ratio row");
    const item = row as Record<string, unknown>;
    const longAccountRatio = numeric(item.buyRatio, "buyRatio");
    const shortAccountRatio = numeric(item.sellRatio, "sellRatio");
    if (longAccountRatio < 0 || longAccountRatio > 1 || shortAccountRatio < 0 || shortAccountRatio > 1) {
      throw new RangeError("Bybit account ratio values must be between 0 and 1");
    }
    return {
      provider: "bybit", symbol: normalized.symbol, category: normalized.category,
      timestamp: timestamp(item.timestamp),
      longAccountRatio, shortAccountRatio, measurement: "account_share",
    };
  }));
  return observations;
}
