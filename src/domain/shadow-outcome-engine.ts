import { validateCandles, type Candle } from "./candles";
import { resolveMarketFill, validateMarketExecutionConfig, type MarketExecutionConfig } from "./execution-model";

export interface ShadowEntryOrder {
  orderType: "market" | "limit";
  /** Decision-time reference used to validate the original plan. */
  referencePrice: number;
  limitPrice?: number;
  earliestEligibleAt: number;
  expiresAt: number;
  /** Required penetration beyond a limit price to reduce touch-only false fills. */
  penetrationBps: number;
}

export interface ShadowTradePlan {
  schemaVersion: 1;
  simulationVersion: string;
  decisionId: string;
  candidateId: string;
  symbol: string;
  instrumentCategory: "spot" | "linear_perpetual" | "inverse_perpetual";
  side: "long" | "short";
  decisionAt: number;
  entry: ShadowEntryOrder;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  horizonEnd: number;
  sameBarPolicy: "adverse_stop_first" | "ambiguous";
  executionModel: MarketExecutionConfig;
}

export type ShadowOutcomeStatus = "pending" | "expired" | "open" | "completed" | "ambiguous";
export type ShadowExitReason = "stop-loss" | "take-profit";

export interface ShadowFillEvent {
  eventType: "entry" | "exit";
  timestamp: number;
  orderType: "market" | "limit";
  side: "buy" | "sell";
  quantity: number;
  referencePrice: number;
  executionPrice: number;
  fee: number;
  reason?: ShadowExitReason;
}

export interface ShadowOutcome {
  schemaVersion: 1;
  simulationVersion: string;
  decisionId: string;
  candidateId: string;
  status: ShadowOutcomeStatus;
  entryOrderStatus: "pending" | "filled" | "expired" | "cancelled";
  entryTimestamp: number | null;
  entryFilledQuantity: number;
  entryRemainingQuantity: number;
  entryAveragePrice: number | null;
  entryFees: number;
  exitTimestamp: number | null;
  exitFilledQuantity: number;
  positionRemainingQuantity: number;
  exitAveragePrice: number | null;
  exitFees: number;
  totalFees: number;
  /** Realised net P&L on exited quantity only; open quantity is not marked as realised. */
  netPnl: number;
  mfeBps: number;
  maeBps: number;
  exitReason: ShadowExitReason | null;
  fillEvents: ShadowFillEvent[];
}

const EPSILON = 1e-12;

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateShadowTradePlan(plan: ShadowTradePlan): void {
  if (!plan || typeof plan !== "object") throw new TypeError("A shadow trade plan is required");
  if (plan.schemaVersion !== 1) throw new TypeError("Unsupported shadow plan schema version");
  for (const [name, value] of Object.entries({
    decisionId: plan.decisionId,
    candidateId: plan.candidateId,
    symbol: plan.symbol,
    simulationVersion: plan.simulationVersion,
  })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(name + " is required");
  }
  if (!/^[A-Z0-9]{3,30}$/.test(plan.symbol)) throw new TypeError("symbol must be normalized uppercase alphanumeric");
  if (plan.instrumentCategory !== "spot") {
    throw new TypeError("Shadow simulator v1 supports spot instruments only; derivatives require funding-aware costs");
  }
  if (plan.side !== "long" && plan.side !== "short") throw new TypeError("side must be long or short");
  if (![plan.decisionAt, plan.entry.earliestEligibleAt, plan.entry.expiresAt, plan.horizonEnd].every(validTime)) {
    throw new RangeError("Decision, entry and horizon times must be non-negative safe integers");
  }
  if (!(plan.decisionAt < plan.entry.earliestEligibleAt &&
        plan.entry.earliestEligibleAt <= plan.entry.expiresAt &&
        plan.entry.expiresAt <= plan.horizonEnd)) {
    throw new RangeError("Entry eligibility, expiry and outcome horizon must follow decision time");
  }
  if (plan.entry.orderType !== "market" && plan.entry.orderType !== "limit") {
    throw new TypeError("entry orderType must be market or limit");
  }
  if (!Number.isFinite(plan.entry.referencePrice) || plan.entry.referencePrice <= 0) {
    throw new RangeError("entry referencePrice must be positive");
  }
  if (plan.entry.orderType === "limit") {
    if (!Number.isFinite(plan.entry.limitPrice) || (plan.entry.limitPrice ?? 0) <= 0) {
      throw new RangeError("A positive limitPrice is required for a limit entry");
    }
  } else if (plan.entry.limitPrice !== undefined) {
    throw new TypeError("Market entries cannot include a limitPrice");
  }
  if (!Number.isFinite(plan.entry.penetrationBps) || plan.entry.penetrationBps <= 0 || plan.entry.penetrationBps >= 10_000) {
    throw new RangeError("penetrationBps must be in (0, 10000); target limit fills require price penetration");
  }
  if (!Number.isFinite(plan.quantity) || plan.quantity <= 0) throw new RangeError("quantity must be positive");
  if (!Number.isFinite(plan.stopPrice) || plan.stopPrice <= 0 ||
      !Number.isFinite(plan.targetPrice) || plan.targetPrice <= 0) {
    throw new RangeError("Stop and target prices must be positive");
  }
  const plannedEntryPrice = plan.entry.orderType === "limit"
    ? plan.entry.limitPrice!
    : plan.entry.referencePrice;
  if (plan.side === "long" &&
      !(plan.stopPrice < plannedEntryPrice && plan.targetPrice > plannedEntryPrice)) {
    throw new RangeError("Long plans require stop < planned entry < target");
  }
  if (plan.side === "short" &&
      !(plan.targetPrice < plannedEntryPrice && plan.stopPrice > plannedEntryPrice)) {
    throw new RangeError("Short plans require target < planned entry < stop");
  }
  if (plan.sameBarPolicy !== "adverse_stop_first" && plan.sameBarPolicy !== "ambiguous") {
    throw new TypeError("sameBarPolicy is invalid");
  }
  validateMarketExecutionConfig(plan.executionModel);
}

