import type { ResearchCandidate } from "../domain/research-pipeline";
import {
  createDonchianBreakout,
  createRsiMeanReversion,
  createSmaCrossover,
  type DonchianBreakoutConfig,
  type RsiMeanReversionConfig,
  type SmaCrossoverConfig,
} from "./baseline-strategies";

export interface BaselineResearchConfig {
  sma: SmaCrossoverConfig;
  rsi: RsiMeanReversionConfig;
  donchian: DonchianBreakoutConfig;
}

/**
 * Returns transparent, unoptimized reference strategies. Parameters are
 * explicit and encoded in IDs so materially different configurations cannot
 * silently share an experiment identity.
 */
export function createBaselineResearchCandidates(
  config: BaselineResearchConfig,
): ResearchCandidate[] {
  // Construct once here to validate all supplied parameter sets immediately.
  createSmaCrossover(config.sma);
  createRsiMeanReversion(config.rsi);
  createDonchianBreakout(config.donchian);

  const { fastPeriod, slowPeriod } = config.sma;
  const { period: rsiPeriod, oversold, overbought } = config.rsi;
  const { period: donchianPeriod } = config.donchian;

  return [
    {
      id: `baseline-sma-cross-f${fastPeriod}-s${slowPeriod}`,
      name: `SMA crossover ${fastPeriod}/${slowPeriod}`,
      fit: () => createSmaCrossover({ ...config.sma }),
    },
    {
      id: `baseline-rsi-reversion-p${rsiPeriod}-o${oversold}-b${overbought}`,
      name: `RSI mean reversion ${rsiPeriod} (${oversold}/${overbought})`,
      fit: () => createRsiMeanReversion({ ...config.rsi }),
    },
    {
      id: `baseline-donchian-breakout-p${donchianPeriod}`,
      name: `Donchian breakout ${donchianPeriod}`,
      fit: () => createDonchianBreakout({ ...config.donchian }),
    },
  ];
}
