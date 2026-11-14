import { describe, expect, it } from "vitest";
import { evaluateDecision, type DecisionInput, type EvidenceItem } from "./decision-engine";

const now = 1_800_000_000_000;

const candidate = {
  id: "candidate-1",
  symbol: "BTCUSDT",
  side: "long" as const,
  setupFamily: "structure-retest",
  timeframe: "15m",
  triggerConfirmed: true,
  expiresAt: now + 60_000,
  plan: {
    entryPrice: 100,
    stopPrice: 98,
    targetPrices: [104],
    quantity: 0.5,
  },
};

const evidence = (
  id: string,
  family: EvidenceItem["family"],
  polarity: EvidenceItem["polarity"] = "supports",
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem => ({
  id,
  family,
  claim: `${id} observed`,
  polarity,
  strength: 0.8,
  quality: 0.9,
  symbol: "BTCUSDT",
  timeframe: "1h",
  availableAt: now - 60_000,
  observedAt: now - 30_000,
  sourceRef: `source:${id}`,
  calculationVersion: "1.0.0",
  ...overrides,
});

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    evaluationTime: now,
    candidate,
    marketDataStatus: "pass",
    riskGate: { eligible: true, reasonCodes: [] },
    economicsGate: { eligible: true, reasonCodes: [] },
    minimumSupportingFamilies: 2,
    evidence: [
      evidence("structure-1", "market_structure"),
      evidence("momentum-1", "momentum_volume"),
    ],
    ...overrides,
  };
}

