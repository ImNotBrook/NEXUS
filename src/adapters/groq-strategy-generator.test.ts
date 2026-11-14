import { describe, expect, it } from "vitest";
import { generateAiStrategyProposals, GROQ_CHAT_COMPLETIONS_URL } from "./groq-strategy-generator";

const context = {
  symbol: "BTCUSDT",
  interval: "1h" as const,
  recentReturnPct: 1.2,
  volatilityPct: 2.4,
  atrPct: 1.1,
  regime: "uptrend" as const,
};

describe("Groq strategy generator adapter", () => {
  it("sends only bounded market context and parses structured proposals", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ candidates: [
          { family: "sma-crossover", parameters: { fastPeriod: 8, slowPeriod: 24 }, rationale: "Tests whether a quicker trend trigger improves responsiveness." },
        ] }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const proposals = await generateAiStrategyProposals(context, "test-groq-api-key-123", fetcher);
    expect(requestUrl).toBe(GROQ_CHAT_COMPLETIONS_URL);
    expect(requestInit?.method).toBe("POST");
    expect(String(requestInit?.body)).toContain("BTCUSDT");
    expect(String(requestInit?.body)).toContain('"type":"json_schema"');
    expect(String(requestInit?.body)).toContain('"strict":true');
    expect(proposals).toHaveLength(1);
  });

  it("fails safely on missing keys, rate limits and malformed model output", async () => {
    await expect(generateAiStrategyProposals(context, "")).rejects.toThrow("API key");
    const rateLimited: typeof fetch = async () => new Response("", { status: 429 });
    await expect(generateAiStrategyProposals(context, "test-groq-api-key-123", rateLimited)).rejects.toThrow("rate limit");
    const malformed: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not json" } }],
    }), { status: 200 });
    await expect(generateAiStrategyProposals(context, "test-groq-api-key-123", malformed)).rejects.toThrow("malformed JSON");
  });
});
