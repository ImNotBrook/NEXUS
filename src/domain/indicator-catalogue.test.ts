import { describe, expect, it } from "vitest";
import {
  getImplementedIndicators,
  getIndicatorById,
  INDICATOR_CATALOGUE,
  recommendIndicators,
} from "./indicator-catalogue";

describe("indicator catalogue", () => {
  it("documents a broad set of categories, purposes and market contexts", () => {
    expect(INDICATOR_CATALOGUE.length).toBeGreaterThanOrEqual(18);
    expect(new Set(INDICATOR_CATALOGUE.map((item) => item.category))).toEqual(
      new Set(["trend", "momentum", "volatility", "volume", "market_structure", "derivatives", "breadth", "sentiment"]),
    );
    for (const item of INDICATOR_CATALOGUE) {
      expect(item.purpose.length).toBeGreaterThan(10);
      expect(item.bestIn.length).toBeGreaterThan(0);
      expect(item.avoidWhen.length).toBeGreaterThan(0);
      expect(item.limitations.length).toBeGreaterThan(0);
      expect(item.redundancyGroup.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes implemented calculations from research roadmap entries", () => {
    expect(getImplementedIndicators().map((item) => item.id).sort()).toEqual([
      "adx", "atr", "bollinger_bands", "cci", "donchian_channels", "ema", "keltner_channels", "macd", "mfi", "obv", "rate_of_change", "rsi", "sma", "stochastic", "vwap", "wma",
    ]);
    expect(getIndicatorById("funding_rate")?.implementation).toBe("planned");
    expect(getIndicatorById("not-real")).toBeUndefined();
  });
});

describe("recommendIndicators", () => {
  it("prioritises trend tools in directional markets and removes duplicates", () => {
    const recommendations = recommendIndicators({ trend: "uptrend", volatility: "normal" });
    expect(recommendations.map((item) => item.indicator.id)).toEqual(["ema", "adx", "donchian_channels", "atr"]);
    expect(recommendations[0].relevance).toBe("primary");
  });

  it("selects mean-reversion context for ranges without treating it as a signal", () => {
    const recommendations = recommendIndicators({ trend: "range", volatility: "normal" });
    expect(recommendations.map((item) => item.indicator.id)).toEqual(["rsi", "bollinger_bands", "adx", "atr"]);
    expect(recommendations[0].rationale).toMatch(/test mean reversion/);
  });

  it("adds volatility tools in high and low volatility regimes", () => {
    const high = recommendIndicators({ trend: "uptrend", volatility: "high" });
    expect(high.find((item) => item.indicator.id === "atr")?.relevance).toBe("primary");
    expect(high.some((item) => item.rationale.startsWith("High volatility"))).toBe(true);

    const low = recommendIndicators({ trend: "range", volatility: "low" });
    expect(low.find((item) => item.indicator.id === "bollinger_bands")?.relevance).toBe("primary");
  });

  it("never recommends calculations that are only planned", () => {
    const recommendations = recommendIndicators({ trend: "downtrend", volatility: "high" });
    expect(recommendations.every((item) => item.indicator.implementation === "implemented")).toBe(true);
    expect(recommendations.some((item) => item.indicator.id === "funding_rate")).toBe(false);
  });
});