describe("evaluateDecision", () => {
  it("records NO_SETUP when no candidate exists", () => {
    const result = evaluateDecision(input({ candidate: null }));
    expect(result.status).toBe("NO_SETUP");
    expect(result.reasonCodes).toContain("NO_CANDIDATE");
  });

  it("never allows strong evidence to override a failed risk gate", () => {
    const result = evaluateDecision(input({
      riskGate: { eligible: false, reasonCodes: ["MAX_DRAWDOWN_REACHED"] },
    }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("RISK_GATE_BLOCKED");
    expect(result.reasonCodes).toContain("MAX_DRAWDOWN_REACHED");
  });

  it("blocks entry when market data quality is degraded", () => {
    const result = evaluateDecision(input({ marketDataStatus: "fail" }));
    expect(result.status).toBe("WAIT");
    expect(result.reasonCodes).toContain("MARKET_DATA_NOT_READY");
  });

  it("does not allow evidence published after decision time to qualify", () => {
    const result = evaluateDecision(input({
      evidence: [
        evidence("future-structure", "market_structure", "supports", {
          availableAt: now + 1,
          observedAt: now + 1,
        }),
        evidence("momentum-1", "momentum_volume"),
      ],
    }));
    expect(result.status).toBe("WAIT");
    expect(result.reasonCodes).toContain("INSUFFICIENT_INDEPENDENT_SUPPORT");
    expect(result.invalidEvidence).toEqual([
      expect.objectContaining({ evidenceId: "future-structure", reason: "FUTURE_EVIDENCE" }),
    ]);
  });

  it("does not count multiple correlated indicators in one family as independent families", () => {
    const result = evaluateDecision(input({
      evidence: [
        evidence("rsi", "momentum_volume", "supports", { correlationKey: "momentum-cluster" }),
        evidence("macd", "momentum_volume", "supports", { correlationKey: "momentum-cluster" }),
        evidence("cci", "momentum_volume", "supports", { correlationKey: "momentum-cluster" }),
      ],
    }));
    expect(result.status).toBe("WAIT");
    expect(result.supportingFamilies).toEqual(["momentum_volume"]);
  });

  it("returns ENTER only when independent support, trigger, data, economics and risk gates pass", () => {
    const result = evaluateDecision(input());
    expect(result.status).toBe("ENTER");
    expect(result.supportingFamilies.sort()).toEqual(["market_structure", "momentum_volume"].sort());
  });

  it("preserves contradictory evidence rather than hiding it in a net score", () => {
    const result = evaluateDecision(input({
      evidence: [
        evidence("structure", "market_structure"),
        evidence("momentum", "momentum_volume"),
        evidence("funding", "derivatives_positioning", "contradicts"),
      ],
    }));
    expect(result.status).toBe("ENTER");
    expect(result.contradictingFamilies).toContain("derivatives_positioning");
    expect(result).not.toHaveProperty("winProbability");
  });

  it("waits for an unconfirmed trigger", () => {
    const result = evaluateDecision(input({
      candidate: { ...candidate, triggerConfirmed: false },
    }));
    expect(result.status).toBe("WAIT");
    expect(result.reasonCodes).toContain("TRIGGER_NOT_CONFIRMED");
  });

  it("rejects an expired candidate", () => {
    const result = evaluateDecision(input({
      candidate: { ...candidate, expiresAt: now },
    }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("CANDIDATE_EXPIRED");
  });

  it("rejects a long plan whose stop is not below entry", () => {
    const result = evaluateDecision(input({
      candidate: { ...candidate, plan: { ...candidate.plan, stopPrice: 101 } },
    }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("INVALID_TRADE_PLAN");
  });

  it("rejects an economically ineligible candidate", () => {
    const result = evaluateDecision(input({
      economicsGate: { eligible: false, reasonCodes: ["NET_EXPECTANCY_NEGATIVE"] },
    }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("NET_EXPECTANCY_NEGATIVE");
  });

  it("rejects malformed or untraceable evidence instead of scoring it", () => {
    const result = evaluateDecision(input({
      evidence: [
        evidence("bad-quality", "market_structure", "supports", { quality: 2 }),
        evidence("no-source", "momentum_volume", "supports", { sourceRef: "" }),
      ],
    }));
    expect(result.status).toBe("WAIT");
    expect(result.invalidEvidence).toHaveLength(2);
    expect(result.reasonCodes).toContain("INSUFFICIENT_INDEPENDENT_SUPPORT");
  });

  it("rejects candidates with missing identity or scope fields", () => {
    const result = evaluateDecision(input({
      candidate: { ...candidate, id: " ", symbol: " ", setupFamily: "", timeframe: "" },
    }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("INVALID_CANDIDATE");
  });

  it("rejects invalid minimum independent-family thresholds", () => {
    const result = evaluateDecision(input({ minimumSupportingFamilies: Number.NaN }));
    expect(result.status).toBe("REJECT");
    expect(result.reasonCodes).toContain("INVALID_DECISION_CONFIGURATION");
  });

  it("does not count cross-family evidence sharing one dependency key as independent", () => {
    const result = evaluateDecision(input({
      evidence: [
        evidence("structure-derived", "market_structure", "supports", { correlationKey: "same-underlying-event" }),
        evidence("timeframe-derived", "timeframe_alignment", "supports", { correlationKey: "same-underlying-event" }),
      ],
    }));
    expect(result.status).toBe("WAIT");
    expect(result.supportingFamilies).toHaveLength(1);
    expect(result.reasonCodes).toContain("INSUFFICIENT_INDEPENDENT_SUPPORT");
  });

  it("produces the same independent-family result regardless of evidence ordering", () => {
    const items = [
      evidence("structure-derived", "market_structure", "supports", { correlationKey: "same-underlying-event" }),
      evidence("timeframe-derived", "timeframe_alignment", "supports", { correlationKey: "same-underlying-event" }),
      evidence("momentum", "momentum_volume"),
    ];
    const forward = evaluateDecision(input({ evidence: items }));
    const reverse = evaluateDecision(input({ evidence: [...items].reverse() }));
    expect(reverse.supportingFamilies).toEqual(forward.supportingFamilies);
    expect(reverse.status).toBe(forward.status);
  });

});