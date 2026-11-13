import { resolveMarketFill, type MarketExecutionConfig, type MarketOrderSide } from "./execution-model";
import { validateCandles, type Candle } from "./candles";
import type { BacktestPosition, BacktestResult, BacktestSignal, BacktestTrade, StrategyEvaluator } from "./backtest";

export interface ExecutionAwareBacktestConfig {
  initialCapital: number;
  allocationFraction: number;
  warmupBars?: number;
  executionModel: MarketExecutionConfig;
}

export interface PendingBacktestOrder {
  side: MarketOrderSide;
  remainingQuantity: number;
  submittedAt: number;
}

export interface ExecutionAwareBacktestResult extends BacktestResult {
  pendingOrder: PendingBacktestOrder | null;
}

interface ActivePosition {
  entryTimestamp: number;
  entryPrice: number;
  quantity: number;
  entryFee: number;
  entryCost: number;
  originalEntryCost: number;
  originalEntryFee: number;
  originalQuantity: number;
  exitNotional: number;
  exitFee: number;
  exitQuantity: number;
}

function validateConfig(config: ExecutionAwareBacktestConfig): void {
  if (!Number.isFinite(config.initialCapital) || config.initialCapital <= 0) {
    throw new RangeError("initialCapital must be positive");
  }
  if (!Number.isFinite(config.allocationFraction) ||
      config.allocationFraction <= 0 || config.allocationFraction > 1) {
    throw new RangeError("allocationFraction must be in (0, 1]");
  }
}

