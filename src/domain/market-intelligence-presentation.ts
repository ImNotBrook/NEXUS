import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { CrossFeedStatus } from "./market-intelligence-service";

export interface MarketIntelligencePresentationInput {
  snapshot: MarketIntelligenceSnapshot;
  crossFeedStatus: CrossFeedStatus;
  marketDataTrusted: boolean;
}

export interface MarketIntelligencePresentation {
  phase: string;
  phaseRationale: string;
  macroTrend: string;
  primaryTrend: string;
  tacticalTrend: string;
  microTrend: string;
  volatility: string;
  alignment: string;
  uncertainty: string;
  lowerTimeframeDivergence: string;
  coverage: string;
  quality: string;
  crossFeed: string;
  liquidity: string;
  positioning: string;
  missingDimensions: string;
  paperEligibility: string;
}

function label(value: string): string {
  return value.replaceAll("_", " ").toUpperCase();
}

export function buildMarketIntelligencePresentation(
  input: MarketIntelligencePresentationInput,
): MarketIntelligencePresentation {
  const { snapshot } = input;
  const trusted = input.marketDataTrusted &&
    snapshot.dataQuality === "pass" &&
    snapshot.frames["1h"].status === "available" &&
    input.crossFeedStatus === "within_tolerance";

  const relativeVolume = snapshot.liquidity.relativeVolume20;
  const volumeProxy = relativeVolume === null
    ? "Volume proxy unavailable"
    : "Volume proxy " + relativeVolume.toFixed(2) + "x";

  return {
    phase: label(snapshot.phase),
    phaseRationale: snapshot.phaseRationale,
    macroTrend: label(snapshot.macroTrend),
    primaryTrend: label(snapshot.primaryTrend),
    tacticalTrend: label(snapshot.tacticalTrend),
    microTrend: label(snapshot.microTrend),
    volatility: label(snapshot.volatilityContext),
    alignment: label(snapshot.alignment),
    uncertainty: label(snapshot.uncertainty),
    lowerTimeframeDivergence: snapshot.lowerTimeframeDivergence
      ? "Lower-timeframe divergence"
      : "No lower-timeframe divergence detected",
    coverage: snapshot.coverage.availableTimeframes + " / " +
      snapshot.coverage.expectedTimeframes + " timeframes",
    quality: label(snapshot.dataQuality),
    crossFeed: input.crossFeedStatus === "within_tolerance"
      ? "Within tolerance"
      : input.crossFeedStatus === "discrepancy"
        ? "Price discrepancy"
        : input.crossFeedStatus === "insufficient_overlap"
          ? "Insufficient timestamp overlap"
          : "Unavailable",
    liquidity: volumeProxy + "; depth unknown; breadth unknown",
    positioning: "UNKNOWN · " + snapshot.positioning.note,
    missingDimensions: snapshot.missingDimensions.length
      ? snapshot.missingDimensions.map(label).join(", ")
      : "None reported",
    paperEligibility: trusted
      ? "PAPER DATA GATE PASSED"
      : "LOCKED · DATA NOT TRUSTED",
  };
}
