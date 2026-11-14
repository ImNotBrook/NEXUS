import { describe, expect, it } from "vitest";
import { parseAiMarketAnalysis, type MarketAnalystEvidence } from "./ai-market-analysis";

const evidence: MarketAnalystEvidence[] = [
  {
    id: "daily-trend",
    source: "Binance public spot",
    observedAt: 1_800_000_000_000,
    statement: "Daily EMA structure is positive and the latest completed candle closed above the slow EMA.",
  },
  {
    id: "hourly-volume",
    source: "Binance public spot",
    observedAt: 1_800_000_000_000,
    statement: "Hourly relative volume is 0.72 times its twenty-period average.",
  },
];

const validAnalysis = {
  schemaVersion: 1,
  bias: "mixed",
  confidence: "moderate",
  summary: "Higher-timeframe trend is positive, but hourly participation is subdued.",
  bullCase: "Daily trend structure remains positive and price is above the slow EMA.",
  bearCase: "Hourly participation is below average, reducing confirmation quality.",
  contradictions: ["The daily trend is positive while hourly volume remains subdued."],
  claims: [
    { evidenceId: "daily-trend", statement: "The daily EMA structure is positive." },
    { evidenceId: "hourly-volume", statement: "Hourly relative volume is below its average." },
  ],
  abstain: false,
};

describe("AI market analysis evidence contract", () => {
  it("accepts a balanced analysis whose every claim references supplied evidence", () => {
    const result = parseAiMarketAnalysis(validAnalysis, evidence);
    expect(result.bias).toBe("mixed");
    expect(result.confidence).toBe("moderate");
    expect(result.claims.map((claim) => claim.evidenceId)).toEqual(["daily-trend", "hourly-volume"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claims)).toBe(true);
  });

  it("rejects claims that cite evidence not present in the supplied packet", () => {
    expect(() => parseAiMarketAnalysis({
      ...validAnalysis,
      claims: [{ evidenceId: "invented-price-target", statement: "Price will rise." }],
    }, evidence)).toThrow(/unknown evidence/i);
  });

  it("rejects duplicate evidence identifiers in the supplied packet", () => {
    expect(() => parseAiMarketAnalysis(validAnalysis, [
      ...evidence,
      { ...evidence[0], statement: "Conflicting duplicate." },
    ])).toThrow(/unique evidence/i);
  });

  it("requires a balanced bull and bear case for non-abstaining analysis", () => {
    expect(() => parseAiMarketAnalysis({
      ...validAnalysis,
      bearCase: "",
    }, evidence)).toThrow(/bear case/i);
  });

  it("allows an explicit abstention without fabricated claims or directional bias", () => {
    const result = parseAiMarketAnalysis({
      schemaVersion: 1,
      bias: "none",
      confidence: "low",
      summary: "Insufficient trustworthy evidence is available for a directional assessment.",
      bullCase: "",
      bearCase: "",
      contradictions: [],
      claims: [],
      abstain: true,
      abstentionReason: "The tactical timeframe failed its data-quality check.",
    }, evidence);
    expect(result.abstain).toBe(true);
    expect(result.abstentionReason).toContain("data-quality");
  });

  it("rejects abstention responses that still assert a directional bias", () => {
    expect(() => parseAiMarketAnalysis({
      schemaVersion: 1,
      bias: "bullish",
      confidence: "low",
      summary: "Insufficient trustworthy evidence is available for a directional assessment.",
      bullCase: "",
      bearCase: "",
      contradictions: [],
      claims: [],
      abstain: true,
      abstentionReason: "Insufficient data.",
    }, evidence)).toThrow(/abstention/i);
  });

  it("rejects unknown fields and malformed evidence metadata", () => {
    expect(() => parseAiMarketAnalysis({
      ...validAnalysis,
      order: "BUY",
    }, evidence)).toThrow(/unexpected field/i);
    expect(() => parseAiMarketAnalysis(validAnalysis, [
      { ...evidence[0], observedAt: -1 },
    ])).toThrow(/evidence packet/i);
  });
});
