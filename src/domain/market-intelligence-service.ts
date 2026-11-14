import { validateCandles, type Candle } from "./candles";
import {
  compareMarketSnapshots,
  validateSnapshotQuality,
  type SnapshotComparison,
  type SnapshotQualityReport,
} from "./market-data-quality";
import {
  resolveMarketSnapshot,
  type MarketDataProvider,
  type MarketSnapshot,
  type MarketSnapshotCache,
} from "./market-data";
import {
  buildMarketIntelligenceSnapshot,
  type MarketFrameInput,
  type MarketFrameQuality,
  type MarketIntelligenceInput,
  type MarketIntelligenceSnapshot,
  type MarketTimeframe,
} from "./market-intelligence";
import type { MarketRegimeConfig } from "./market-regimes";

const TIMEFRAME_CONFIG: Record<MarketTimeframe, { interval: string; intervalMs: number }> = {
  "1d": { interval: "1d", intervalMs: 86_400_000 },
  "4h": { interval: "4h", intervalMs: 14_400_000 },
  "1h": { interval: "1h", intervalMs: 3_600_000 },
  "15m": { interval: "15m", intervalMs: 900_000 },
};
const TIMEFRAMES: readonly MarketTimeframe[] = ["1d", "4h", "1h", "15m"];
const DEFAULT_HISTORY_LIMIT = 60;
const DEFAULT_MIN_CANDLES = 25;
const DEFAULT_CROSS_FEED_TOLERANCE_BPS = 50;

export type CrossFeedStatus =
  | "within_tolerance"
  | "discrepancy"
  | "insufficient_overlap"
  | "unavailable";

export interface MarketIntelligenceServiceInput {
  symbol: string;
  instrumentCategory: MarketIntelligenceInput["instrumentCategory"];
  volumeUnit: MarketIntelligenceInput["volumeUnit"];
  evaluationTime: number;
  config: MarketRegimeConfig;
  providers: readonly MarketDataProvider[];
  cache: MarketSnapshotCache;
  historyLimit?: number;
  minimumCandles?: number;
  crossFeedToleranceBps?: number;
}

export interface MarketIntelligenceServiceResult {
  snapshot: MarketIntelligenceSnapshot;
  snapshots: Partial<Record<MarketTimeframe, MarketSnapshot>>;
  frameQuality: Partial<Record<MarketTimeframe, MarketFrameQuality>>;
  qualityReports: Partial<Record<MarketTimeframe, SnapshotQualityReport>>;
  frameFailures: Partial<Record<MarketTimeframe, string>>;
  crossFeedStatus: CrossFeedStatus;
  crossFeedComparison: SnapshotComparison | null;
  marketDataTrusted: boolean;
}

function validTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function closedCandles(
  candles: readonly Candle[],
  intervalMs: number,
  evaluationTime: number,
): Candle[] {
  if (!Array.isArray(candles)) throw new TypeError("Provider candles must be an array");
  if (candles.some((candle) => !candle || !validTime(candle.timestamp))) {
    throw new TypeError("Provider returned a candle with an invalid timestamp");
  }
  return validateCandles(candles.filter((candle) =>
    candle.timestamp <= Number.MAX_SAFE_INTEGER - intervalMs &&
    candle.timestamp + intervalMs <= evaluationTime
  ));
}

function assessFrameQuality(
  snapshot: MarketSnapshot,
  intervalMs: number,
  evaluationTime: number,
): { report: SnapshotQualityReport; status: MarketFrameQuality } {
  const closed = closedCandles(snapshot.candles, intervalMs, evaluationTime);
  const closedSnapshot: MarketSnapshot = { ...snapshot, candles: closed };
  const report = validateSnapshotQuality(closedSnapshot, {
    now: evaluationTime,
    intervalMs,
    maxAgeMs: intervalMs,
  });
  if (snapshot.stale || report.status === "fail") return { report, status: "fail" };

  // Zero-volume bars are explicitly warned about by the quality validator.
  // Price-based trend/volatility remain usable; the volume ratio is only a proxy.
  const blockingIssues = report.issues.filter((issue) => issue.code !== "ZERO_VOLUME");
  return {
    report,
    status: blockingIssues.length ? "degraded" : "pass",
  };
}

function frameInput(
  timeframe: MarketTimeframe,
  snapshot: MarketSnapshot,
  qualityStatus: MarketFrameQuality,
): MarketFrameInput {
  const definition = TIMEFRAME_CONFIG[timeframe];
  return {
    symbol: snapshot.symbol,
    timeframe,
    intervalMs: definition.intervalMs,
    provider: snapshot.provider,
    fetchedAt: snapshot.fetchedAt,
    maxAgeMs: definition.intervalMs * 2,
    qualityStatus,
    candles: snapshot.candles,
  };
}

/**
 * Resolve each timeframe independently, preserve partial success, and require
 * a second provider to confirm the tactical 1H frame before paper eligibility.
 */
