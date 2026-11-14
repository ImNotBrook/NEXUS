import { describe, expect, it } from "vitest";
import { assessCandidateGates } from "./decision-gates";
import type { DecisionCandidate } from "./decision-engine";

const candidate: DecisionCandidate = {
  id: "gate-test-long", symbol: "BTCUSDT", side: "long", setupFamily: "donchian-breakout",
  timeframe: "1h", triggerConfirmed: true, expiresAt: 1_800_000_060_000,
  plan: { entryPrice: 100, stopPrice: 98, targetPrices: [106], quantity: 0.5 },
};
const policy = {
  instrumentCategory: "spot" as const,
  equity: 10_000, availableCapital: 10_000, existingExposure: 0, maxRiskPerTrade: 25,
  maxRiskFraction: 0.005, maxNotional: 2_000, maxExposure: 2_000,
  candleVolume: 100, minimumNetRewardRisk: 1.4,
  execution: {
    feeRate: 0.001, baseSlippageBps: 10, halfSpreadBps: 0,
    maxParticipationRate: 0.05, marketImpactBpsAtMaxParticipation: 0,
  },
};

describe("assessCandidateGates", () => {
  it("passes risk and net economics when costs and exposure remain inside policy", () => {
    const result = assessCandidateGates(candidate, policy);
    expect(result.riskGate.eligible).toBe(true);
    expect(result.economicsGate.eligible).toBe(true);
    expect(result.metrics.netRewardRisk).toBeGreaterThanOrEqual(1.4);
    expect(result.metrics.estimatedRoundTripCosts).toBeGreaterThan(0);
  });

  it("blocks a candidate whose stop risk exceeds the equity-based risk budget", () => {
    const result = assessCandidateGates({
      ...candidate,
      plan: { ...candidate.plan, quantity: 20 },
    }, policy);
    expect(result.riskGate.eligible).toBe(false);
    expect(result.riskGate.reasonCodes).toContain("MAX_RISK_PER_TRADE_EXCEEDED");
  });

  it("blocks notional and aggregate exposure breaches independently", () => {
    const result = assessCandidateGates(candidate, {
      ...policy, maxNotional: 40, existingExposure: 1_990,
    });
    expect(result.riskGate.reasonCodes).toContain("MAX_NOTIONAL_EXCEEDED");
    expect(result.riskGate.reasonCodes).toContain("MAX_EXPOSURE_EXCEEDED");
  });

  it("blocks a spot allocation that exceeds available paper cash", () => {
    const result = assessCandidateGates(candidate, { ...policy, availableCapital: 25 });
    expect(result.riskGate.eligible).toBe(false);
    expect(result.riskGate.reasonCodes).toContain("INSUFFICIENT_AVAILABLE_CAPITAL");
  });

  it("blocks orders that exceed the conservative candle participation cap", () => {
    const result = assessCandidateGates(candidate, { ...policy, candleVolume: 1 });
    expect(result.riskGate.eligible).toBe(false);
    expect(result.riskGate.reasonCodes).toContain("MAX_CANDLE_PARTICIPATION_EXCEEDED");
  });

  it("rejects negative net reward after round-trip execution costs", () => {
    const result = assessCandidateGates({
      ...candidate,
      plan: { ...candidate.plan, targetPrices: [100.1] },
    }, policy);
    expect(result.economicsGate.eligible).toBe(false);
    expect(result.economicsGate.reasonCodes).toContain("NET_REWARD_NOT_POSITIVE");
  });

  it("applies directionally correct adverse fills for short candidates", () => {
    const short: DecisionCandidate = {
      ...candidate, id: "gate-test-short", side: "short",
      plan: { entryPrice: 100, stopPrice: 102, targetPrices: [94], quantity: 0.5 },
    };
    const result = assessCandidateGates(short, { ...policy, instrumentCategory: "linear_perpetual" });
    expect(result.economicsGate.eligible).toBe(true);
    expect(result.metrics.netRewardRisk).toBeGreaterThan(1.4);
  });

  it("fails closed for invalid policy inputs", () => {
    expect(() => assessCandidateGates(candidate, { ...policy, equity: 0 })).toThrow();
  });
});
