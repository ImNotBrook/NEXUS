import { validateCandles, type Candle } from "./candles";
import type { MarketSnapshot } from "./market-data";

export type QualityStatus = "pass" | "warning" | "fail";
export type QualityIssueCode =
  | "INVALID_CANDLES"
  | "NO_CANDLES"
  | "CANDLE_GAP"
  | "MISALIGNED_CANDLE"
  | "ZERO_VOLUME"
  | "STALE_SNAPSHOT"
  | "FUTURE_SNAPSHOT"
  | "INVALID_FETCH_TIME"
  | "INCOMPLETE_LAST_CANDLE"
  | "LAST_CANDLE_STALE";

export interface QualityIssue {
  code: QualityIssueCode;
  severity: "warning" | "error";
  message: string;
  candleTimestamp?: number;
}

export interface SnapshotQualityReport {
  status: QualityStatus;
  symbol: string;
  interval: string;
  provider: string;
  candleCount: number;
  issues: QualityIssue[];
}

export interface SnapshotQualityOptions {
  now: number;
  intervalMs: number;
  maxAgeMs: number;
}

export interface SnapshotComparison {
  status: "within_tolerance" | "discrepancy" | "insufficient_overlap";
  symbol: string;
  interval: string;
  primaryProvider: string;
  secondaryProvider: string;
  comparedCandles: number;
  latestTimestampMatched: boolean;
  maxDeviationBps: number | null;
  deviations: Array<{ timestamp: number; deviationBps: number }>;
}

/**
 * Check temporal continuity and snapshot freshness before research or strategy use.
 * Zero-volume rows are warnings: they can be legitimate, so they are not silently discarded.
 */
export function validateSnapshotQuality(
  snapshot: MarketSnapshot,
  options: SnapshotQualityOptions,
): SnapshotQualityReport {
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new RangeError("now must be a non-negative safe integer timestamp");
  }
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new RangeError("intervalMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
    throw new RangeError("maxAgeMs must be a non-negative safe integer");
  }

  const issues: QualityIssue[] = [];
  let validated: Candle[] = [];
  try {
    validated = validateCandles(snapshot.candles);
    if (validated.length === 0) {
      issues.push({ code: "NO_CANDLES", severity: "error", message: "Snapshot contains no candles" });
    }
  } catch (error) {
    issues.push({
      code: "INVALID_CANDLES",
      severity: "error",
      message: error instanceof Error ? error.message : "Candle validation failed",
    });
  }

  if (!Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0) {
    issues.push({ code: "INVALID_FETCH_TIME", severity: "error", message: "Snapshot fetch timestamp is invalid" });
  } else if (snapshot.fetchedAt > options.now) {
    issues.push({ code: "FUTURE_SNAPSHOT", severity: "error", message: "Snapshot fetch timestamp is in the future" });
  } else if (options.now - snapshot.fetchedAt > options.maxAgeMs || snapshot.stale) {
    issues.push({ code: "STALE_SNAPSHOT", severity: "error", message: "Snapshot is stale or older than the permitted age" });
  }

  for (const candle of validated) {
    if (candle.timestamp % options.intervalMs !== 0) {
      issues.push({
        code: "MISALIGNED_CANDLE",
        severity: "error",
        message: "Candle timestamp is not aligned to the requested UTC interval",
        candleTimestamp: candle.timestamp,
      });
    }
  }

  for (let index = 1; index < validated.length; index += 1) {
    const previous = validated[index - 1];
    const current = validated[index];
    if (current.timestamp - previous.timestamp !== options.intervalMs) {
      issues.push({
        code: "CANDLE_GAP",
        severity: "error",
        message: "Expected " + options.intervalMs + "ms between candles but observed " +
          (current.timestamp - previous.timestamp) + "ms",
        candleTimestamp: current.timestamp,
      });
    }
  }

  if (validated.length > 0) {
    const last = validated[validated.length - 1];
    const lastCloseTime = last.timestamp + options.intervalMs;
    if (!Number.isSafeInteger(lastCloseTime)) {
      issues.push({ code: "INVALID_CANDLES", severity: "error", message: "Latest candle close timestamp exceeds safe integer range" });
    } else if (lastCloseTime > options.now) {
      issues.push({
        code: "INCOMPLETE_LAST_CANDLE",
        severity: "error",
        message: "Latest candle interval has not closed yet",
        candleTimestamp: last.timestamp,
      });
    } else if (options.now - lastCloseTime > options.intervalMs + options.maxAgeMs) {
      issues.push({
        code: "LAST_CANDLE_STALE",
        severity: "error",
        message: "Latest completed candle is older than the permitted age",
        candleTimestamp: last.timestamp,
      });
    }
  }

  for (const candle of validated) {
    if (candle.volume === 0) {
      issues.push({
        code: "ZERO_VOLUME",
        severity: "warning",
        message: "Candle has zero reported volume; verify venue and instrument conventions",
        candleTimestamp: candle.timestamp,
      });
    }
  }

  const status: QualityStatus = issues.some((issue) => issue.severity === "error")
    ? "fail"
    : issues.length > 0 ? "warning" : "pass";

  return {
    status,
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    provider: snapshot.provider,
    candleCount: Array.isArray(snapshot.candles) ? snapshot.candles.length : 0,
    issues,
  };
}

/**
 * Compare close prices only on identical candle timestamps.
 * The feeds remain independent; this function never merges or averages market data.
 */
export function compareMarketSnapshots(
  primary: MarketSnapshot,
  secondary: MarketSnapshot,
  maxDeviationBps: number,
): SnapshotComparison {
  if (!Number.isFinite(maxDeviationBps) || maxDeviationBps < 0) {
    throw new RangeError("maxDeviationBps must be a non-negative finite number");
  }
  if (primary.symbol !== secondary.symbol || primary.interval !== secondary.interval) {
    throw new TypeError("Snapshots must have the same symbol and interval");
  }

  const primaryCandles = validateCandles(primary.candles);
  const secondaryCandles = validateCandles(secondary.candles);
  const secondaryByTimestamp = new Map(secondaryCandles.map((candle) => [candle.timestamp, candle]));
  const deviations: SnapshotComparison["deviations"] = [];

  for (const candle of primaryCandles) {
    const other = secondaryByTimestamp.get(candle.timestamp);
    if (!other) continue;
    if (candle.close <= 0 || other.close <= 0) {
      throw new RangeError("Close prices must be positive for basis-point comparison");
    }
    const midpoint = (candle.close + other.close) / 2;
    deviations.push({
      timestamp: candle.timestamp,
      deviationBps: Math.abs(candle.close - other.close) / midpoint * 10_000,
    });
  }

  const maximum = deviations.reduce((value, item) => Math.max(value, item.deviationBps), 0);
  const latestTimestampMatched = primaryCandles.length > 0 && secondaryCandles.length > 0 &&
    primaryCandles[primaryCandles.length - 1].timestamp === secondaryCandles[secondaryCandles.length - 1].timestamp;
  const status = deviations.length === 0 || !latestTimestampMatched
    ? "insufficient_overlap"
    : maximum > maxDeviationBps ? "discrepancy" : "within_tolerance";

  return {
    status,
    symbol: primary.symbol,
    interval: primary.interval,
    primaryProvider: primary.provider,
    secondaryProvider: secondary.provider,
    comparedCandles: deviations.length,
    latestTimestampMatched,
    maxDeviationBps: deviations.length === 0 ? null : maximum,
    deviations,
  };
}
