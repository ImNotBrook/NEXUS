import { describe, expect, it } from "vitest";
import { buildShadowTradePlan } from "./shadow-plan-builder";
import type { DecisionJournalRecord } from "./decision-journal";

const decision = (overrides: Partial<DecisionJournalRecord> = {}): DecisionJournalRecord => ({
  schemaVersion: 1,
  decisionId: "decision-1",
  decisionAt: 1_800_000_000_000,
  clockSource: "test-clock",
  symbol: "BTCUSDT",
  timeframe: "1h",
  status: "ENTER",
  reasonCodes: [],
  candidate: {
    id: "candidate-1", symbol: "BTCUSDT", side: "long",
    setupFamily: "donchian-breakout", timeframe: "1h",
    triggerConfirmed: true, expiresAt: 1_800_007_200_000,
    plan: { entryPrice: 100_000, stopPrice: 99_000, targetPrices: [102_000], quantity: 0.01 },
  },
  marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "a".repeat(64) }],
  evidence: [],
  result: {
    status: "ENTER", reasonCodes: [], supportingFamilies: [], contradictingFamilies: [],
    supportingEvidenceIds: [], contradictingEvidenceIds: [], invalidEvidence: [],
    supportScore: 0, contradictionScore: 0, coverageScore: 0, uncertaintyScore: 0,
    riskEligible: true,
  },
  thesis: { bullCase: ["breakout"], bearCase: ["failure"], alternatives: [], invalidation: ["stop"] },
  versions: { engine: "engine-1", score: "score-1", strategy: "donchian-breakout@1.0.0", riskPolicy: "paper-1" },
  ...overrides,
});

describe("buildShadowTradePlan", () => {
  it("freezes an ENTER candidate into a causal spot plan with a future entry and fixed horizon", () => {
    const result = buildShadowTradePlan(decision());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.decisionId).toBe("decision-1");
    expect(result.plan.candidateId).toBe("candidate-1");
    expect(result.plan.entry.orderType).toBe("market");
    expect(result.plan.entry.earliestEligibleAt).toBeGreaterThan(result.plan.decisionAt);
    expect(result.plan.entry.expiresAt).toBe(decision().candidate!.expiresAt);
    expect(result.plan.horizonEnd).toBe(decision().decisionAt + 24 * 60 * 60 * 1000 - 1);
    expect(result.plan.executionModel.feeRate).toBe(0.001);
  });

  it("allows a triggered REJECT candidate to be evaluated as a separately labelled shadow opportunity", () => {
    const result = buildShadowTradePlan(decision({ status: "REJECT", result: { ...decision().result, status: "REJECT", riskEligible: false } }));
    expect(result.status).toBe("ready");
  });

  it("does not invent a candidate or plan for NO_SETUP", () => {
    const base = decision();
    const result = buildShadowTradePlan({
      ...base, status: "NO_SETUP", candidate: null,
      result: { ...base.result, status: "NO_SETUP" },
    });
    expect(result).toMatchObject({ status: "not_simulatable", reasonCode: "NO_CANDIDATE" });
  });

  it("refuses an untriggered WAIT candidate without a predeclared limit trigger", () => {
    const base = decision();
    const result = buildShadowTradePlan({
      ...base, status: "WAIT",
      candidate: { ...base.candidate!, triggerConfirmed: false },
      result: { ...base.result, status: "WAIT" },
    });
    expect(result).toMatchObject({ status: "not_simulatable", reasonCode: "NO_PREDECLARED_ENTRY_TRIGGER" });
  });

  it("refuses unsupported spot shorts and invalid parent/candidate scope", () => {
    const base = decision();
    expect(buildShadowTradePlan({
      ...base, candidate: { ...base.candidate!, side: "short" },
    })).toMatchObject({ status: "not_simulatable", reasonCode: "UNSUPPORTED_SPOT_SHORT" });
    expect(buildShadowTradePlan({ ...base, symbol: "ETHUSDT" }))
      .toMatchObject({ status: "not_simulatable", reasonCode: "DECISION_CANDIDATE_MISMATCH" });
  });

  it("does not register a plan when the decision itself was data-blocked", () => {
    const base = decision();
    expect(buildShadowTradePlan({
      ...base, status: "WAIT",
      reasonCodes: ["MARKET_DATA_NOT_READY"],
      result: { ...base.result, status: "WAIT" },
    })).toMatchObject({ status: "not_simulatable", reasonCode: "DECISION_DATA_NOT_READY" });
  });
});