export async function loadMarketIntelligence(
  input: MarketIntelligenceServiceInput,
): Promise<MarketIntelligenceServiceResult> {
  if (!input || typeof input !== "object") throw new TypeError("Market intelligence service input is required");
  if (!/^[A-Z0-9]{3,30}$/.test(input.symbol)) throw new TypeError("symbol must be normalized uppercase alphanumeric");
  if (!validTime(input.evaluationTime)) throw new RangeError("evaluationTime must be a non-negative safe integer");
  if (!Array.isArray(input.providers) || input.providers.length === 0) {
    throw new RangeError("At least one public market-data provider is required");
  }
  if (input.providers.some((provider) => !provider || typeof provider.name !== "string" ||
      !provider.name.trim() || typeof provider.fetchCandles !== "function")) {
    throw new TypeError("Every market-data provider must expose a name and fetchCandles");
  }
  if (!input.cache || typeof input.cache.load !== "function" || typeof input.cache.save !== "function") {
    throw new TypeError("A market snapshot cache is required");
  }

  const historyLimit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const minimumCandles = input.minimumCandles ?? DEFAULT_MIN_CANDLES;
  const crossFeedToleranceBps = input.crossFeedToleranceBps ?? DEFAULT_CROSS_FEED_TOLERANCE_BPS;
  if (!Number.isInteger(historyLimit) || historyLimit < 25 || historyLimit > 1_000) {
    throw new RangeError("historyLimit must be between 25 and 1000");
  }
  if (!Number.isInteger(minimumCandles) || minimumCandles < 15 || minimumCandles > historyLimit) {
    throw new RangeError("minimumCandles must be between 15 and historyLimit");
  }
  if (!Number.isFinite(crossFeedToleranceBps) || crossFeedToleranceBps < 0) {
    throw new RangeError("crossFeedToleranceBps must be finite and non-negative");
  }

  const resolved = await Promise.allSettled(TIMEFRAMES.map(async (timeframe) => {
    const definition = TIMEFRAME_CONFIG[timeframe];
    const snapshot = await resolveMarketSnapshot(input.providers, input.cache, {
      symbol: input.symbol,
      interval: definition.interval,
      now: input.evaluationTime,
      limit: historyLimit,
      minCandles: minimumCandles,
      maxCacheAgeMs: definition.intervalMs * 2,
    });
    const quality = assessFrameQuality(snapshot, definition.intervalMs, input.evaluationTime);
    return { timeframe, snapshot, quality };
  }));

  const snapshots: Partial<Record<MarketTimeframe, MarketSnapshot>> = {};
  const frameQuality: Partial<Record<MarketTimeframe, MarketFrameQuality>> = {};
  const qualityReports: Partial<Record<MarketTimeframe, SnapshotQualityReport>> = {};
  const frameFailures: Partial<Record<MarketTimeframe, string>> = {};
  const frames: Partial<Record<MarketTimeframe, MarketFrameInput>> = {};

  resolved.forEach((result, index) => {
    const timeframe = TIMEFRAMES[index];
    if (result.status === "rejected") {
      frameFailures[timeframe] = result.reason instanceof Error
        ? result.reason.message
        : "Market data unavailable";
      return;
    }
    snapshots[timeframe] = result.value.snapshot;
    frameQuality[timeframe] = result.value.quality.status;
    qualityReports[timeframe] = result.value.quality.report;
    frames[timeframe] = frameInput(timeframe, result.value.snapshot, result.value.quality.status);
  });

  let crossFeedStatus: CrossFeedStatus = "unavailable";
  let crossFeedComparison: SnapshotComparison | null = null;
  const primaryHourly = snapshots["1h"];
  if (primaryHourly) {
    const secondaryProvider = input.providers.find((provider) => provider.name !== primaryHourly.provider);
    if (secondaryProvider) {
      try {
        const intervalMs = TIMEFRAME_CONFIG["1h"].intervalMs;
        const rawSecondary = await secondaryProvider.fetchCandles({
          symbol: input.symbol,
          interval: "1h",
          limit: historyLimit,
        });
        const secondaryClosed = closedCandles(rawSecondary, intervalMs, input.evaluationTime);
        const primaryClosed = closedCandles(primaryHourly.candles, intervalMs, input.evaluationTime);
        const secondarySnapshot: MarketSnapshot = {
          symbol: input.symbol,
          interval: "1h",
          provider: secondaryProvider.name,
          fetchedAt: input.evaluationTime,
          stale: false,
          candles: secondaryClosed,
        };
        const primarySnapshot: MarketSnapshot = {
          ...primaryHourly,
          candles: primaryClosed,
        };
        crossFeedComparison = compareMarketSnapshots(
          primarySnapshot,
          secondarySnapshot,
          crossFeedToleranceBps,
        );
        crossFeedStatus = crossFeedComparison.status;
      } catch {
        crossFeedStatus = "unavailable";
      }
    }

    if (frames["1h"]) {
      if (crossFeedStatus === "discrepancy") {
        frames["1h"] = { ...frames["1h"]!, qualityStatus: "fail" };
        frameQuality["1h"] = "fail";
      } else if (crossFeedStatus !== "within_tolerance" && frameQuality["1h"] === "pass") {
        frames["1h"] = { ...frames["1h"]!, qualityStatus: "degraded" };
        frameQuality["1h"] = "degraded";
      }
    }
  }

  const snapshot = await buildMarketIntelligenceSnapshot({
    symbol: input.symbol,
    instrumentCategory: input.instrumentCategory,
    volumeUnit: input.volumeUnit,
    evaluationTime: input.evaluationTime,
    config: input.config,
    frames,
  });

  return {
    snapshot,
    snapshots,
    frameQuality,
    qualityReports,
    frameFailures,
    crossFeedStatus,
    crossFeedComparison,
    marketDataTrusted: Boolean(
      snapshots["1h"] &&
      frameQuality["1h"] === "pass" &&
      crossFeedStatus === "within_tolerance" &&
      !snapshots["1h"]!.stale
    ),
  };
}
