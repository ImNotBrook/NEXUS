import type { EvidenceItem, DecisionCandidate } from "./decision-engine";
import type { MarketIntelligenceSnapshot, MarketTimeframe } from "./market-intelligence";
import type { CrossFeedStatus } from "./market-intelligence-service";

export interface MarketDecisionEvidence {
  evidence: EvidenceItem[];
  marketDataStatus: "pass" | "degraded" | "fail";
  snapshotRef: { snapshotId: string; contentHash: string };
}

const FRAME_FAMILY: Record<MarketTimeframe, EvidenceItem["family"]> = {
  "1d": "macro_regime",
  "4h": "market_structure",
  "1h": "momentum_volume",
  "15m": "timeframe_alignment",
};

/**
 * Converts only timestamped, available market observations into evidence.
 * Directional polarity is relative to the supplied candidate; this adapter
 * does not create candidates, infer positioning, or estimate win probability.
 */
export function buildDecisionEvidenceFromMarketSnapshot(
  snapshot: MarketIntelligenceSnapshot,
  candidate: Pick<DecisionCandidate, "symbol" | "side">,
  crossFeedStatus: CrossFeedStatus,
): MarketDecisionEvidence {
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("A market intelligence snapshot is required");
  if (!candidate || candidate.symbol !== snapshot.symbol) {
    throw new TypeError("Candidate symbol must match the market snapshot symbol");
  }
  if (candidate.side !== "long" && candidate.side !== "short") {
    throw new TypeError("Candidate side must be long or short");
  }
  if (!Number.isSafeInteger(snapshot.evaluationTime) || snapshot.evaluationTime < 0) {
    throw new RangeError("Market snapshot evaluation time is invalid");
  }
  if (!snapshot.snapshotId.trim() || !snapshot.contentHash.trim()) {
    throw new TypeError("Market snapshot identity and content hash are required");
  }

  const tactical = snapshot.frames["1h"];
  const marketDataStatus: MarketDecisionEvidence["marketDataStatus"] =
    snapshot.dataQuality === "fail" || crossFeedStatus === "discrepancy" ||
    tactical.status !== "available"
      ? "fail"
      : snapshot.dataQuality === "degraded" || crossFeedStatus !== "within_tolerance"
        ? "degraded"
        : "pass";

  const evidence: EvidenceItem[] = [];
  const timeframes: MarketTimeframe[] = ["1d", "4h", "1h", "15m"];
  for (const timeframe of timeframes) {
    const frame = snapshot.frames[timeframe];
    if (frame.status !== "available" || frame.trend === "unknown") continue;
    if (frame.availableAt === null || !Number.isSafeInteger(frame.availableAt) || frame.availableAt < 0) {
      throw new TypeError("Available " + timeframe + " frame has no valid evidence timestamp");
    }
    if (frame.availableAt > snapshot.evaluationTime) {
      throw new RangeError("Future market evidence is not eligible for a decision");
    }

    const directionMatches = (candidate.side === "long" && frame.trend === "uptrend") ||
      (candidate.side === "short" && frame.trend === "downtrend");
    const strength = frame.trendStrengthPct === null
      ? 0
      : Math.min(1, Math.abs(frame.trendStrengthPct));
    evidence.push({
      id: snapshot.snapshotId + ":" + timeframe + ":trend",
      family: FRAME_FAMILY[timeframe],
      claim: timeframe.toUpperCase() + " closed-candle trend is " + frame.trend,
      polarity: directionMatches ? "supports" : "contradicts",
      strength,
      quality: snapshot.dataQuality === "pass" && crossFeedStatus === "within_tolerance" ? 1 : 0.5,
      symbol: snapshot.symbol,
      timeframe,
      availableAt: frame.availableAt,
      observedAt: frame.availableAt,
      sourceRef: "market-intelligence:" + snapshot.snapshotId + ":" + timeframe,
      calculationVersion: snapshot.engineVersion,
    });
  }

  if (snapshot.alignment !== "unknown") {
    const sourceFrames = [snapshot.frames["1d"], snapshot.frames["4h"]]
      .filter((frame) => frame.status === "available" && frame.availableAt !== null);
    const availableAt = sourceFrames.length
      ? Math.max(...sourceFrames.map((frame) => frame.availableAt as number))
      : null;
    if (availableAt !== null) {
      if (availableAt > snapshot.evaluationTime) {
        throw new RangeError("Future timeframe-alignment evidence is not eligible for a decision");
      }
      evidence.push({
        id: snapshot.snapshotId + ":alignment",
        family: "timeframe_alignment",
        claim: "Higher-timeframe alignment is " + snapshot.alignment,
        polarity: snapshot.alignment === "conflict"
          ? "contradicts"
          : snapshot.alignment === "partial"
            ? "neutral"
            : ((candidate.side === "long" && snapshot.primaryTrend === "uptrend") ||
                (candidate.side === "short" && snapshot.primaryTrend === "downtrend"))
              ? "supports"
              : "contradicts",
        strength: snapshot.alignment === "aligned" || snapshot.alignment === "conflict" ? 1 : 0.25,
        quality: snapshot.dataQuality === "pass" && crossFeedStatus === "within_tolerance" ? 1 : 0.5,
        symbol: snapshot.symbol,
        timeframe: "4h",
        availableAt,
        observedAt: availableAt,
        sourceRef: "market-intelligence:" + snapshot.snapshotId + ":alignment",
        calculationVersion: snapshot.engineVersion,
      });
    }
  }

  return {
    evidence,
    marketDataStatus,
    snapshotRef: { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash },
  };
}