function limitEntryFill(
  plan: ShadowTradePlan,
  candle: Candle,
  requestedQuantity: number,
  availableVolume: number,
): { quantity: number; price: number; fee: number } | null {
  const limit = plan.entry.limitPrice!;
  const penetration = plan.entry.penetrationBps / 10_000;
  const penetrated = plan.side === "long"
    ? candle.low <= limit * (1 - penetration)
    : candle.high >= limit * (1 + penetration);
  if (!penetrated) return null;

  const capacity = Math.max(0, availableVolume) * plan.executionModel.maxParticipationRate;
  const quantity = Math.min(requestedQuantity, capacity);
  if (quantity <= EPSILON) return null;
  const price = plan.side === "long" ? Math.min(candle.open, limit) : Math.max(candle.open, limit);
  const fee = quantity * price * plan.executionModel.feeRate;
  return { quantity, price, fee };
}

function targetLimitFill(
  plan: ShadowTradePlan,
  candle: Candle,
  requestedQuantity: number,
  availableVolume: number,
): { quantity: number; price: number; fee: number } | null {
  const target = plan.targetPrice;
  const penetration = plan.entry.penetrationBps / 10_000;
  const penetrated = plan.side === "long"
    ? candle.open >= target || candle.high >= target * (1 + penetration)
    : candle.open <= target || candle.low <= target * (1 - penetration);
  if (!penetrated) return null;

  const capacity = Math.max(0, availableVolume) * plan.executionModel.maxParticipationRate;
  const quantity = Math.min(requestedQuantity, capacity);
  if (quantity <= EPSILON) return null;
  const price = plan.side === "long" ? Math.max(candle.open, target) : Math.min(candle.open, target);
  const fee = quantity * price * plan.executionModel.feeRate;
  return { quantity, price, fee };
}

function stopReference(plan: ShadowTradePlan, candle: Candle): number | null {
  if (plan.side === "long") {
    if (candle.open <= plan.stopPrice) return candle.open;
    if (candle.low <= plan.stopPrice) return plan.stopPrice;
    return null;
  }
  if (candle.open >= plan.stopPrice) return candle.open;
  if (candle.high >= plan.stopPrice) return plan.stopPrice;
  return null;
}

function targetReference(plan: ShadowTradePlan, candle: Candle): number | null {
  const penetration = plan.entry.penetrationBps / 10_000;
  if (plan.side === "long") {
    if (candle.open >= plan.targetPrice) return candle.open;
    if (candle.high >= plan.targetPrice * (1 + penetration)) return plan.targetPrice;
    return null;
  }
  if (candle.open <= plan.targetPrice) return candle.open;
  if (candle.low <= plan.targetPrice * (1 - penetration)) return plan.targetPrice;
  return null;
}

/**
 * Deterministic counterfactual simulator for spot plans. It never mutates a
 * paper account. Limit orders require penetration, market fills pay adverse
 * costs, and candle volume constrains every fill.
 */
