import { describe, expect, it } from "vitest";
import { getSeedSkillCandidates } from "./skill-catalogue";

describe("curated external skill catalogue", () => {
  it("registers source-backed repositories without approving or executing them", () => {
    const candidates = getSeedSkillCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(9);
    expect(candidates.find((item) => item.id === "finrl-x")?.license).toBe("Apache-2.0");
    expect(candidates.every((item) => item.executable === false)).toBe(true);
    expect(candidates.every((item) => item.status === "quarantined")).toBe(true);
    expect(candidates.every((item) => item.approvedBy === null)).toBe(true);
  });

  it("retains restrictive licences as quarantined research references", () => {
    const candidates = getSeedSkillCandidates();
    expect(candidates.find((item) => item.id === "freqtrade-freqtrade")?.license).toBe("GPL-3.0");
    expect(candidates.find((item) => item.id === "nautilus-trader")?.license).toBe("LGPL-3.0");
    expect(candidates.find((item) => item.id === "vectorbt")?.license).toBe("NOASSERTION");
    expect(candidates.find((item) => item.id === "backtesting-py")?.license).toBe("AGPL-3.0");
  });

  it("does not mark tests, documentation or security as verified without review", () => {
    const candidates = getSeedSkillCandidates();
    expect(candidates.every((item) => !item.hasTests && !item.hasDocumentation && !item.securityReviewed)).toBe(true);
  });
});
