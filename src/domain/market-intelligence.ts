import { validateCandles, type Candle } from "./candles";
import {
  classifyMarketRegimes,
  type MarketRegimeConfig,
  type TrendRegime,
  type VolatilityRegime,
} from "./market-regimes";

export const MARKET_INTELLIGENCE_VERSION = "market-intelligence-v1" as const;

export type MarketTimeframe = "1d" | "4h" | "1h" | "15m";
export type MarketFrameQuality = "pass" | "degraded" | "fail";
export type MarketFrameStatus =
  | "available"
  | "missing"
  | "degraded"
  | "stale"
  | "failed"
  | "future"
  | "insufficient_history";

export interface MarketFrameInput {
  symbol: string;
  timeframe: MarketTimeframe;
  intervalMs: number;
  provider: string;
  fetchedAt: number;
  maxAgeMs: number;
  qualityStatus: MarketFrameQuality;
  candles: readonly Candle[];
}

export interface MarketIntelligenceInput {
  symbol: string;
  instrumentCategory: "spot" | "linear_perpetual" | "inverse_perpetual";
  volumeUnit: "base" | "quote";
  evaluationTime: number;
  config: MarketRegimeConfig;
  frames: Partial<Record<MarketTimeframe, MarketFrameInput>>;
}

export interface MarketTimeframeSnapshot {
  timeframe: MarketTimeframe;
  status: MarketFrameStatus;
  provider: string | null;
  fetchedAt: number | null;
  candleCount: number;
  latestCandleAt: number | null;
  availableAt: number | null;
  trend: TrendRegime;
  volatility: VolatilityRegime;
  emaSpreadPct: number | null;
  trendStrengthPct: number | null;
  trendPersistencePct: number | null;
  atrPct: number | null;
  volatilityRankPct: number | null;
  relativeVolume20: number | null;
  reason: string | null;
}

export type MarketPhase =
  | "trend"
  | "range"
  | "compression"
  | "stress"
  | "transition"
  | "unknown";

export type TimeframeAlignment = "aligned" | "conflict" | "partial" | "unknown";

export interface MarketIntelligenceSnapshot {
  schemaVersion: 1;
  engineVersion: typeof MARKET_INTELLIGENCE_VERSION;
  snapshotId: string;
  contentHash: string;
  symbol: string;
  instrumentCategory: "spot" | "linear_perpetual" | "inverse_perpetual";
  volumeUnit: "base" | "quote";
  evaluationTime: number;
  config: MarketRegimeConfig;
  latestSourceAvailableAt: number | null;
  dataQuality: MarketFrameQuality;
  coverage: {
    expectedTimeframes: number;
    availableTimeframes: number;
    missingTimeframes: MarketTimeframe[];
  };
  frames: Record<MarketTimeframe, MarketTimeframeSnapshot>;
  macroTrend: TrendRegime;
  primaryTrend: TrendRegime;
  tacticalTrend: TrendRegime;
  microTrend: TrendRegime;
  alignment: TimeframeAlignment;
  lowerTimeframeDivergence: boolean;
  volatilityContext: VolatilityRegime;
  phase: MarketPhase;
  phaseRationale: string;
  uncertainty: "low" | "moderate" | "high" | "unknown";
  liquidity: {
    status: "partial" | "unknown";
    relativeVolume20: number | null;
    depthStatus: "unknown";
    breadthStatus: "unknown";
    note: string;
  };
  positioning: {
    status: "unknown";
    note: string;
  };
  missingDimensions: string[];
  supportingObservations: string[];
  contradictions: string[];
}

export type MarketIntelligenceHasher = (value: unknown) => Promise<string>;

const TIMEFRAMES: readonly MarketTimeframe[] = ["1d", "4h", "1h", "15m"];
const MAX_FRAME_CANDLES = 5_000;
const INTERVAL_MS: Record<MarketTimeframe, number> = {
  "1d": 86_400_000,
  "4h": 14_400_000,
  "1h": 3_600_000,
  "15m": 900_000,
};
const UNKNOWN_FRAME: Omit<MarketTimeframeSnapshot, "timeframe"> = {
  status: "missing",
  provider: null,
  fetchedAt: null,
  candleCount: 0,
  latestCandleAt: null,
  availableAt: null,
  trend: "unknown",
  volatility: "unknown",
  emaSpreadPct: null,
  trendStrengthPct: null,
  trendPersistencePct: null,
  atrPct: null,
  volatilityRankPct: null,
  relativeVolume20: null,
  reason: "No frame supplied for this timeframe",
};

function validTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function sha256(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateConfig(config: MarketRegimeConfig): void {
  if (!config || typeof config !== "object") throw new TypeError("Market regime config is required");
  for (const [name, value] of Object.entries({
    fastEmaPeriod: config.fastEmaPeriod,
    slowEmaPeriod: config.slowEmaPeriod,
    atrPeriod: config.atrPeriod,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + " must be a positive integer");
  }
  if (config.fastEmaPeriod >= config.slowEmaPeriod) {
    throw new RangeError("fastEmaPeriod must be less than slowEmaPeriod");
  }
  for (const [name, value] of Object.entries({
    trendThresholdPct: config.trendThresholdPct,
    lowVolatilityAtrPct: config.lowVolatilityAtrPct,
    highVolatilityAtrPct: config.highVolatilityAtrPct,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + " must be finite and non-negative");
  }
  if (config.lowVolatilityAtrPct >= config.highVolatilityAtrPct) {
    throw new RangeError("lowVolatilityAtrPct must be less than highVolatilityAtrPct");
  }
}

function unavailableFrame(
  timeframe: MarketTimeframe,
  status: MarketFrameStatus,
  reason: string,
  frame?: MarketFrameInput,
  candleCount = 0,
  latestCandleAt: number | null = null,
  availableAt: number | null = null,
): MarketTimeframeSnapshot {
  return {
    timeframe,
    status,
    provider: frame?.provider ?? null,
    fetchedAt: frame?.fetchedAt ?? null,
    candleCount,
    latestCandleAt,
    availableAt,
    trend: "unknown",
    volatility: "unknown",
    emaSpreadPct: null,
    trendStrengthPct: null,
    trendPersistencePct: null,
    atrPct: null,
    volatilityRankPct: null,
    relativeVolume20: null,
    reason,
  };
}

function buildFrame(
  timeframe: MarketTimeframe,
  frame: MarketFrameInput | undefined,
  input: MarketIntelligenceInput,
): { snapshot: MarketTimeframeSnapshot; hashSource: unknown } {
  if (!frame) {
    return {
      snapshot: { timeframe, ...UNKNOWN_FRAME },
      hashSource: { timeframe, status: "missing" },
    };
  }
  if (frame.timeframe !== timeframe) throw new TypeError("Frame timeframe key does not match its declared timeframe");
  if (frame.symbol !== input.symbol) throw new TypeError("All market frames must use the requested symbol");
  if (frame.intervalMs !== INTERVAL_MS[timeframe]) {
    throw new RangeError("Interval for " + timeframe + " must be " + INTERVAL_MS[timeframe] + "ms");
  }
  if (!validTime(frame.fetchedAt) || !validTime(frame.maxAgeMs) ||
      typeof frame.provider !== "string" || !frame.provider.trim()) {
    throw new TypeError("Market frame provider, fetch timestamp and maximum age are required");
  }
  if (!["pass", "degraded", "fail"].includes(frame.qualityStatus)) {
    throw new TypeError("Market frame quality status is invalid");
  }
  if (!Array.isArray(frame.candles)) {
    return {
      snapshot: unavailableFrame(timeframe, "failed", "Candle collection is not an array", frame),
      hashSource: { timeframe, status: "failed", provider: frame.provider, fetchedAt: frame.fetchedAt },
    };
  }

  if (frame.candles.length > MAX_FRAME_CANDLES) {
    throw new RangeError("Each timeframe is limited to " + MAX_FRAME_CANDLES + " candles");
  }

  // Candle timestamps are bar-open times. Only a fully closed bar is eligible.
  // Filter first so malformed future bars cannot contaminate historical prefixes.
  const eligibleCandles = frame.candles.filter((candle) =>
    candle && validTime(candle.timestamp) &&
    candle.timestamp <= Number.MAX_SAFE_INTEGER - frame.intervalMs &&
    candle.timestamp + frame.intervalMs <= input.evaluationTime
  );
  const hashSource = {
    timeframe,
    provider: frame.provider,
    fetchedAt: frame.fetchedAt,
    intervalMs: frame.intervalMs,
    maxAgeMs: frame.maxAgeMs,
    qualityStatus: frame.qualityStatus,
    candles: eligibleCandles.map((candle) => ({
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
  };

  if (frame.fetchedAt > input.evaluationTime) {
    return {
      snapshot: unavailableFrame(timeframe, "future", "Frame fetch timestamp is after evaluation time", frame),
      hashSource,
    };
  }
  if (input.evaluationTime - frame.fetchedAt > frame.maxAgeMs) {
    return {
      snapshot: unavailableFrame(timeframe, "stale", "Frame fetch timestamp exceeds its freshness limit", frame),
      hashSource,
    };
  }
  if (frame.qualityStatus === "fail") {
    return {
      snapshot: unavailableFrame(timeframe, "failed", "Upstream quality audit failed", frame),
      hashSource,
    };
  }
  if (frame.qualityStatus === "degraded") {
    return {
      snapshot: unavailableFrame(timeframe, "degraded", "Upstream quality audit is degraded", frame),
      hashSource,
    };
  }

  let candles: Candle[];
  try {
    candles = validateCandles(eligibleCandles);
  } catch (error) {
    return {
      snapshot: unavailableFrame(
        timeframe,
        "failed",
        error instanceof Error ? error.message : "Eligible candle validation failed",
        frame,
      ),
      hashSource,
    };
  }
  if (!candles.length) {
    return {
      snapshot: unavailableFrame(timeframe, "insufficient_history", "No fully closed candles are available", frame),
      hashSource,
    };
  }

  const latest = candles[candles.length - 1];
  const availableAt = latest.timestamp + frame.intervalMs;
  if (input.evaluationTime - availableAt > frame.maxAgeMs) {
    return {
      snapshot: unavailableFrame(
        timeframe,
        "stale",
        "Latest closed candle exceeds its freshness limit",
        frame,
        candles.length,
        latest.timestamp,
        availableAt,
      ),
      hashSource,
    };
  }

  const minimumHistory = Math.max(input.config.slowEmaPeriod, input.config.atrPeriod) + 1;
  if (candles.length < minimumHistory) {
    return {
      snapshot: unavailableFrame(
        timeframe,
        "insufficient_history",
        "Need at least " + minimumHistory + " closed candles",
        frame,
        candles.length,
        latest.timestamp,
        availableAt,
      ),
      hashSource,
    };
  }

  const regimes = classifyMarketRegimes(candles, input.config);
  const latestRegime = regimes[regimes.length - 1];
  if (latestRegime.trend === "unknown" || latestRegime.volatility === "unknown") {
    return {
      snapshot: unavailableFrame(
        timeframe,
        "insufficient_history",
        "Trend or volatility warm-up is incomplete",
        frame,
        candles.length,
        latest.timestamp,
        availableAt,
      ),
      hashSource,
    };
  }

  const knownRecent = regimes.slice(-10).filter((item) => item.trend !== "unknown");
  const trendPersistencePct = knownRecent.length
    ? knownRecent.filter((item) => item.trend === latestRegime.trend).length / knownRecent.length * 100
    : null;
  const atrHistory = regimes.slice(-100)
    .map((item) => item.atrPct)
    .filter((value): value is number => value !== null);
  const volatilityRankPct = latestRegime.atrPct === null || !atrHistory.length
    ? null
    : atrHistory.filter((value) => value <= latestRegime.atrPct!).length / atrHistory.length * 100;
  const priorVolumes = candles.slice(-21, -1).map((candle) => candle.volume);
  const medianPriorVolume = median(priorVolumes);
  const relativeVolume20 = medianPriorVolume !== null && medianPriorVolume > 0
    ? latest.volume / medianPriorVolume
    : null;

  return {
    snapshot: {
      timeframe,
      status: "available",
      provider: frame.provider,
      fetchedAt: frame.fetchedAt,
      candleCount: candles.length,
      latestCandleAt: latest.timestamp,
      availableAt,
      trend: latestRegime.trend,
      volatility: latestRegime.volatility,
      emaSpreadPct: latestRegime.emaSpreadPct,
      trendStrengthPct: latestRegime.emaSpreadPct === null
        ? null
        : Math.abs(latestRegime.emaSpreadPct),
      trendPersistencePct,
      atrPct: latestRegime.atrPct,
      volatilityRankPct,
      relativeVolume20,
      reason: null,
    },
    hashSource,
  };
}

function opposite(left: TrendRegime, right: TrendRegime): boolean {
  return (left === "uptrend" && right === "downtrend") ||
    (left === "downtrend" && right === "uptrend");
}

function alignmentFor(macro: TrendRegime, primary: TrendRegime): TimeframeAlignment {
  if (macro === "unknown" && primary === "unknown") return "unknown";
  if (macro === "unknown" || primary === "unknown") return "partial";
  if (macro === primary) return "aligned";
  if (opposite(macro, primary)) return "conflict";
  return "partial";
}

function volatilityFor(
  macro: VolatilityRegime,
  primary: VolatilityRegime,
): VolatilityRegime {
  if (macro === "unknown" || primary === "unknown") return "unknown";
  if (macro === "high" || primary === "high") return "high";
  if (macro === "low" && primary === "low") return "low";
  return "normal";
}

function determinePhase(
  macro: TrendRegime,
  primary: TrendRegime,
  macroVolatility: VolatilityRegime,
  primaryVolatility: VolatilityRegime,
  alignment: TimeframeAlignment,
  lowerTimeframeDivergence: boolean,
): { phase: MarketPhase; rationale: string } {
  if (macro === "unknown" || primary === "unknown") {
    return { phase: "unknown", rationale: "Daily macro and 4H primary context are both required" };
  }
  if (macroVolatility === "high" || primaryVolatility === "high") {
    return { phase: "stress", rationale: "At least one higher timeframe is in a high realised-volatility state" };
  }
  if (alignment === "conflict") {
    return { phase: "transition", rationale: "Daily and 4H directional regimes conflict" };
  }
  if (alignment === "partial" || lowerTimeframeDivergence) {
    return { phase: "transition", rationale: "Timeframe context is mixed; lower-timeframe divergence is retained, not averaged away" };
  }
  if (macro === "range" && primary === "range") {
    return { phase: "range", rationale: "Daily and 4H baselines both classify price as range-bound" };
  }
  if (macroVolatility === "low" && primaryVolatility === "low") {
    return { phase: "compression", rationale: "Daily and 4H realised volatility are both below their fixed low-volatility thresholds" };
  }
  if ((macro === "uptrend" || macro === "downtrend") && macro === primary) {
    return { phase: "trend", rationale: "Daily and 4H trend direction agree under the deterministic EMA baseline" };
  }
  return { phase: "unknown", rationale: "The available dimensions do not support a stable phase label" };
}

/**
 * Build a causal, deterministic, multi-timeframe market context snapshot.
 * The baseline is descriptive, not predictive. It emits no probability.
 */
export async function buildMarketIntelligenceSnapshot(
  input: MarketIntelligenceInput,
  hasher: MarketIntelligenceHasher = sha256,
): Promise<MarketIntelligenceSnapshot> {
  if (!input || typeof input !== "object") throw new TypeError("Market intelligence input is required");
  if (typeof input.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(input.symbol)) {
    throw new TypeError("symbol must be normalized uppercase alphanumeric");
  }
  if (!["spot", "linear_perpetual", "inverse_perpetual"].includes(input.instrumentCategory)) {
    throw new TypeError("Instrument category is invalid");
  }
  if (!["base", "quote"].includes(input.volumeUnit)) {
    throw new TypeError("Candle volume unit must be base or quote");
  }
  if (!validTime(input.evaluationTime)) throw new RangeError("evaluationTime must be a non-negative safe integer");
  validateConfig(input.config);
  if (!input.frames || typeof input.frames !== "object") throw new TypeError("Market frames are required");

  const frameResults = TIMEFRAMES.map((timeframe) =>
    buildFrame(timeframe, input.frames[timeframe], input)
  );
  const frames = Object.fromEntries(frameResults.map((result, index) => [
    TIMEFRAMES[index],
    result.snapshot,
  ])) as Record<MarketTimeframe, MarketTimeframeSnapshot>;

  const macroTrend = frames["1d"].trend;
  const primaryTrend = frames["4h"].trend;
  const tacticalTrend = frames["1h"].trend;
  const microTrend = frames["15m"].trend;
  const alignment = alignmentFor(macroTrend, primaryTrend);
  const lowerTimeframeDivergence =
    (macroTrend === "uptrend" || macroTrend === "downtrend") &&
    alignment === "aligned" &&
    [tacticalTrend, microTrend].some((trend) => opposite(trend, macroTrend));
  const volatilityContext = volatilityFor(frames["1d"].volatility, frames["4h"].volatility);
  const phaseResult = determinePhase(
    macroTrend,
    primaryTrend,
    frames["1d"].volatility,
    frames["4h"].volatility,
    alignment,
    lowerTimeframeDivergence,
  );

  const availableTimeframes = TIMEFRAMES.filter((timeframe) => frames[timeframe].status === "available");
  const missingTimeframes = TIMEFRAMES.filter((timeframe) => frames[timeframe].status !== "available");
  const dataQuality: MarketFrameQuality = availableTimeframes.length === 0
    ? "fail"
    : availableTimeframes.length === TIMEFRAMES.length
      ? "pass"
      : "degraded";
  const uncertainty: MarketIntelligenceSnapshot["uncertainty"] = phaseResult.phase === "unknown"
    ? "unknown"
    : dataQuality !== "pass" || phaseResult.phase === "transition"
      ? "high"
      : "moderate";

  const supportingObservations: string[] = [];
  const contradictions: string[] = [];
  if (alignment === "aligned") {
    supportingObservations.push("Daily and 4H baseline regimes agree: " + macroTrend);
  }
  if (volatilityContext === "high") {
    supportingObservations.push("Higher-timeframe realised volatility is elevated");
  }
  if (volatilityContext === "low") {
    supportingObservations.push("Daily and 4H realised volatility are both low");
  }
  if (alignment === "conflict") {
    contradictions.push("Daily macro trend (" + macroTrend + ") conflicts with 4H primary trend (" + primaryTrend + ")");
  }
  if (lowerTimeframeDivergence) {
    contradictions.push("1H/15M shows countertrend development against aligned 1D/4H context");
  }
  if (missingTimeframes.length) {
    contradictions.push("Missing or unusable timeframe coverage: " + missingTimeframes.join(", "));
  }

  const relativeVolume20 = frames["1h"].relativeVolume20;
  const liquidityStatus = relativeVolume20 === null ? "unknown" : "partial";
  const missingDimensions = [
    "order_book_depth",
    "market_breadth",
    "derivatives_positioning",
  ];
  if (relativeVolume20 === null) missingDimensions.push("relative_volume_proxy");

  const canonical = {
    schemaVersion: 1,
    engineVersion: MARKET_INTELLIGENCE_VERSION,
    symbol: input.symbol,
    instrumentCategory: input.instrumentCategory,
    volumeUnit: input.volumeUnit,
    evaluationTime: input.evaluationTime,
    config: {
      fastEmaPeriod: input.config.fastEmaPeriod,
      slowEmaPeriod: input.config.slowEmaPeriod,
      atrPeriod: input.config.atrPeriod,
      trendThresholdPct: input.config.trendThresholdPct,
      lowVolatilityAtrPct: input.config.lowVolatilityAtrPct,
      highVolatilityAtrPct: input.config.highVolatilityAtrPct,
    },
    frames: frameResults.map((result) => result.hashSource),
    derived: {
      macroTrend,
      primaryTrend,
      tacticalTrend,
      microTrend,
      alignment,
      lowerTimeframeDivergence,
      volatilityContext,
      phase: phaseResult.phase,
      dataQuality,
    },
  };
  const contentHash = await hasher(canonical);
  if (typeof contentHash !== "string" || !/^[a-f0-9]{8,128}$/i.test(contentHash)) {
    throw new TypeError("Snapshot hasher must return a hexadecimal content hash");
  }
  const latestSourceAvailableAt = TIMEFRAMES
    .map((timeframe) => frames[timeframe].availableAt)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((latest, value) => latest === null ? value : Math.max(latest, value), null);

  return {
    schemaVersion: 1,
    engineVersion: MARKET_INTELLIGENCE_VERSION,
    snapshotId: "market-intel-v1:" + contentHash,
    contentHash,
    symbol: input.symbol,
    instrumentCategory: input.instrumentCategory,
    volumeUnit: input.volumeUnit,
    evaluationTime: input.evaluationTime,
    config: {
      fastEmaPeriod: input.config.fastEmaPeriod,
      slowEmaPeriod: input.config.slowEmaPeriod,
      atrPeriod: input.config.atrPeriod,
      trendThresholdPct: input.config.trendThresholdPct,
      lowVolatilityAtrPct: input.config.lowVolatilityAtrPct,
      highVolatilityAtrPct: input.config.highVolatilityAtrPct,
    },
    latestSourceAvailableAt,
    dataQuality,
    coverage: {
      expectedTimeframes: TIMEFRAMES.length,
      availableTimeframes: availableTimeframes.length,
      missingTimeframes,
    },
    frames,
    macroTrend,
    primaryTrend,
    tacticalTrend,
    microTrend,
    alignment,
    lowerTimeframeDivergence,
    volatilityContext,
    phase: phaseResult.phase,
    phaseRationale: phaseResult.rationale,
    uncertainty,
    liquidity: {
      status: liquidityStatus,
      relativeVolume20,
      depthStatus: "unknown",
      breadthStatus: "unknown",
      note: "Relative 1H volume is an OHLCV participation proxy only; order-book depth and market breadth are not connected.",
    },
    positioning: {
      status: "unknown",
      note: "Funding, open interest and long/short positioning are not yet joined to this canonical snapshot.",
    },
    missingDimensions,
    supportingObservations,
    contradictions,
  };
}
