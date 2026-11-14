import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchBinanceHistory } from "../src/adapters/binance-public";
import { runResearchBatch } from "../src/domain/research-pipeline";
import { createAutomatedResearchCandidates, AUTOMATED_CANDIDATE_GENERATOR_VERSION } from "../src/strategies/automated-strategy-search";

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

  const candidates = createAutomatedResearchCandidates();
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
    agentMode: "deterministic-automated-research",
    aiModelUsed: false,
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
    aiModelUsed: false,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
