import { describe, expect, it } from "vitest";
import { evaluateLearningCohorts, type LearningObservation } from "./learning-engine";
import type { DecisionJournalRecord } from "./decision-journal";
import type { ShadowOutcome, ShadowTradePlan } from "./shadow-outcome-engine";

function makePlan(overrides: Partial<ShadowTradePlan> = {}): ShadowTradePlan {
  return {
    schemaVersion: 1,
    simulationVersion: "shadow-v1",
    decisionId: "decision-1",
    candidateId: "candidate-1",
    symbol: "BTCUSDT",
    timeframe: "4h",
    instrumentCategory: "spot",
    volumeUnit: "base",
    side: "long",
    decisionAt: 1_000,
    entry: {
      orderType: "market",
      referencePrice: 100,
      earliestEligibleAt: 2_000,
      expiresAt: 5_000,
      penetrationBps: 5,
    },
    stopPrice: 95,
    targetPrice: 110,
    quantity: 1,
    horizonEnd: 10_000,
    sameBarPolicy: "adverse_stop_first",
    executionModel: {
      feeRate: 0.001,
      baseSlippageBps: 2,
      halfSpreadBps: 3,
      maxParticipationRate: 0.1,
      marketImpactBpsAtMaxParticipation: 10,
    },
    ...overrides,
  };
}

function makeDecision(
  plan: ShadowTradePlan,
  status: "ENTER" | "WAIT" | "REJECT" | "NO_SETUP" = "REJECT",
): DecisionJournalRecord {
  const candidate = status === "NO_SETUP" ? null : {
    id: plan.candidateId,
    symbol: plan.symbol,
    side: plan.side,
    setupFamily: "structure-retest",
    timeframe: plan.timeframe,
    triggerConfirmed: true,
    expiresAt: plan.entry.expiresAt,
    plan: {
      entryPrice: plan.entry.referencePrice,
      stopPrice: plan.stopPrice,
      targetPrices: [plan.targetPrice],
      quantity: plan.quantity,
    },
  };
  return {
    schemaVersion: 1,
    decisionId: plan.decisionId,
    decisionAt: plan.decisionAt,
    clockSource: "test-clock",
    symbol: plan.symbol,
    timeframe: plan.timeframe,
    status,
    reasonCodes: [status + "_TEST"],
    candidate,
    marketSnapshotRefs: [{ snapshotId: "snapshot-1", contentHash: "sha256:decision" }],
    evidence: [],
    result: {
      status,
      reasonCodes: [status + "_TEST"],
      supportingFamilies: [],
      contradictingFamilies: [],
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      invalidEvidence: [],
      supportScore: 0,
      contradictionScore: 0,
      coverageScore: 0,
      uncertaintyScore: 1,
      riskEligible: status !== "REJECT",
    },
    thesis: { bullCase: ["Bull"], bearCase: ["Bear"], alternatives: [], invalidation: ["Stop"] },
    versions: { engine: "ede-1", score: "score-1", strategy: "strategy-1", riskPolicy: "risk-1" },
  };
}