export function simulateShadowOutcome(
  plan: ShadowTradePlan,
  inputCandles: readonly Candle[],
): ShadowOutcome {
  validateShadowTradePlan(plan);
  const candles = validateCandles(inputCandles);
  const outcome: ShadowOutcome = {
    schemaVersion: 1,
    simulationVersion: plan.simulationVersion,
    decisionId: plan.decisionId,
    candidateId: plan.candidateId,
    status: "pending",
    entryOrderStatus: "pending",
    entryTimestamp: null,
    entryFilledQuantity: 0,
    entryRemainingQuantity: plan.quantity,
    entryAveragePrice: null,
    entryFees: 0,
    exitTimestamp: null,
    exitFilledQuantity: 0,
    positionRemainingQuantity: 0,
    exitAveragePrice: null,
    exitFees: 0,
    totalFees: 0,
    netPnl: 0,
    mfeBps: 0,
    maeBps: 0,
    exitReason: null,
    fillEvents: [],
  };

  let pendingExitReason: ShadowExitReason | null = null;
  let highestPrice = Number.NEGATIVE_INFINITY;
  let lowestPrice = Number.POSITIVE_INFINITY;

  for (const candle of candles) {
    if (candle.timestamp <= plan.decisionAt || candle.timestamp > plan.horizonEnd) continue;
    let volumeUsed = 0;
    const hadPositionAtBarStart = outcome.positionRemainingQuantity > EPSILON;

    if (
      outcome.entryOrderStatus === "pending" &&
      candle.timestamp >= plan.entry.earliestEligibleAt &&
      candle.timestamp <= plan.entry.expiresAt &&
      outcome.entryRemainingQuantity > EPSILON
    ) {
      const availableVolume = Math.max(0, candle.volume - volumeUsed);
      let fill: { quantity: number; price: number; fee: number } | null = null;
      if (plan.entry.orderType === "market") {
        const execution = resolveMarketFill({
          side: plan.side === "long" ? "buy" : "sell",
          requestedQuantity: outcome.entryRemainingQuantity,
          referencePrice: candle.open,
          candleVolume: availableVolume,
        }, plan.executionModel);
        if (execution.filledQuantity > EPSILON) {
          fill = {
            quantity: execution.filledQuantity,
            price: execution.executionPrice,
            fee: execution.fee,
          };
        }
      } else {
        fill = limitEntryFill(plan, candle, outcome.entryRemainingQuantity, availableVolume);
      }

      if (fill) {
        volumeUsed += fill.quantity;
        const previousNotional = (outcome.entryAveragePrice ?? 0) * outcome.entryFilledQuantity;
        outcome.entryFilledQuantity += fill.quantity;
        outcome.entryAveragePrice = (previousNotional + fill.quantity * fill.price) / outcome.entryFilledQuantity;
        outcome.entryFees += fill.fee;
        outcome.entryTimestamp ??= candle.timestamp;
        outcome.entryRemainingQuantity = Math.max(0, plan.quantity - outcome.entryFilledQuantity);
        outcome.entryOrderStatus = outcome.entryRemainingQuantity <= EPSILON ? "filled" : "pending";
        outcome.positionRemainingQuantity += fill.quantity;
        outcome.fillEvents.push({
          eventType: "entry",
          timestamp: candle.timestamp,
          orderType: plan.entry.orderType,
          side: plan.side === "long" ? "buy" : "sell",
          quantity: fill.quantity,
          referencePrice: plan.entry.orderType === "market" ? candle.open : plan.entry.limitPrice!,
          executionPrice: fill.price,
          fee: fill.fee,
        });
      }
    }

    if (outcome.entryOrderStatus === "pending" && candle.timestamp >= plan.entry.expiresAt) {
      outcome.entryOrderStatus = "expired";
    }

    // Do not apply stops/targets on the entry candle: OHLC cannot establish the
    // order of an intrabar entry fill and a protective trigger.
    if (outcome.positionRemainingQuantity <= EPSILON ||
        (!hadPositionAtBarStart && outcome.entryTimestamp === candle.timestamp)) {
      continue;
    }

    highestPrice = Math.max(highestPrice, candle.high);
    lowestPrice = Math.min(lowestPrice, candle.low);
    const entryAverage = outcome.entryAveragePrice!;
    if (plan.side === "long") {
      outcome.mfeBps = Math.max(0, (highestPrice / entryAverage - 1) * 10_000);
      outcome.maeBps = Math.max(0, (entryAverage - lowestPrice) / entryAverage * 10_000);
    } else {
      outcome.mfeBps = Math.max(0, (entryAverage - lowestPrice) / entryAverage * 10_000);
      outcome.maeBps = Math.max(0, (highestPrice / entryAverage - 1) * 10_000);
    }

    const stop = stopReference(plan, candle);
    const target = targetReference(plan, candle);
    const stopGappedAtOpen = plan.side === "long"
      ? candle.open <= plan.stopPrice
      : candle.open >= plan.stopPrice;
    const targetGappedAtOpen = plan.side === "long"
      ? candle.open >= plan.targetPrice
      : candle.open <= plan.targetPrice;

    if (stopGappedAtOpen) {
      pendingExitReason = "stop-loss";
    } else if (targetGappedAtOpen && !pendingExitReason) {
      pendingExitReason = "take-profit";
    } else if (stop !== null && target !== null && !pendingExitReason) {
      if (plan.sameBarPolicy === "ambiguous") {
        outcome.entryOrderStatus = outcome.entryOrderStatus === "pending" ? "cancelled" : outcome.entryOrderStatus;
        outcome.status = "ambiguous";
        outcome.totalFees = outcome.entryFees + outcome.exitFees;
        return outcome;
      }
      pendingExitReason = "stop-loss";
    } else if (stop !== null) {
      pendingExitReason = "stop-loss";
    } else if (target !== null && !pendingExitReason) {
      pendingExitReason = "take-profit";
    }

    if (!pendingExitReason) continue;
    if (outcome.entryOrderStatus === "pending") outcome.entryOrderStatus = "cancelled";

    const requested = outcome.positionRemainingQuantity;
    const availableVolume = Math.max(0, candle.volume - volumeUsed);
    let exitFill: { quantity: number; price: number; fee: number } | null = null;
    let exitOrderType: "market" | "limit" = pendingExitReason === "stop-loss" ? "market" : "limit";
    let referencePrice = pendingExitReason === "stop-loss" ? stop ?? candle.open : target ?? plan.targetPrice;

    if (pendingExitReason === "stop-loss") {
      const execution = resolveMarketFill({
        side: plan.side === "long" ? "sell" : "buy",
        requestedQuantity: requested,
        referencePrice,
        candleVolume: availableVolume,
      }, plan.executionModel);
      if (execution.filledQuantity > EPSILON) {
        exitFill = { quantity: execution.filledQuantity, price: execution.executionPrice, fee: execution.fee };
      }
    } else {
      exitFill = targetLimitFill(plan, candle, requested, availableVolume);
      referencePrice = plan.targetPrice;
    }

    if (!exitFill) continue;
    volumeUsed += exitFill.quantity;
    const previousExitNotional = (outcome.exitAveragePrice ?? 0) * outcome.exitFilledQuantity;
    outcome.exitFilledQuantity += exitFill.quantity;
    outcome.exitAveragePrice = (previousExitNotional + exitFill.quantity * exitFill.price) / outcome.exitFilledQuantity;
    outcome.exitFees += exitFill.fee;
    outcome.exitTimestamp = candle.timestamp;
    outcome.exitReason = pendingExitReason;
    const entryFeeAllocated = outcome.entryFees * (exitFill.quantity / outcome.entryFilledQuantity);
    const grossPnl = plan.side === "long"
      ? (exitFill.price - entryAverage) * exitFill.quantity
      : (entryAverage - exitFill.price) * exitFill.quantity;
    outcome.netPnl += grossPnl - entryFeeAllocated - exitFill.fee;
    outcome.positionRemainingQuantity = Math.max(0, outcome.positionRemainingQuantity - exitFill.quantity);
    outcome.fillEvents.push({
      eventType: "exit",
      timestamp: candle.timestamp,
      orderType: exitOrderType,
      side: plan.side === "long" ? "sell" : "buy",
      quantity: exitFill.quantity,
      referencePrice,
      executionPrice: exitFill.price,
      fee: exitFill.fee,
      reason: pendingExitReason,
    });

    if (outcome.positionRemainingQuantity <= EPSILON) {
      outcome.positionRemainingQuantity = 0;
      if (outcome.entryOrderStatus === "pending") {
        outcome.entryOrderStatus = "cancelled";
      }
      outcome.status = "completed";
      break;
    }
  }

  if (outcome.entryOrderStatus === "pending" &&
      candles.some((candle) => candle.timestamp >= plan.entry.expiresAt && candle.timestamp <= plan.horizonEnd)) {
    outcome.entryOrderStatus = "expired";
  }
  if (outcome.entryFilledQuantity <= EPSILON) {
    outcome.status = outcome.entryOrderStatus === "expired" ? "expired" : "pending";
  } else if (outcome.status !== "ambiguous" && outcome.status !== "completed") {
    outcome.status = "open";
  }
  outcome.totalFees = outcome.entryFees + outcome.exitFees;
  return outcome;
}
