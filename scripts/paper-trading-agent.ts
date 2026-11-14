import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchBinanceHistory } from "../src/adapters/binance-public";
import { createBaselineResearchCandidates } from "../src/strategies/baseline-research-candidates";
import {
  createPaperTradingAgentState,
  runPaperTradingAgentCycle,
  type PaperTradingAgentConfig,
  type PaperTradingAgentState,
} from "../src/domain/paper-trading-agent";

interface PaperStrategyConfig {
  id: string;
  family: "sma-crossover" | "rsi-mean-reversion" | "donchian-breakout";
  parameters: Record<string, number>;
}

interface PaperTradingConfig {
  schemaVersion: 1;
  enabled: boolean;
  symbol: string;
  interval: "1h";
  approvedAt: number | null;
  approvedBy: string | null;
  approvalRationale: string | null;
  strategy: PaperStrategyConfig | null;
  risk: {
    initialCapitalUsdt: number;
    allocationFraction: number;
    maxDailyLossFraction: number;
    feeRate: number;
    baseSlippageBps: number;
    halfSpreadBps: number;
    maxParticipationRate: number;
    marketImpactBpsAtMaxParticipation: number;
  };
}

const HOUR_MS = 60 * 60 * 1_000;
const HISTORY_BARS = 600;

function candidateFromConfig(strategy: PaperStrategyConfig) {
  if (!["sma-crossover", "rsi-mean-reversion", "donchian-breakout"].includes(strategy.family)) {
    throw new TypeError("Approved paper strategy family is not supported");
  }
  const candidates = createBaselineResearchCandidates({
    sma: {
      fastPeriod: strategy.family === "sma-crossover" ? strategy.parameters.fastPeriod : 10,
      slowPeriod: strategy.family === "sma-crossover" ? strategy.parameters.slowPeriod : 30,
    },
    rsi: {
      period: strategy.family === "rsi-mean-reversion" ? strategy.parameters.period : 14,
      oversold: strategy.family === "rsi-mean-reversion" ? strategy.parameters.oversold : 30,
      overbought: strategy.family === "rsi-mean-reversion" ? strategy.parameters.overbought : 70,
    },
    donchian: {
      period: strategy.family === "donchian-breakout" ? strategy.parameters.period : 20,
    },
  });
  const index = strategy.family === "sma-crossover" ? 0
    : strategy.family === "rsi-mean-reversion" ? 1 : 2;
  const candidate = candidates[index];
  if (candidate.id !== strategy.id) {
    throw new Error("Approved strategy ID does not match its reviewed parameter configuration");
  }
  return candidate;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const configPath = process.env.NEXUS_PAPER_CONFIG ?? "ledger/data/paper-trading-config.json";
  const statePath = process.env.NEXUS_PAPER_STATE ?? "ledger/data/paper-trading-state.json";
  const reportPath = process.env.NEXUS_PAPER_REPORT ?? "artifacts/paper-trading-report.json";
  const rawConfig = await readJson(configPath);
  if (!rawConfig || typeof rawConfig !== "object") throw new TypeError("Paper trading configuration is invalid");
  const config = rawConfig as PaperTradingConfig;
  if (config.schemaVersion !== 1 || typeof config.enabled !== "boolean") {
    throw new TypeError("Unsupported paper trading configuration schema");
  }

  const outputDirectory = join(process.cwd(), "artifacts");
  await mkdir(outputDirectory, { recursive: true });
  if (!config.enabled) {
    await writeFile(reportPath, JSON.stringify({
      schemaVersion: 1,
      status: "disabled",
      message: "Paper trading remains disabled until a strategy is explicitly approved by a human.",
      generatedAt: new Date().toISOString(),
      realTrading: false,
    }, null, 2) + "\n", "utf8");
    console.log("Paper trading disabled; no orders or ledger changes were made.");
    return;
  }

  if (!/^[A-Z0-9]{5,20}$/.test(config.symbol) || config.interval !== "1h" ||
      !Number.isSafeInteger(config.approvedAt) || (config.approvedAt as number) < 0 ||
      typeof config.approvedBy !== "string" || !config.approvedBy.trim() ||
      typeof config.approvalRationale !== "string" || config.approvalRationale.trim().length < 10 ||
      !config.strategy || !config.risk) {
    throw new TypeError("Enabled paper trading requires a complete human approval record and strategy");
  }
  const candidate = candidateFromConfig(config.strategy);
  const now = Date.now();
  const candles = await fetchBinanceHistory({
    symbol: config.symbol,
    interval: config.interval,
    startTime: now - HISTORY_BARS * HOUR_MS,
    endTime: now - 1,
    pageLimit: 1_000,
    maxCandles: HISTORY_BARS,
  }, fetch, now);
  if (candles.length < 100) throw new Error("Insufficient closed candles to warm up the approved paper strategy");

  let approvalIndex = -1;
  for (let index = 0; index < candles.length; index += 1) {
    if (candles[index].timestamp <= (config.approvedAt as number)) approvalIndex = index;
  }
  if (approvalIndex < 0) {
    throw new Error("Approval timestamp is outside the available candle history; disable and re-approve to reset safely");
  }
  const executionConfig: PaperTradingAgentConfig = {
    allocationFraction: config.risk.allocationFraction,
    maxDailyLossFraction: config.risk.maxDailyLossFraction,
    executionModel: {
      feeRate: config.risk.feeRate,
      baseSlippageBps: config.risk.baseSlippageBps,
      halfSpreadBps: config.risk.halfSpreadBps,
      maxParticipationRate: config.risk.maxParticipationRate,
      marketImpactBpsAtMaxParticipation: config.risk.marketImpactBpsAtMaxParticipation,
    },
  };

  let state: PaperTradingAgentState;
  const stored = await readJson(statePath);
  if (stored === null) {
    state = createPaperTradingAgentState(
      candidate.id,
      config.risk.initialCapitalUsdt,
      candles[approvalIndex].timestamp,
    );
  } else {
    state = stored as PaperTradingAgentState;
    if (state.strategyId !== candidate.id || state.initialCapital !== config.risk.initialCapitalUsdt) {
      throw new Error("Paper ledger does not match the currently approved strategy; disable and reset through human review");
    }
  }

  const previousProcessedCandles = state.processedCandles;
  const nextState = runPaperTradingAgentCycle(state, candles, candidate.fit(candles.slice(0, approvalIndex + 1)), executionConfig);
  await writeFile(statePath, JSON.stringify(nextState, null, 2) + "\n", "utf8");
  const positionValue = nextState.position
    ? nextState.position.quantity * candles[candles.length - 1].close : 0;
  const equity = nextState.cash + positionValue;
  const report = {
    schemaVersion: 1,
    status: "active",
    generatedAt: new Date(now).toISOString(),
    symbol: config.symbol,
    interval: config.interval,
    strategy: config.strategy,
    approval: {
      approvedAt: config.approvedAt,
      approvedBy: config.approvedBy,
      rationale: config.approvalRationale,
    },
    checkpoint: {
      lastProcessedTimestamp: nextState.lastProcessedTimestamp,
      newlyProcessedCandles: nextState.processedCandles - previousProcessedCandles,
      datasetCandles: candles.length,
    },
    account: {
      initialCapitalUsdt: nextState.initialCapital,
      cashUsdt: nextState.cash,
      positionQuantity: nextState.position?.quantity ?? 0,
      equityUsdt: equity,
      netReturnPct: (equity / nextState.initialCapital - 1) * 100,
      realizedPnlUsdt: nextState.realizedPnl,
      totalFeesUsdt: nextState.totalFees,
      maxDrawdownPct: nextState.maxDrawdownPct,
      completedTrades: nextState.completedTrades,
      fillEvents: nextState.totalFillEvents,
      partialFillEvents: nextState.totalPartialFillEvents,
      pendingOrder: nextState.pendingOrder,
    },
    assumptions: config.risk,
    safeguards: {
      paperOnly: true,
      liveTrading: false,
      longOnly: true,
      leverage: false,
      dailyLossLimit: true,
      humanApprovedStrategyRequired: true,
    },
    state: nextState,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    status: report.status,
    strategyId: candidate.id,
    lastProcessedTimestamp: nextState.lastProcessedTimestamp,
    newlyProcessedCandles: nextState.processedCandles - previousProcessedCandles,
    equityUsdt: equity,
    completedTrades: nextState.completedTrades,
    fillEvents: nextState.totalFillEvents,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
