import { validateCandles, type Candle } from "./candles";
import { resolveMarketFill, validateMarketExecutionConfig, type MarketExecutionConfig } from "./execution-model";
import type { StrategyEvaluator, BacktestTrade } from "./backtest";

export interface PaperAgentPosition {
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

export interface PaperAgentPendingOrder {
  side: "buy" | "sell";
  remainingQuantity: number;
  submittedAt: number;
  reason: BacktestTrade["exitReason"];
}

export interface PaperAgentFill {
  id: string;
  timestamp: number;
  side: "buy" | "sell";
  status: "filled" | "partial" | "unfilled";
  requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  referencePrice: number;
  executionPrice: number;
  fee: number;
  totalAdverseBps: number;
}

export interface PaperAgentTrade {
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryFee: number;
  exitFee: number;
  pnl: number;
  pnlPct: number;
  exitReason: BacktestTrade["exitReason"];
}

export interface PaperTradingAgentState {
  schemaVersion: 1;
  strategyId: string;
  initialCapital: number;
  cash: number;
  position: PaperAgentPosition | null;
  pendingOrder: PaperAgentPendingOrder | null;
  lastProcessedTimestamp: number;
  tradingDay: string;
  dailyStartEquity: number;
  lastEquity: number;
  peakEquity: number;
  maxDrawdownPct: number;
  realizedPnl: number;
  totalFees: number;
  completedTrades: number;
  totalFillEvents: number;
  totalPartialFillEvents: number;
  processedCandles: number;
  fills: PaperAgentFill[];
  trades: PaperAgentTrade[];
  equityCurve: Array<{ timestamp: number; equity: number; cash: number; positionValue: number }>;
}

export interface PaperTradingAgentConfig {
  allocationFraction: number;
  maxDailyLossFraction: number;
  executionModel: MarketExecutionConfig;
}

function utcDay(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("timestamp must be a non-negative safe integer");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validateConfig(config: PaperTradingAgentConfig): void {
  if (!Number.isFinite(config.allocationFraction) ||
      config.allocationFraction <= 0 || config.allocationFraction > 1) {
    throw new RangeError("allocationFraction must be in (0, 1]");
  }
  if (!Number.isFinite(config.maxDailyLossFraction) ||
      config.maxDailyLossFraction <= 0 || config.maxDailyLossFraction >= 1) {
    throw new RangeError("maxDailyLossFraction must be in (0, 1)");
  }
  validateMarketExecutionConfig(config.executionModel);
}

export function createPaperTradingAgentState(
  strategyId: string,
  initialCapital: number,
  approvedAt: number,
): PaperTradingAgentState {
  if (typeof strategyId !== "string" || !strategyId.trim()) throw new TypeError("strategyId is required");
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new RangeError("initialCapital must be positive");
  const tradingDay = utcDay(approvedAt);
  return {
    schemaVersion: 1,
    strategyId,
    initialCapital,
    cash: initialCapital,
    position: null,
    pendingOrder: null,
    lastProcessedTimestamp: approvedAt,
    tradingDay,
    dailyStartEquity: initialCapital,
    lastEquity: initialCapital,
    peakEquity: initialCapital,
    maxDrawdownPct: 0,
    realizedPnl: 0,
    totalFees: 0,
    completedTrades: 0,
    totalFillEvents: 0,
    totalPartialFillEvents: 0,
    processedCandles: 0,
    fills: [],
    trades: [],
    equityCurve: [],
  };
}

function equityAt(price: number, state: PaperTradingAgentState): number {
  return state.cash + (state.position ? state.position.quantity * price : 0);
}

function appendFill(state: PaperTradingAgentState, fill: PaperAgentFill): void {
  state.fills.push(fill);
  if (state.fills.length > 500) state.fills.splice(0, state.fills.length - 500);
  state.totalFillEvents += 1;
  if (fill.status === "partial") state.totalPartialFillEvents += 1;
  state.totalFees += fill.fee;
}

function fillPendingOrder(
  state: PaperTradingAgentState,
  candle: Candle,
  config: PaperTradingAgentConfig,
): void {
  const pending = state.pendingOrder;
  if (!pending || candle.timestamp <= pending.submittedAt) return;

  const equity = equityAt(candle.open, state);
  const dailyLoss = (state.dailyStartEquity - equity) / state.dailyStartEquity;
  if (pending.side === "buy" && dailyLoss >= config.maxDailyLossFraction) {
    state.pendingOrder = null;
    return;
  }

  let requested = pending.remainingQuantity;
  if (pending.side === "buy") {
    const allocatedValue = (state.position?.quantity ?? 0) * candle.open;
    const capacityValue = Math.max(0, equity * config.allocationFraction - allocatedValue);
    const affordableValue = Math.min(state.cash, capacityValue);
    const maxAffordable = affordableValue / (candle.open * (1 + config.executionModel.feeRate));
    requested = Math.min(requested, maxAffordable);
  } else {
    requested = Math.min(requested, state.position?.quantity ?? 0);
  }

  const fill = resolveMarketFill({
    side: pending.side,
    requestedQuantity: requested,
    referencePrice: candle.open,
    candleVolume: candle.volume,
  }, config.executionModel);

  if (fill.filledQuantity > 0) {
    if (pending.side === "buy") {
      const current = state.position;
      const oldQuantity = current?.quantity ?? 0;
      const nextQuantity = oldQuantity + fill.filledQuantity;
      const oldEntryNotional = (current?.entryPrice ?? 0) * oldQuantity;
      const entryCost = fill.notional + fill.fee;
      state.position = {
        entryTimestamp: current?.entryTimestamp ?? candle.timestamp,
        entryPrice: (oldEntryNotional + fill.notional) / nextQuantity,
        quantity: nextQuantity,
        entryFee: (current?.entryFee ?? 0) + fill.fee,
        entryCost: (current?.entryCost ?? 0) + entryCost,
        originalEntryCost: (current?.originalEntryCost ?? 0) + entryCost,
        originalEntryFee: (current?.originalEntryFee ?? 0) + fill.fee,
        originalQuantity: (current?.originalQuantity ?? 0) + fill.filledQuantity,
        exitNotional: current?.exitNotional ?? 0,
        exitFee: current?.exitFee ?? 0,
        exitQuantity: current?.exitQuantity ?? 0,
      };
      state.cash -= fill.notional + fill.fee;
    } else if (state.position) {
      const position = state.position;
      const allocatedEntryCost = position.entryCost * (fill.filledQuantity / position.quantity);
      state.cash += fill.notional - fill.fee;
      state.realizedPnl += fill.notional - fill.fee - allocatedEntryCost;
      position.exitNotional += fill.notional;
      position.exitFee += fill.fee;
      position.exitQuantity += fill.filledQuantity;
      const remaining = Math.max(0, position.quantity - fill.filledQuantity);
      if (remaining <= 1e-12) {
        const pnl = position.exitNotional - position.exitFee - position.originalEntryCost;
        state.trades.push({
          entryTimestamp: position.entryTimestamp,
          exitTimestamp: candle.timestamp,
          entryPrice: position.entryPrice,
          exitPrice: position.exitNotional / position.exitQuantity,
          quantity: position.originalQuantity,
          entryFee: position.originalEntryFee,
          exitFee: position.exitFee,
          pnl,
          pnlPct: pnl / position.originalEntryCost * 100,
          exitReason: pending.reason,
        });
        if (state.trades.length > 500) state.trades.splice(0, state.trades.length - 500);
        state.completedTrades += 1;
        state.position = null;
      } else {
        const remainingFraction = remaining / position.quantity;
        position.quantity = remaining;
        position.entryCost -= allocatedEntryCost;
        position.entryFee *= remainingFraction;
      }
    }

    appendFill(state, {
      id: "paper-agent-" + candle.timestamp + "-" + (state.totalFillEvents + 1),
      timestamp: candle.timestamp,
      side: pending.side,
      status: fill.status,
      requestedQuantity: pending.remainingQuantity,
      filledQuantity: fill.filledQuantity,
      remainingQuantity: fill.remainingQuantity,
      referencePrice: fill.referencePrice,
      executionPrice: fill.executionPrice,
      fee: fill.fee,
      totalAdverseBps: fill.totalAdverseBps,
    });
  }

  const remaining = Math.max(0, pending.remainingQuantity - fill.filledQuantity);
  state.pendingOrder = remaining > 1e-12
    ? { ...pending, remainingQuantity: remaining }
    : null;
}

function recordEquity(state: PaperTradingAgentState, candle: Candle): void {
  const positionValue = state.position ? state.position.quantity * candle.close : 0;
  const equity = state.cash + positionValue;
  state.lastEquity = equity;
  state.peakEquity = Math.max(state.peakEquity, equity);
  if (state.peakEquity > 0) {
    state.maxDrawdownPct = Math.max(
      state.maxDrawdownPct,
      (state.peakEquity - equity) / state.peakEquity * 100,
    );
  }
  state.equityCurve.push({ timestamp: candle.timestamp, equity, cash: state.cash, positionValue });
  if (state.equityCurve.length > 500) {
    state.equityCurve.splice(0, state.equityCurve.length - 500);
  }
}

/**
 * Advances a persistent long-only paper account using only newly closed candles.
 * The evaluator is replayed over the available history to restore stateful
 * indicators, while order processing is idempotently restricted to newer bars.
 */
export function runPaperTradingAgentCycle(
  previousState: PaperTradingAgentState,
  inputCandles: readonly Candle[],
  evaluate: StrategyEvaluator,
  config: PaperTradingAgentConfig,
): PaperTradingAgentState {
  validateConfig(config);
  if (!previousState || previousState.schemaVersion !== 1 ||
      typeof previousState.strategyId !== "string" || !previousState.strategyId.trim()) {
    throw new TypeError("A supported paper trading state is required");
  }
  if (typeof evaluate !== "function") throw new TypeError("A strategy evaluator is required");
  const candles = validateCandles(inputCandles);
  if (candles.some((candle) => candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0)) {
    throw new RangeError("Paper spot trading requires strictly positive OHLC prices");
  }
  if (previousState.lastProcessedTimestamp < candles[0].timestamp) {
    throw new RangeError("Candle history no longer contains the last processed timestamp; paper trading halted for safe recovery");
  }
  if (previousState.lastProcessedTimestamp > candles[candles.length - 1].timestamp) {
    throw new RangeError("Market data is older than the persisted paper trading checkpoint");
  }

  const state: PaperTradingAgentState = structuredClone(previousState);
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const history = Object.freeze(candles.slice(0, index + 1).map((item) => Object.freeze({ ...item })));
    const signal = evaluate(history);
    if (signal !== "buy" && signal !== "sell" && signal !== "hold") {
      throw new TypeError("Strategy returned an invalid signal");
    }
    if (candle.timestamp <= state.lastProcessedTimestamp) continue;

    const day = utcDay(candle.timestamp);
    if (day !== state.tradingDay) {
      state.tradingDay = day;
      state.dailyStartEquity = state.lastEquity;
    }

    fillPendingOrder(state, candle, config);
    recordEquity(state, candle);

    if (state.pendingOrder?.side === "buy" && signal === "sell") {
      state.pendingOrder = null;
    } else if (state.pendingOrder?.side === "sell" && state.pendingOrder.reason === "signal" && signal === "buy") {
      state.pendingOrder = null;
    }

    if (!state.pendingOrder && signal === "buy" && !state.position) {
      const dailyLoss = (state.dailyStartEquity - state.lastEquity) / state.dailyStartEquity;
      if (dailyLoss < config.maxDailyLossFraction) {
        const budget = Math.min(state.cash, state.lastEquity * config.allocationFraction);
        const quantity = budget / (candle.close * (1 + config.executionModel.feeRate));
        if (quantity > 1e-12 && Number.isFinite(quantity)) {
          state.pendingOrder = {
            side: "buy",
            remainingQuantity: quantity,
            submittedAt: candle.timestamp,
            reason: "signal",
          };
        }
      }
    } else if (!state.pendingOrder && signal === "sell" && state.position) {
      state.pendingOrder = {
        side: "sell",
        remainingQuantity: state.position.quantity,
        submittedAt: candle.timestamp,
        reason: "signal",
      };
    }

    state.lastProcessedTimestamp = candle.timestamp;
    state.processedCandles += 1;
  }

  return state;
}
