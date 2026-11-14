import type { ResearchCandidate } from "../domain/research-pipeline";
import { createBaselineResearchCandidates } from "./baseline-research-candidates";

export const AUTOMATED_CANDIDATE_GENERATOR_VERSION = "1.0.0";
export const AUTOMATED_CANDIDATE_LIMIT = 20;

/**
 * Produces a bounded, deterministic candidate set from transparent strategy
 * templates. This is parameterized search, not an LLM and not a strategy
 * profitability claim. The same candidate set is regenerated each run.
 */
export function createAutomatedResearchCandidates(): ResearchCandidate[] {
  const candidates: ResearchCandidate[] = [];
  const add = (candidate: ResearchCandidate): void => {
    if (candidates.length >= AUTOMATED_CANDIDATE_LIMIT) {
      throw new RangeError("Automated candidate generator exceeded its configured limit");
    }
    candidates.push(candidate);
  };

  for (const fastPeriod of [8, 10, 12]) {
    for (const slowPeriod of [24, 30, 40]) {
      if (fastPeriod >= slowPeriod) continue;
      const candidate = createBaselineResearchCandidates({
        sma: { fastPeriod, slowPeriod },
        rsi: { period: 14, oversold: 30, overbought: 70 },
        donchian: { period: 20 },
      })[0];
      add(candidate);
    }
  }

  for (const period of [10, 14]) {
    for (const oversold of [25, 30]) {
      const overbought = 100 - oversold;
      const candidate = createBaselineResearchCandidates({
        sma: { fastPeriod: 10, slowPeriod: 30 },
        rsi: { period, oversold, overbought },
        donchian: { period: 20 },
      })[1];
      add(candidate);
    }
  }

  for (const period of [20, 30, 40]) {
    const candidate = createBaselineResearchCandidates({
      sma: { fastPeriod: 10, slowPeriod: 30 },
      rsi: { period: 14, oversold: 30, overbought: 70 },
      donchian: { period },
    })[2];
    add(candidate);
  }

  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== candidates.length) throw new Error("Automated candidates must have unique IDs");
  return candidates;
}