export function runExecutionAwareBacktest(
  inputCandles: readonly Candle[],
  evaluate: StrategyEvaluator,
  config: ExecutionAwareBacktestConfig,
): ExecutionAwareBacktestResult {
  validateConfig(config);
  const candles = validateCandles(inputCandles);
  if (candles.some(c => c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0)) {
    throw new RangeError("Spot backtests require strictly positive OHLC prices");
  }
  const warmupBars = config.warmupBars ?? 0;
  if (!Number.isSafeInteger(warmupBars) || warmupBars < 0 ||
      warmupBars > candles.length || (candles.length > 0 && warmupBars === candles.length)) {
    throw new RangeError("warmupBars must be a non-negative integer smaller than the candle count");
  }

  let cash = config.initialCapital;
  let position: ActivePosition | null = null;
  let pending: PendingBacktestOrder | null = null;
  let totalFees = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestResult["equityCurve"] = [];

  for (let i = warmupBars; i < candles.length; i += 1) {
    const candle = candles[i];

    if (pending && candle.timestamp > pending.submittedAt) {
      const currentEquity = cash + (position ? position.quantity * candle.open : 0);
      let requested = pending.remainingQuantity;
      if (pending.side === "buy") {
        const allocationBudget = Math.max(0, currentEquity * config.allocationFraction);
        const maxAffordable = Math.min(cash, allocationBudget) /
          (candle.open * (1 + config.executionModel.feeRate));
        requested = Math.min(requested, maxAffordable);
      } else {
        requested = Math.min(requested, position?.quantity ?? 0);
      }

      if (requested > 1e-12) {
        const fill = resolveMarketFill({
          side: pending.side,
          requestedQuantity: requested,
          referencePrice: candle.open,
          candleVolume: candle.volume,
        }, config.executionModel);

        if (fill.filledQuantity > 0) {
          totalFees += fill.fee;
          if (pending.side === "buy") {
            const previousPosition: ActivePosition | null = position;
            const oldQuantity: number = previousPosition?.quantity ?? 0;
            const nextQuantity: number = oldQuantity + fill.filledQuantity;
            const oldEntryCost: number = previousPosition?.entryCost ?? 0;
            const oldEntryFee: number = previousPosition?.entryFee ?? 0;
            const nextEntryCost: number = oldEntryCost + fill.notional + fill.fee;
            const nextEntryFee: number = oldEntryFee + fill.fee;
            const nextEntryNotional: number = (previousPosition?.entryPrice ?? 0) * oldQuantity + fill.notional;
            position = {
              entryTimestamp: previousPosition?.entryTimestamp ?? candle.timestamp,
              entryPrice: nextEntryNotional / nextQuantity,
              quantity: nextQuantity,
              entryFee: nextEntryFee,
              entryCost: nextEntryCost,
              originalEntryCost: nextEntryCost,
              originalEntryFee: nextEntryFee,
              originalQuantity: nextQuantity,
              exitNotional: 0,
              exitFee: 0,
              exitQuantity: 0,
            };
            cash -= fill.notional + fill.fee;
          } else if (position) {
            cash += fill.notional - fill.fee;
            position.exitNotional += fill.notional;
            position.exitFee += fill.fee;
            position.exitQuantity += fill.filledQuantity;
            const oldQuantity = position.quantity;
            const remaining = Math.max(0, oldQuantity - fill.filledQuantity);
            if (remaining <= 1e-12) {
              const pnl = position.exitNotional - position.exitFee - position.originalEntryCost;
              trades.push({
                entryTimestamp: position.entryTimestamp,
                exitTimestamp: candle.timestamp,
                entryPrice: position.entryPrice,
                exitPrice: position.exitNotional / position.exitQuantity,
                quantity: position.originalQuantity,
                entryFee: position.originalEntryFee,
                exitFee: position.exitFee,
                pnl,
                pnlPct: (pnl / position.originalEntryCost) * 100,
                exitReason: "signal",
              });
              position = null;
            } else {
              const remainingFraction = remaining / oldQuantity;
              position.quantity = remaining;
              position.entryCost *= remainingFraction;
              position.entryFee *= remainingFraction;
            }
          }
          pending.remainingQuantity = Math.max(0, pending.remainingQuantity - fill.filledQuantity);
        }
      }
      if (pending.remainingQuantity <= 1e-12) pending = null;
    }

    const positionValue = position ? position.quantity * candle.close : 0;
    const equity = cash + positionValue;
    equityCurve.push({ timestamp: candle.timestamp, equity, cash, positionValue });

    const history = candles.slice(0, i + 1).map(item => Object.freeze({ ...item }));
    const signal = evaluate(Object.freeze(history));
    if (signal !== "buy" && signal !== "sell" && signal !== "hold") {
      throw new TypeError("Strategy returned an invalid signal");
    }

    if (pending && ((pending.side === "buy" && signal === "sell") ||
        (pending.side === "sell" && signal === "buy"))) {
      pending = null;
    }
    if (!pending && signal === "buy" && !position) {
      const budget = Math.min(cash, equity * config.allocationFraction);
      const quantity = budget / (candle.close * (1 + config.executionModel.feeRate));
      if (quantity > 0 && Number.isFinite(quantity)) {
        pending = { side: "buy", remainingQuantity: quantity, submittedAt: candle.timestamp };
      }
    } else if (!pending && signal === "sell" && position) {
      pending = {
        side: "sell",
        remainingQuantity: position.quantity,
        submittedAt: candle.timestamp,
      };
    }
  }

  const endingEquity = equityCurve.length
    ? equityCurve[equityCurve.length - 1].equity
    : config.initialCapital;
  let peak = config.initialCapital;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - point.equity) / peak * 100);
  }
  const winners = trades.filter(t => t.pnl > 0).length;
  const openPosition: BacktestPosition | null = position ? {
    entryTimestamp: position.entryTimestamp,
    entryPrice: position.entryPrice,
    quantity: position.quantity,
    entryFee: position.entryFee,
    entryCost: position.entryCost,
  } : null;

  return {
    startingCapital: config.initialCapital,
    endingEquity,
    cash,
    totalReturnPct: (endingEquity - config.initialCapital) / config.initialCapital * 100,
    maxDrawdownPct,
    completedTrades: trades.length,
    winRatePct: trades.length ? winners / trades.length * 100 : 0,
    totalFees,
    trades,
    equityCurve,
    openPosition,
    pendingOrder: pending ? { ...pending } : null,
  };
}
