import { describe, expect, it } from "vitest";
import { evaluateQualification } from "./qualification";

describe("evaluateQualification", () => {
  it("does not qualify with 89 days even when trade count exceeds 1,000", () => {
    expect(evaluateQualification({ qualifyingDays: 89, completedTrades: 1200 })).toMatchObject({
      qualified: false,
      reasons: ["At least 90 qualifying days are required"],
    });
  });

  it("does not qualify with 999 trades even when evidence spans 90 days", () => {
    expect(evaluateQualification({ qualifyingDays: 90, completedTrades: 999 })).toMatchObject({
      qualified: false,
      reasons: ["At least 1,000 completed trades are required"],
    });
  });

  it("requires both thresholds simultaneously", () => {
    expect(evaluateQualification({ qualifyingDays: 90, completedTrades: 1000 })).toEqual({
      qualified: true,
      reasons: [],
      reviewEligible: true,
      liveExecutionEnabled: false,
    });
  });

  it("rejects negative and non-integer evidence", () => {
    expect(() => evaluateQualification({ qualifyingDays: -1, completedTrades: 1000 })).toThrow();
    expect(() => evaluateQualification({ qualifyingDays: 90, completedTrades: 1.5 })).toThrow();
  });
});
