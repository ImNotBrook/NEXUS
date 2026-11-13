import { resolveMarketFill, type MarketExecutionConfig } from "./execution-model";
import type { PaperAccount, PaperBrokerConfig, PaperFill, PaperPosition } from "./paper-broker";

declare module "./paper-broker" {
  interface PaperBrokerConfig { executionModel?: MarketExecutionConfig }
  interface PaperAccount { openOrders?: readonly PaperOpenOrder[] }
}
export interface PaperOpenOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  requestedQuantity: number;
  remainingQuantity: number;
  referencePrice: number;
  createdAt: number;
  lastAttemptAt: number;
  status: "open" | "partial";
}

export interface PaperAccount {
  openOrders?: readonly PaperOpenOrder[];
}

export interface SubmitPaperOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  referencePrice: number;
  timestamp: number;
}

export interface PaperCandleExecution {
  symbol: string;
  open: number;
  volume: number;
  timestamp: number;
}

function executionConfig(config: PaperBrokerConfig): MarketExecutionConfig {
  return config.executionModel ?? {
    feeRate: config.feeRate,
    baseSlippageBps: config.slippageRate * 10_000,
    halfSpreadBps: 0,
    maxParticipationRate: 1,
    marketImpactBpsAtMaxParticipation: 0,
  };
}

function utcDay(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("timestamp must be a non-negative safe integer");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function paperSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new TypeError("symbol must be an exchange-style alphanumeric pair");
  return symbol;
}

export function submitPaperOrder(
  account: PaperAccount,
  request: SubmitPaperOrderRequest,
): PaperAccount {
  const symbol = paperSymbol(request.symbol);
  if (request.side !== "buy" && request.side !== "sell") throw new TypeError("side must be buy or sell");
  if (!Number.isFinite(request.quantity) || request.quantity <= 0) throw new RangeError("quantity must be positive");
  if (!Number.isFinite(request.referencePrice) || request.referencePrice <= 0) throw new RangeError("referencePrice must be positive");
  const day = utcDay(request.timestamp);
  if (day !== account.tradingDay) throw new Error("Mark the account for the new trading day before submitting orders");

  const equity = account.cash + Object.values(account.positions).reduce((sum, p) => sum + p.quantity * p.markPrice, 0);
  const dailyLoss = (account.dailyStartEquity - equity) / account.dailyStartEquity;
  const orders = [...(account.openOrders ?? [])];
  if (request.side === "buy") {
    if (dailyLoss >= account.config.maxDailyLossFraction) throw new Error("Daily loss limit reached; new orders are blocked");
    const pendingBuyValue = orders.filter(o => o.side === "buy")
      .reduce((sum, o) => sum + o.remainingQuantity * o.referencePrice, 0);
    const currentValue = (account.positions[symbol]?.quantity ?? 0) * request.referencePrice;
    if (currentValue + pendingBuyValue + request.quantity * request.referencePrice >
        equity * account.config.maxPositionValueFraction) {
      throw new Error("Order exceeds the position allocation limit");
    }
    const pendingBuyCash = orders.filter(o => o.side === "buy")
      .reduce((sum, o) => sum + o.remainingQuantity * o.referencePrice *
        (1 + account.config.feeRate), 0);
    if (pendingBuyCash + request.quantity * request.referencePrice *
        (1 + account.config.feeRate) > account.cash) {
      throw new Error("Insufficient cash reserved for open buy orders");
    }
  } else {
    const current = account.positions[symbol];
    const pendingSell = orders.filter(o => o.side === "sell" && o.symbol === symbol)
      .reduce((sum, o) => sum + o.remainingQuantity, 0);
    if (!current || request.quantity + pendingSell > current.quantity + 1e-12) {
      throw new Error("Insufficient unreserved position quantity to sell");
    }
  }

  const id = `paper-order-${request.timestamp}-${orders.length + 1}-${symbol}`;
  orders.push({
    id, symbol, side: request.side,
    requestedQuantity: request.quantity,
    remainingQuantity: request.quantity,
    referencePrice: request.referencePrice,
    createdAt: request.timestamp,
    lastAttemptAt: request.timestamp,
    status: "open",
  });
  return { ...account, openOrders: orders };
}

