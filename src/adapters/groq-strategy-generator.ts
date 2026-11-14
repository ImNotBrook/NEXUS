import { parseAiStrategyProposals, type AiStrategyProposal } from "../domain/ai-strategy-proposals";
import { NEXUS_AI_GOVERNANCE_POLICY } from "../domain/ai-governance-policy";

export const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_RESEARCH_MODEL = "openai/gpt-oss-120b";

export interface AiMarketContext {
  symbol: string;
  interval: "1h";
  recentReturnPct: number;
  volatilityPct: number;
  atrPct: number;
  regime: "uptrend" | "downtrend" | "range";
}

function validateContext(context: AiMarketContext): void {
  if (!/^[A-Z0-9]{5,20}$/.test(context.symbol) || context.interval !== "1h" ||
      ![context.recentReturnPct, context.volatilityPct, context.atrPct].every(Number.isFinite) ||
      context.volatilityPct < 0 || context.atrPct < 0 ||
      !["uptrend", "downtrend", "range"].includes(context.regime)) {
    throw new TypeError("AI market context is invalid");
  }
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new TypeError("Groq returned an invalid response");
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    throw new TypeError("Groq response did not contain a completion");
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  if (!message || typeof message.content !== "string") {
    throw new TypeError("Groq completion content was missing");
  }
  return message.content;
}

/**
 * Uses Groq's OpenAI-compatible endpoint to propose bounded parameter changes.
 * The model cannot supply code, indicators, orders or execution permissions.
 */
export async function generateAiStrategyProposals(
  context: AiMarketContext,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  model = DEFAULT_GROQ_RESEARCH_MODEL,
): Promise<AiStrategyProposal[]> {
  validateContext(context);
  if (typeof apiKey !== "string" || apiKey.trim().length < 10) {
    throw new TypeError("A valid Groq API key is required");
  }
  if (!/^[a-zA-Z0-9._/-]{3,100}$/.test(model)) throw new TypeError("Invalid Groq model identifier");

  const response = await fetcher(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "nexus_strategy_candidates",
          strict: true,
          schema: {
            type: "object",
            properties: {
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    family: { type: "string", enum: ["sma-crossover", "rsi-mean-reversion", "donchian-breakout"] },
                    parameters: {
                      anyOf: [
                        {
                          type: "object",
                          properties: {
                            fastPeriod: { type: "integer" },
                            slowPeriod: { type: "integer" },
                          },
                          required: ["fastPeriod", "slowPeriod"],
                          additionalProperties: false,
                        },
                        {
                          type: "object",
                          properties: {
                            period: { type: "integer" },
                            oversold: { type: "integer" },
                            overbought: { type: "integer" },
                          },
                          required: ["period", "oversold", "overbought"],
                          additionalProperties: false,
                        },
                        {
                          type: "object",
                          properties: { period: { type: "integer" } },
                          required: ["period"],
                          additionalProperties: false,
                        },
                      ],
                    },
                    rationale: { type: "string" },
                  },
                  required: ["family", "parameters", "rationale"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: NEXUS_AI_GOVERNANCE_POLICY + "\nTASK-SPECIFIC CONTRACT: You are a quantitative research hypothesis generator. Return only JSON with a candidates array containing 1 to 4 objects. Each object must have family (sma-crossover, rsi-mean-reversion, or donchian-breakout), parameters, and a falsifiable rationale of at least 12 characters. SMA parameters: integer fastPeriod 2..30 and slowPeriod 5..100 with fastPeriod < slowPeriod. RSI parameters: integer period 5..50, oversold 10..40, overbought 60..90 and oversold < overbought. Donchian parameters: integer period 5..100. Do not return code, formulas, tools, orders, credentials, execution instructions or claims of profitability. Propose diverse but plausible test candidates. Historical results are unknown; do not pretend you have backtested them.",
        },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("Groq free-tier rate limit reached; deterministic research fallback will be used");
    throw new Error("Groq strategy generation failed: HTTP " + response.status);
  }
  const payload: unknown = await response.json();
  const content = extractContent(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TypeError("Groq returned malformed JSON; deterministic research fallback will be used");
  }
  return parseAiStrategyProposals(parsed);
}
