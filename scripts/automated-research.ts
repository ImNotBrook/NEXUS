import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchBinanceHistory } from "../src/adapters/binance-public";
import { runResearchBatch } from "../src/domain/research-pipeline";
import { createAutomatedResearchCandidates, AUTOMATED_CANDIDATE_GENERATOR_VERSION } from "../src/strategies/automated-strategy-search";
import { generateAiStrategyProposalsWithFallback } from "../src/adapters/multi-provider-strategy-generator";
import { compileAiStrategyProposals } from "../src/strategies/ai-candidate-compiler";
import { compileComposedStrategy } from "../src/strategies/composed-strategy-compiler";

const SYMBOL = "BTCUSDT";
const INTERVAL = "1h" as const;
const CANDLE_COUNT = 1_500;
const INTERVAL_MS = 60 * 60 * 1_000;

async function main(): Promise<void> {
  const now = Date.now();
  const candles = await fetchBinanceHistory({
    symbol: SYMBOL,
    interval: INTERVAL,
    startTime: now - CANDLE_COUNT * INTERVAL_MS,
    endTime: now - 1,
    pageLimit: 1_000,
    maxCandles: CANDLE_COUNT,
  }, fetch, now);

  if (candles.length < 1_100) {
    throw new Error(`Fail closed: received only ${candles.length} closed candles; at least 1,100 are required`);
  }

  const deterministicCandidates = createAutomatedResearchCandidates();
  let candidates = deterministicCandidates;
  let aiGeneration: {
    status: "not_configured" | "generated" | "fallback";
    provider: string | null;
    model: string | null;
    proposals: Array<{ family: string; parameters: Record<string, number>; rationale: string }>;
    composedStrategies: Array<unknown>;
    attempts: Array<{ provider: string; status: string; reason?: string }>;
  } = {
    status: "not_configured",
    provider: null,
    model: null,
    proposals: [],
    composedStrategies: [],
    attempts: [],
  };

  const recent = candles.slice(-25);
  const firstClose = recent[0].close;
  const lastClose = recent[recent.length - 1].close;
  const returns = recent.slice(1).map((candle, index) =>
    (candle.close / recent[index].close - 1) * 100,
  );
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) /
    Math.max(1, returns.length - 1);
  const recentRange = recent.slice(-14);
  const atrPct = recentRange.reduce((sum, candle, index) => {
    const previousClose = recentRange[Math.max(0, index - 1)].close;
    return sum + Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }, 0) / recentRange.length / lastClose * 100;
  const averageClose = recent.reduce((sum, candle) => sum + candle.close, 0) / recent.length;
  const regime = lastClose > averageClose * 1.002 ? "uptrend"
    : lastClose < averageClose * 0.998 ? "downtrend" : "range";

  const aiResult = await generateAiStrategyProposalsWithFallback({
    symbol: SYMBOL,
    interval: INTERVAL,
    recentReturnPct: (lastClose / firstClose - 1) * 100,
    volatilityPct: Math.sqrt(variance) * Math.sqrt(returns.length),
    atrPct,
    regime,
  }, process.env);

  if (aiResult.status === "generated") {
    const aiCandidates = compileAiStrategyProposals(aiResult.proposals);
    const composedCandidates = aiResult.composedStrategies.map(compileComposedStrategy);
    const merged = new Map(deterministicCandidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of aiCandidates) merged.set(candidate.id, candidate);
    for (const candidate of composedCandidates) merged.set(candidate.id, candidate);
    candidates = [...merged.values()].slice(0, 25);
    aiGeneration = {
      status: "generated",
      provider: aiResult.provider,
      model: aiResult.model,
      proposals: aiResult.proposals.map((proposal) => ({
        family: proposal.family,
        parameters: proposal.parameters,
        rationale: proposal.rationale,
      })),
      composedStrategies: aiResult.composedStrategies,
      attempts: aiResult.attempts,
    };
  } else {
    aiGeneration = {
      status: aiResult.status,
      provider: null,
      model: null,
      proposals: [],
      composedStrategies: [],
      attempts: aiResult.attempts,
    };
    if (aiResult.status === "fallback") {
      console.warn("All configured AI providers failed; deterministic research fallback will be used.");
    }
  }

  const report = runResearchBatch(candles, candidates, {
    folds: {
      trainBars: 700,
      testBars: 120,
      stepBars: 120,
      embargoBars: 2,
      expanding: true,
    },
    backtest: {
      initialCapital: 10_000,
      feeRate: 0.001,
      slippageBps: 8,
      allocationFraction: 0.25,
    },
    executionModel: {
      feeRate: 0.001,
      baseSlippageBps: 8,
      halfSpreadBps: 5,
      maxParticipationRate: 0.02,
      marketImpactBpsAtMaxParticipation: 25,
    },
    regime: {
      fastEmaPeriod: 10,
      slowEmaPeriod: 30,
      atrPeriod: 14,
      trendThresholdPct: 0.15,
      lowVolatilityAtrPct: 0.5,
      highVolatilityAtrPct: 3,
    },
  }, { symbol: SYMBOL, interval: INTERVAL, provider: "Binance public spot" });

  const output = {
    schemaVersion: 1,
    agentMode: aiGeneration.status === "generated" ? "ai-assisted-automated-research" : "deterministic-automated-research",
    aiModelUsed: aiGeneration.status === "generated",
    aiProviderUsed: aiGeneration.provider,
    aiGeneration,
    generatorVersion: AUTOMATED_CANDIDATE_GENERATOR_VERSION,
    createdAt: new Date(now).toISOString(),
    symbol: SYMBOL,
    interval: INTERVAL,
    assumptions: {
      initialCapitalUsdt: 10_000,
      feeBps: 10,
      baseSlippageBps: 8,
      halfSpreadBps: 5,
      maxParticipationPct: 2,
      marketImpactBpsAtMaxParticipation: 25,
      allocationPct: 25,
      trainBars: 700,
      testBars: 120,
      embargoBars: 2,
      note: "Conservative research assumptions, not verified exchange fee tiers or executable quotes.",
    },
    safeguards: {
      sameDatasetAcrossCandidates: true,
      walkForwardOutOfSampleRequired: true,
      executionCostsIncluded: true,
      automaticWinnerPromotion: false,
      paperTrading: false,
      liveTrading: false,
    },
    selectionWarning: "Candidate results are diagnostic. Do not select a winner by repeatedly inspecting the same out-of-sample folds. Use nested walk-forward selection and preserve a final untouched holdout before any approval.",
    report,
  };

  const outputDirectory = join(process.cwd(), "artifacts");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "automated-research.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  const foldCount = report.candidateResults[0]?.evaluation.foldCount ?? 0;
  console.log(JSON.stringify({
    outputPath,
    candleCount: candles.length,
    candidateCount: candidates.length,
    foldCount,
    datasetFingerprint: report.dataset.fingerprint,
    aiModelUsed: aiGeneration.status === "generated",
    aiGenerationStatus: aiGeneration.status,
    aiProviderUsed: aiGeneration.provider,
    aiProviderAttempts: aiGeneration.attempts,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