export function processPaperCandle(
  account: PaperAccount,
  candle: PaperCandleExecution,
): PaperAccount {
  const symbol = paperSymbol(candle.symbol);
  if (!Number.isFinite(candle.open) || candle.open <= 0) throw new RangeError("candle open must be positive");
  if (!Number.isFinite(candle.volume) || candle.volume < 0) throw new RangeError("candle volume must be non-negative");
  utcDay(candle.timestamp);
  const orders = [...(account.openOrders ?? [])];
  const config = executionConfig(account.config);
  const capacity = candle.volume * config.maxParticipationRate;
  let consumed = 0;
  let next: PaperAccount = account;

  for (const order of orders) {
    if (order.symbol !== symbol || order.lastAttemptAt >= candle.timestamp) continue;
    const availableCapacity = Math.max(0, capacity - consumed);
    if (availableCapacity <= 0) break;
    const availableVolume = availableCapacity / config.maxParticipationRate;
    const currentOrders = [...(next.openOrders ?? [])];
    const currentOrder = currentOrders.find(o => o.id === order.id);
    if (!currentOrder) continue;

    let requested = currentOrder.remainingQuantity;
    if (order.side === "sell") {
      requested = Math.min(requested, next.positions[symbol]?.quantity ?? 0);
    } else {
      const equity = next.cash + Object.values(next.positions).reduce((sum, p) => sum + p.quantity * p.markPrice, 0);
      const position = next.positions[symbol];
      const maxValue = Math.max(0, equity * next.config.maxPositionValueFraction -
        (position?.quantity ?? 0) * candle.open);
      const maxByRisk = maxValue / (candle.open * (1 + config.feeRate));
      const maxByCash = next.cash / (candle.open * (1 + config.feeRate));
      requested = Math.min(requested, maxByRisk, maxByCash);
    }

    if (requested <= 1e-12) {
      currentOrder.lastAttemptAt = candle.timestamp;
      next = { ...next, openOrders: currentOrders };
      continue;
    }

    const fill = resolveMarketFill({
      side: order.side,
      requestedQuantity: requested,
      referencePrice: candle.open,
      candleVolume: availableVolume,
    }, config);
    consumed += fill.filledQuantity;
    currentOrder.lastAttemptAt = candle.timestamp;

    if (fill.filledQuantity > 0) {
      const positions = { ...next.positions };
      let cash = next.cash;
      let realizedPnl = next.realizedPnl;
      let fillRealizedPnl = 0;
      if (order.side === "buy") {
        const current = positions[symbol];
        const oldQuantity = current?.quantity ?? 0;
        const quantity = oldQuantity + fill.filledQuantity;
        const averageEntryPrice = current
          ? (current.averageEntryPrice * oldQuantity + fill.notional + fill.fee) / quantity
          : (fill.notional + fill.fee) / quantity;
        positions[symbol] = { symbol, quantity, averageEntryPrice, markPrice: candle.open };
        cash -= fill.notional + fill.fee;
      } else {
        const current = positions[symbol];
        if (!current) throw new Error("Position disappeared while processing a reserved sell order");
        fillRealizedPnl = (fill.executionPrice - current.averageEntryPrice) *
          fill.filledQuantity - fill.fee;
        realizedPnl += fillRealizedPnl;
        cash += fill.notional - fill.fee;
        const remaining = current.quantity - fill.filledQuantity;
        if (remaining <= 1e-12) delete positions[symbol];
        else positions[symbol] = { ...current, quantity: remaining, markPrice: candle.open };
      }

      const paperFill: PaperFill = {
        id: `paper-${candle.timestamp}-${next.fills.length + 1}`,
        symbol, side: order.side, quantity: fill.filledQuantity,
        referencePrice: candle.open, price: fill.executionPrice, fee: fill.fee,
        timestamp: candle.timestamp, realizedPnl: fillRealizedPnl,
      };
      next = {
        ...next, cash, realizedPnl,
        totalFees: next.totalFees + fill.fee,
        positions, fills: [...next.fills, paperFill],
      };
      currentOrder.remainingQuantity = Math.max(0, currentOrder.remainingQuantity - fill.filledQuantity);
      currentOrder.status = currentOrder.remainingQuantity <= 1e-12 ? "open" : "partial";
    }
    next = { ...next, openOrders: currentOrders };
  }

  const remainingOrders = (next.openOrders ?? []).filter(order => order.remainingQuantity > 1e-12);
  return { ...next, openOrders: remainingOrders };
}

export function cancelPaperOrder(account: PaperAccount, orderId: string): PaperAccount {
  const orders = account.openOrders ?? [];
  if (!orders.some(order => order.id === orderId)) throw new Error("Open paper order not found");
  return { ...account, openOrders: orders.filter(order => order.id !== orderId) };
}
