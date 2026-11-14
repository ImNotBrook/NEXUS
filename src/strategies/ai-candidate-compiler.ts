import type { AiStrategyProposal } from "../domain/ai-strategy-proposals";
import type { ResearchCandidate } from "../domain/research-pipeline";
import { createBaselineResearchCandidates } from "./baseline-research-candidates";

/** Compiles validated AI proposals to a fixed, reviewed strategy-template whitelist. */
export function compileAiStrategyProposals(proposals: readonly AiStrategyProposal[]): ResearchCandidate[] {
  const candidates: ResearchCandidate[] = [];
  const ids = new Set<string>();
  for (const proposal of proposals) {
    let candidate: ResearchCandidate;
    if (proposal.family === "sma-crossover") {
      candidate = createBaselineResearchCandidates({
        sma: proposal.parameters,
        rsi: { period: 14, oversold: 30, overbought: 70 },
        donchian: { period: 20 },
      })[0];
    } else if (proposal.family === "rsi-mean-reversion") {
      candidate = createBaselineResearchCandidates({
        sma: { fastPeriod: 10, slowPeriod: 30 },
        rsi: proposal.parameters,
        donchian: { period: 20 },
      })[1];
    } else {
      candidate = createBaselineResearchCandidates({
        sma: { fastPeriod: 10, slowPeriod: 30 },
        rsi: { period: 14, oversold: 30, overbought: 70 },
        donchian: proposal.parameters,
      })[2];
    }
    if (ids.has(candidate.id)) continue;
    ids.add(candidate.id);
    candidates.push(candidate);
  }
  return candidates;
}
