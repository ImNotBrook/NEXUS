export type MarketOrderSide = "buy" | "sell";
export type MarketFillStatus = "filled" | "partial" | "unfilled";

export interface MarketExecutionConfig {
  /** Proportional fee charged only on executed notional. */
  feeRate: number;
  /** Adverse baseline slippage in basis points, applied to both sides. */
  baseSlippageBps: number;
  /** Half of the quoted bid/ask spread in basis points. */
  halfSpreadBps: number;
  /** Maximum fraction of one candle's base-asset volume an order may consume. */
  maxParticipationRate: number;
  /** Linear market-impact estimate at maxParticipationRate, in basis points. */
  marketImpactBpsAtMaxParticipation: number;
}

export interface MarketExecutionRequest {
  side: MarketOrderSide;
  requestedQuantity: number;
  referencePrice: number;
  /** Candle volume in base-asset units; must be non-negative. */
  candleVolume: number;
}

export interface MarketExecutionResult {
  side: MarketOrderSide;
  status: MarketFillStatus;
  requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  referencePrice: number;
  executionPrice: number;
  notional: number;
  fee: number;
  participationRate: number;
  baseSlippageBps: number;
  halfSpreadBps: number;
  impactBps: number;
  totalAdverseBps: number;
}

export function validateMarketExecutionConfig(config: MarketExecutionConfig): void {
  if (!Number.isFinite(config.feeRate) || config.feeRate < 0 || config.feeRate >= 1) {
    throw new RangeError("feeRate must be in [0, 1)");
  }
  for (const [name, value] of Object.entries({
    baseSlippageBps: config.baseSlippageBps,
    halfSpreadBps: config.halfSpreadBps,
    marketImpactBpsAtMaxParticipation: config.marketImpactBpsAtMaxParticipation,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative`);
  }
  if (!Number.isFinite(config.maxParticipationRate) ||
      config.maxParticipationRate <= 0 || config.maxParticipationRate > 1) {
    throw new RangeError("maxParticipationRate must be in (0, 1]");
  }
  const maximumAdverseBps = config.baseSlippageBps + config.halfSpreadBps +
    config.marketImpactBpsAtMaxParticipation;
  if (maximumAdverseBps >= 10_000) {
    throw new RangeError("total adverse execution cost must be less than 10000 bps");
  }
}

export function resolveMarketFill(
  request: MarketExecutionRequest,
  config: MarketExecutionConfig,
): MarketExecutionResult {
  validateMarketExecutionConfig(config);
  if (request.side !== "buy" && request.side !== "sell") {
    throw new TypeError("side must be buy or sell");
  }
  if (!Number.isFinite(request.requestedQuantity) || request.requestedQuantity <= 0) {
    throw new RangeError("requestedQuantity must be positive");
  }
  if (!Number.isFinite(request.referencePrice) || request.referencePrice <= 0) {
    throw new RangeError("referencePrice must be positive");
  }
  if (!Number.isFinite(request.candleVolume) || request.candleVolume < 0) {
    throw new RangeError("candleVolume must be non-negative");
  }

  const capacity = request.candleVolume * config.maxParticipationRate;
  const filledQuantity = Math.min(request.requestedQuantity, capacity);
  const remainingQuantity = Math.max(0, request.requestedQuantity - filledQuantity);
  const participationRate = request.candleVolume > 0
    ? filledQuantity / request.candleVolume
    : 0;
  const impactBps = config.maxParticipationRate > 0
    ? config.marketImpactBpsAtMaxParticipation * (participationRate / config.maxParticipationRate)
    : 0;
  const totalAdverseBps = config.baseSlippageBps + config.halfSpreadBps + impactBps;
  const direction = request.side === "buy" ? 1 : -1;
  const executionPrice = filledQuantity > 0
    ? request.referencePrice * (1 + direction * totalAdverseBps / 10_000)
    : request.referencePrice;
  const notional = filledQuantity * executionPrice;
  const fee = notional * config.feeRate;
  const status: MarketFillStatus = filledQuantity === 0
    ? "unfilled"
    : remainingQuantity > 0
      ? "partial"
      : "filled";

  return {
    side: request.side,
    status,
    requestedQuantity: request.requestedQuantity,
    filledQuantity,
    remainingQuantity,
    referencePrice: request.referencePrice,
    executionPrice,
    notional,
    fee,
    participationRate,
    baseSlippageBps: config.baseSlippageBps,
    halfSpreadBps: config.halfSpreadBps,
    impactBps,
    totalAdverseBps: filledQuantity > 0 ? totalAdverseBps : 0,
  };
}
