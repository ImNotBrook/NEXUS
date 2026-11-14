import type { DecisionCandidate, DecisionGate } from "./decision-engine";
import {
  resolveMarketFill,
  validateMarketExecutionConfig,
  type MarketExecutionConfig,
} from "./execution-model";

export interface CandidateGatePolicy {
  instrumentCategory: "spot" | "linear_perpetual" | "inverse_perpetual";
  equity: number;
  availableCapital: number;
  existingExposure: number;
  maxRiskPerTrade: number;
  maxRiskFraction: number;
  maxNotional: number;
  maxExposure: number;
  candleVolume: number;
  minimumNetRewardRisk: number;
  execution: MarketExecutionConfig;
}

export interface CandidateGateMetrics {
  grossRisk: number;
  notional: number;
  candleParticipationRate: number;
  estimatedRoundTripCosts: number;
  netRewardAtTarget: number;
  netRiskAtStop: number;
  netRewardRisk: number;
}

export interface CandidateGateAssessment {
  riskGate: DecisionGate;
  economicsGate: DecisionGate;
  metrics: CandidateGateMetrics;
}

function validatePolicy(policy: CandidateGatePolicy): void {
  if (!policy || typeof policy !== "object") throw new TypeError("Candidate gate policy is required");
  if (!["spot", "linear_perpetual", "inverse_perpetual"].includes(policy.instrumentCategory)) {
    throw new TypeError("Instrument category is invalid");
  }
  for (const [name, value] of Object.entries({
    equity: policy.equity,
    availableCapital: policy.availableCapital,
    maxRiskPerTrade: policy.maxRiskPerTrade,
    maxRiskFraction: policy.maxRiskFraction,
    maxNotional: policy.maxNotional,
    maxExposure: policy.maxExposure,
    candleVolume: policy.candleVolume,
    minimumNetRewardRisk: policy.minimumNetRewardRisk,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + " must be finite and non-negative");
  }
  if (policy.equity <= 0 || policy.availableCapital < 0 || policy.maxRiskPerTrade <= 0 ||
      policy.maxRiskFraction >= 1 || policy.maxNotional <= 0 || policy.maxExposure <= 0 ||
      policy.minimumNetRewardRisk <= 0) {
    throw new RangeError("Equity, risk limits, exposure limits and minimum net reward/risk must be positive");
  }
  if (!Number.isFinite(policy.existingExposure) || policy.existingExposure < 0) {
    throw new RangeError("existingExposure must be finite and non-negative");
  }
  validateMarketExecutionConfig(policy.execution);
}

function fill(
  side: "buy" | "sell",
  quantity: number,
  referencePrice: number,
  candleVolume: number,
  execution: MarketExecutionConfig,
) {
  return resolveMarketFill({ side, requestedQuantity: quantity, referencePrice, candleVolume }, execution);
}

/**
 * Applies independent hard risk limits and execution-cost-aware trade economics.
 * Diagnostic scores are not used to override either gate.
 */
export function assessCandidateGates(
  candidate: DecisionCandidate,
  policy: CandidateGatePolicy,
): CandidateGateAssessment {
  validatePolicy(policy);
  if (!candidate || typeof candidate !== "object" || !candidate.plan) {
    throw new TypeError("A candidate with a trade plan is required");
  }
  const { entryPrice, stopPrice, targetPrices, quantity } = candidate.plan;
  if (![entryPrice, stopPrice, quantity].every((value) => Number.isFinite(value) && value > 0) ||
      !Array.isArray(targetPrices) || targetPrices.length === 0 ||
      targetPrices.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Candidate trade plan contains invalid prices or quantity");
  }

  const grossRisk = Math.abs(entryPrice - stopPrice) * quantity;
  const notional = entryPrice * quantity;
  const candleParticipationRate = policy.candleVolume > 0 ? quantity / policy.candleVolume : Infinity;
  const maximumRisk = Math.min(policy.maxRiskPerTrade, policy.equity * policy.maxRiskFraction);
  const riskReasons: string[] = [];
  if (grossRisk > maximumRisk + 1e-9) riskReasons.push("MAX_RISK_PER_TRADE_EXCEEDED");
  if (notional > policy.maxNotional + 1e-9) riskReasons.push("MAX_NOTIONAL_EXCEEDED");
  if (notional > policy.availableCapital + 1e-9) riskReasons.push("INSUFFICIENT_AVAILABLE_CAPITAL");
  if (policy.existingExposure + notional > policy.maxExposure + 1e-9) {
    riskReasons.push("MAX_EXPOSURE_EXCEEDED");
  }
  if (policy.candleVolume <= 0 || candleParticipationRate > policy.execution.maxParticipationRate + 1e-12) {
    riskReasons.push("MAX_CANDLE_PARTICIPATION_EXCEEDED");
  }
  if (candidate.side === "short" && policy.instrumentCategory === "spot") {
    riskReasons.push("SHORT_NOT_SUPPORTED_FOR_SPOT");
  }

  const exitSide = candidate.side === "long" ? "sell" : "buy";
  const entrySide = candidate.side === "long" ? "buy" : "sell";
  const targetPrice = candidate.side === "long"
    ? Math.max(...targetPrices)
    : Math.min(...targetPrices);
  const entryFill = fill(entrySide, quantity, entryPrice, policy.candleVolume, policy.execution);
  const targetFill = fill(exitSide, quantity, targetPrice, policy.candleVolume, policy.execution);
  const stopFill = fill(exitSide, quantity, stopPrice, policy.candleVolume, policy.execution);
  const entryCosts = entryFill.fee + Math.abs(entryFill.executionPrice - entryPrice) * entryFill.filledQuantity;
  const targetCosts = targetFill.fee + Math.abs(targetFill.executionPrice - targetPrice) * targetFill.filledQuantity;
  const stopCosts = stopFill.fee + Math.abs(stopFill.executionPrice - stopPrice) * stopFill.filledQuantity;
  const grossReward = candidate.side === "long"
    ? (targetPrice - entryPrice) * quantity
    : (entryPrice - targetPrice) * quantity;
  const netRewardAtTarget = grossReward - entryCosts - targetCosts;
  const netRiskAtStop = grossRisk + entryCosts + stopCosts;
  const netRewardRisk = netRiskAtStop > 0 ? netRewardAtTarget / netRiskAtStop : 0;
  const economicsReasons: string[] = [];
  if ([entryFill, targetFill, stopFill].some((item) => item.status !== "filled")) {
    economicsReasons.push("EXPECTED_ORDER_NOT_FULLY_FILLABLE");
  }
  if (netRewardAtTarget <= 0) economicsReasons.push("NET_REWARD_NOT_POSITIVE");
  if (netRewardRisk < policy.minimumNetRewardRisk) {
    economicsReasons.push("NET_REWARD_RISK_BELOW_MINIMUM");
  }

  return {
    riskGate: { eligible: riskReasons.length === 0, reasonCodes: riskReasons },
    economicsGate: { eligible: economicsReasons.length === 0, reasonCodes: economicsReasons },
    metrics: {
      grossRisk,
      notional,
      candleParticipationRate,
      estimatedRoundTripCosts: entryCosts + targetCosts,
      netRewardAtTarget,
      netRiskAtStop,
      netRewardRisk,
    },
  };
}