function makeOutcome(
  plan: ShadowTradePlan,
  status: ShadowOutcome["status"] = "completed",
  overrides: Partial<ShadowOutcome> = {},
): ShadowOutcome {
  const completed = status === "completed";
  return {
    schemaVersion: 1,
    simulationVersion: plan.simulationVersion,
    decisionId: plan.decisionId,
    candidateId: plan.candidateId,
    status,
    horizonReached: true,
    invalidationReason: null,
    pendingExitReason: null,
    entryOrderStatus: completed ? "filled" : "expired",
    entryTimestamp: completed ? 2_000 : null,
    entryFilledQuantity: completed ? 1 : 0,
    entryRemainingQuantity: completed ? 0 : 1,
    entryAveragePrice: completed ? 100 : null,
    entryFees: completed ? 0.1 : 0,
    exitTimestamp: completed ? 5_000 : null,
    exitFilledQuantity: completed ? 1 : 0,
    positionRemainingQuantity: 0,
    exitAveragePrice: completed ? 110 : null,
    exitFees: completed ? 0.11 : 0,
    totalFees: completed ? 0.21 : 0,
    netPnl: completed ? 9.79 : 0,
    mfeBps: completed ? 1_100 : 0,
    maeBps: completed ? -200 : 0,
    exitReason: completed ? "take-profit" : null,
    fillEvents: [],
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<LearningObservation> = {},
): LearningObservation {
  const plan = overrides.plan ?? makePlan();
  const decision = overrides.decision ?? makeDecision(plan);
  const outcome = overrides.outcome ?? makeOutcome(plan);
  return {
    observationId: "shadow-outcome:hash-1",
    recordedAt: 11_000,
    observedThrough: 10_000,
    dataQuality: "pass",
    decision,
    plan,
    outcome,
    ...overrides,
  };
}

describe("evaluateLearningCohorts", () => {
  it("includes only mature, quality-passed completed outcomes in economic metrics", () => {
    const report = evaluateLearningCohorts([makeObservation()]);
    expect(report.eligibleObservations).toBe(1);
    expect(report.excluded).toHaveLength(0);
    expect(report.cohorts).toHaveLength(1);
    expect(report.cohorts[0]).toMatchObject({
      symbol: "BTCUSDT",
      timeframe: "4h",
      decisionStatus: "REJECT",
      setupFamily: "structure-retest",
      maturedCandidates: 1,
      completedTrades: 1,
      noFillCandidates: 0,
      meanNetR: 1.958,
      medianNetR: 1.958,
      winRate: 1,
      meanMfeBps: 1_100,
      meanMaeBps: -200,
    });
  });

  it("counts matured unfilled candidates without treating them as zero-R trades", () => {
    const plan = makePlan();
    const report = evaluateLearningCohorts([
      makeObservation({ outcome: makeOutcome(plan, "expired") }),
    ]);
    expect(report.cohorts[0]).toMatchObject({
      maturedCandidates: 1,
      completedTrades: 0,
      noFillCandidates: 1,
      meanNetR: null,
      winRate: null,
    });
  });

  it("keeps ENTER, WAIT and REJECT decision cohorts separate", () => {
    const enterPlan = makePlan({ decisionId: "d-enter", candidateId: "c-enter" });
    const waitPlan = makePlan({ decisionId: "d-wait", candidateId: "c-wait" });
    const rejectPlan = makePlan({ decisionId: "d-reject", candidateId: "c-reject" });
    const report = evaluateLearningCohorts([
      makeObservation({ plan: enterPlan, decision: makeDecision(enterPlan, "ENTER"), outcome: makeOutcome(enterPlan) }),
      makeObservation({ plan: waitPlan, decision: makeDecision(waitPlan, "WAIT"), outcome: makeOutcome(waitPlan, "expired") }),
      makeObservation({ plan: rejectPlan, decision: makeDecision(rejectPlan, "REJECT"), outcome: makeOutcome(rejectPlan) }),
    ]);
    expect(report.cohorts.map((cohort) => cohort.decisionStatus).sort()).toEqual(["ENTER", "REJECT", "WAIT"]);
    expect(report.eligibleObservations).toBe(3);
  });

  it("excludes outcomes whose horizon is not reached or whose position remains open", () => {
    const pendingPlan = makePlan({ decisionId: "pending", candidateId: "pending-candidate" });
    const openPlan = makePlan({ decisionId: "open", candidateId: "open-candidate" });
    const report = evaluateLearningCohorts([
      makeObservation({
        plan: pendingPlan,
        decision: makeDecision(pendingPlan),
        outcome: makeOutcome(pendingPlan, "pending", { horizonReached: false }),
        observedThrough: 9_000,
      }),
      makeObservation({
        plan: openPlan,
        decision: makeDecision(openPlan),
        outcome: makeOutcome(openPlan, "open", {
          entryOrderStatus: "filled",
          entryFilledQuantity: 1,
          positionRemainingQuantity: 1,
          entryAveragePrice: 100,
          exitFilledQuantity: 0,
          exitAveragePrice: null,
        }),
      }),
    ]);
    expect(report.eligibleObservations).toBe(0);
    expect(report.excluded.map((item) => item.reason)).toContain("horizon_not_reached");
    expect(report.excluded.map((item) => item.reason)).toContain("unresolved_position");
  });

  it("excludes ambiguous outcomes and degraded or failed market-data quality", () => {
    const ambiguousPlan = makePlan({ decisionId: "ambiguous", candidateId: "ambiguous-candidate" });
    const degradedPlan = makePlan({ decisionId: "degraded", candidateId: "degraded-candidate" });
    const failedPlan = makePlan({ decisionId: "failed", candidateId: "failed-candidate" });
    const report = evaluateLearningCohorts([
      makeObservation({
        plan: ambiguousPlan,
        decision: makeDecision(ambiguousPlan),
        outcome: makeOutcome(ambiguousPlan, "ambiguous"),
      }),
      makeObservation({
        plan: degradedPlan,
        decision: makeDecision(degradedPlan),
        dataQuality: "degraded",
      }),
      makeObservation({
        plan: failedPlan,
        decision: makeDecision(failedPlan),
        dataQuality: "fail",
      }),
    ]);
    expect(report.eligibleObservations).toBe(0);
    expect(report.excluded.map((item) => item.reason)).toContain("ambiguous_path");
    expect(report.excluded.map((item) => item.reason)).toContain("data_quality_not_passed");
  });

  it("requires the journal observation to be recorded after the horizon and its observed-through timestamp", () => {
    const earlyPlan = makePlan({ decisionId: "early", candidateId: "early-candidate" });
    const futurePlan = makePlan({ decisionId: "future", candidateId: "future-candidate" });
    const report = evaluateLearningCohorts([
      makeObservation({
        plan: earlyPlan,
        decision: makeDecision(earlyPlan),
        recordedAt: 9_999,
      }),
      makeObservation({
        plan: futurePlan,
        decision: makeDecision(futurePlan),
        recordedAt: 10_000,
        observedThrough: 10_001,
      }),
    ]);
    expect(report.eligibleObservations).toBe(0);
    expect(report.excluded.map((item) => item.reason)).toContain("recorded_before_horizon");
    expect(report.excluded.map((item) => item.reason)).toContain("observation_timestamp_in_future");
  });

  it("rejects mismatched decision, candidate, symbol and simulation identities", () => {
    const base = makeObservation();
    const wrongDecision = makeDecision(makePlan({ decisionId: "other-decision" }));
    const wrongCandidate = makeDecision(makePlan({ candidateId: "other-candidate" }));
    const wrongSymbol = makeDecision(makePlan({ symbol: "ETHUSDT" }));
    const wrongVersion = makeOutcome(base.plan, "completed", { simulationVersion: "other-version" });
    const report = evaluateLearningCohorts([
      base,
      makeObservation({ decision: wrongDecision }),
      makeObservation({ decision: wrongCandidate }),
      makeObservation({ decision: wrongSymbol }),
      makeObservation({ outcome: wrongVersion }),
    ]);
    expect(report.eligibleObservations).toBe(1);
    expect(report.excluded).toHaveLength(4);
    expect(report.excluded.every((item) => item.reason === "identity_mismatch")).toBe(true);
  });

  it("uses only the latest mature observation for a decision candidate and simulation version", () => {
    const first = makeObservation({ observationId: "event-1", recordedAt: 11_000 });
    const laterOutcome = makeOutcome(first.plan, "completed", { netPnl: 4.79 });
    const later = makeObservation({
      observationId: "event-2",
      recordedAt: 12_000,
      outcome: laterOutcome,
    });
    const report = evaluateLearningCohorts([later, first]);
    expect(report.eligibleObservations).toBe(1);
    expect(report.cohorts[0].meanNetR).toBeCloseTo(0.958);
    expect(report.excluded).toContainEqual({
      observationId: "event-1",
      decisionId: "decision-1",
      reason: "superseded_observation",
    });
  });

  it("excludes NO_SETUP records because missed-opportunity discovery is a separate causal process", () => {
    const plan = makePlan();
    const decision = makeDecision(plan, "NO_SETUP");
    const report = evaluateLearningCohorts([
      makeObservation({ decision }),
    ]);
    expect(report.eligibleObservations).toBe(0);
    expect(report.excluded[0].reason).toBe("no_candidate");
  });

  it("rejects duplicate observation IDs and invalid risk budgets without manufacturing metrics", () => {
    const invalidRiskPlan = makePlan({ stopPrice: 100 });
    const invalidRiskDecision = makeDecision(invalidRiskPlan);
    const valid = makeObservation();
    const duplicate = makeObservation({ observationId: valid.observationId });
    const report = evaluateLearningCohorts([
      valid,
      duplicate,
      makeObservation({
        plan: invalidRiskPlan,
        decision: invalidRiskDecision,
      }),
    ]);
    expect(report.eligibleObservations).toBe(1);
    expect(report.excluded.map((item) => item.reason)).toContain("duplicate_observation_id");
    expect(report.excluded.map((item) => item.reason)).toContain("invalid_observation");
  });
});
