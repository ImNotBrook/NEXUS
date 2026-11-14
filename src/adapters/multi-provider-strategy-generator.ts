import { parseAiStrategyProposals, type AiStrategyProposal } from "../domain/ai-strategy-proposals";
import { NEXUS_AI_GOVERNANCE_POLICY } from "../domain/ai-governance-policy";
import type { AiMarketContext } from "./groq-strategy-generator";
import { parseComposedStrategy, type ComposedStrategySpecification } from "../strategies/composed-strategy-compiler";

export type AiProviderId = "groq" | "gemini" | "zai" | "cloudflare" | "nvidia";

export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiProviderEnvironment {
  [key: string]: string | undefined;
}

export interface AiProviderAttempt {
  provider: AiProviderId;
  status: "generated" | "failed";
  reason?: "rate_limited" | "provider_error" | "invalid_response" | "network_error";
}

export type AiProviderGenerationResult =
  | {
      status: "generated";
      provider: AiProviderId;
      model: string;
      proposals: AiStrategyProposal[];
      composedStrategies: Readonly<ComposedStrategySpecification>[];
      attempts: AiProviderAttempt[];
    }
  | {
      status: "not_configured" | "fallback";
      provider: null;
      model: null;
      proposals: [];
      composedStrategies: [];
      attempts: AiProviderAttempt[];
    };

interface ProviderDefinition {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  accountIdEnv?: string;
}

const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "zai",
    label: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyEnv: "ZAI_API_KEY",
    modelEnv: "ZAI_MODEL",
    defaultModel: "glm-4.7-flash",
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    keyEnv: "CLOUDFLARE_API_TOKEN",
    modelEnv: "CLOUDFLARE_AI_MODEL",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    accountIdEnv: "CLOUDFLARE_ACCOUNT_ID",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "openai/gpt-oss-120b",
  },
];

const SUPPORTED_PROVIDER_IDS: readonly AiProviderId[] = [
  "groq",
  "gemini",
  "zai",
  "cloudflare",
  "nvidia",
];

const DEFAULT_PROVIDER_ORDER: readonly AiProviderId[] = [
  "groq",
  "gemini",
  "zai",
  "cloudflare",
];

function validateContext(context: AiMarketContext): void {
  if (!/^[A-Z0-9]{5,20}$/.test(context.symbol) || context.interval !== "1h" ||
      ![context.recentReturnPct, context.volatilityPct, context.atrPct].every(Number.isFinite) ||
      context.volatilityPct < 0 || context.atrPct < 0 ||
      !["uptrend", "downtrend", "range"].includes(context.regime)) {
    throw new TypeError("AI market context is invalid");
  }
}

function isValidModelId(model: string): boolean {
  return /^[a-zA-Z0-9._/@:-]{1,160}$/.test(model);
}

/** Resolves only user-supplied credentials; no shared or embedded API keys are supported. */
export function resolveAiProviderConfigs(env: AiProviderEnvironment): AiProviderConfig[] {
  const requested = env.NEXUS_AI_PROVIDER_ORDER?.trim()
    ? env.NEXUS_AI_PROVIDER_ORDER.split(",").map((item) => item.trim().toLowerCase())
    : [...DEFAULT_PROVIDER_ORDER];
  const order = [...new Set(requested)].filter(
    (id): id is AiProviderId => SUPPORTED_PROVIDER_IDS.includes(id as AiProviderId),
  );

  return order.flatMap((id) => {
    const definition = PROVIDERS.find((provider) => provider.id === id);
    if (!definition) return [];
    const apiKey = env[definition.keyEnv]?.trim();
    if (!apiKey || apiKey.length < 10) return [];

    let baseUrl = definition.baseUrl;
    if (definition.accountIdEnv) {
      const accountId = env[definition.accountIdEnv]?.trim();
      if (!accountId || !/^[a-zA-Z0-9_-]{6,80}$/.test(accountId)) return [];
      baseUrl += "/" + accountId + "/ai/v1";
    }

    const model = env[definition.modelEnv]?.trim() || definition.defaultModel;
    if (!isValidModelId(model)) return [];
    return [{ id, label: definition.label, baseUrl, apiKey, model }];
  });
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new TypeError("invalid response");
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    throw new TypeError("missing completion");
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  if (!message || typeof message.content !== "string") throw new TypeError("missing content");
  return message.content;
}

function buildRequestBody(context: AiMarketContext, model: string): string {
  return JSON.stringify({
    model,
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: NEXUS_AI_GOVERNANCE_POLICY + "\nTASK-SPECIFIC CONTRACT: You are a quantitative research hypothesis generator. Return only JSON with candidates (1–4 parameter proposals) AND composedStrategies (1–2 complete strategy specifications). Each object must have family (sma-crossover, rsi-mean-reversion, or donchian-breakout), parameters, and a falsifiable rationale of at least 12 characters. SMA parameters: integer fastPeriod 2..30 and slowPeriod 5..100 with fastPeriod < slowPeriod. RSI parameters: integer period 5..50, oversold 10..40, overbought 60..90 and oversold < overbought. Donchian parameters: integer period 5..100. Do not return code, formulas, tools, orders, credentials, execution instructions or claims of profitability. Each composed strategy must use schemaVersion 1, a kebab-case id, a concise name, a falsifiable marketHypothesis, regimeScope (uptrend/downtrend/range/any), timeframe 1h, entry.trigger (sma_cross, rsi_recovery or donchian_breakout), zero to two ema_alignment confirmations, one exit (opposite_sma_cross, rsi_overbought or close_below_sma), and a falsifiable invalidation. Use only exact schema fields and bounded parameters. Entry is long-only. Risk and protective exits are external deterministic controls. Historical results are unknown; do not pretend you have backtested them.",
      },
      { role: "user", content: JSON.stringify(context) },
    ],
  });
}

/**
 * Tries configured OpenAI-compatible providers sequentially.
 * Invalid model output, rate limits and transport failures are isolated to that provider.
 * Only the domain parser can approve candidate parameters; generated code is never accepted.
 */
export async function generateAiStrategyProposalsWithFallback(
  context: AiMarketContext,
  env: AiProviderEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<AiProviderGenerationResult> {
  validateContext(context);
  const providers = resolveAiProviderConfigs(env);
  if (providers.length === 0) {
    return { status: "not_configured", provider: null, model: null, proposals: [], composedStrategies: [], attempts: [] };
  }

  const attempts: AiProviderAttempt[] = [];
  for (const provider of providers) {
    try {
      const response = await fetcher(provider.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + provider.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: buildRequestBody(context, provider.model),
      });
      if (!response.ok) {
        attempts.push({
          provider: provider.id,
          status: "failed",
          reason: response.status === 429 ? "rate_limited" : "provider_error",
        });
        continue;
      }
      const payload: unknown = await response.json();
      const decoded = JSON.parse(extractContent(payload)) as unknown;
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new TypeError("invalid strategy response");
      const response = decoded as Record<string, unknown>;
      const proposals = parseAiStrategyProposals(response);
      if (!Array.isArray(response.composedStrategies) || response.composedStrategies.length < 1 || response.composedStrategies.length > 2) throw new TypeError("AI must return one or two composed strategy specifications");
      const composedStrategies = response.composedStrategies.map(parseComposedStrategy);
      attempts.push({ provider: provider.id, status: "generated" });
      return {
        status: "generated",
        provider: provider.id,
        model: provider.model,
        proposals,
        composedStrategies,
        attempts,
      };
    } catch (error) {
      const reason = error instanceof TypeError || error instanceof SyntaxError
        ? "invalid_response"
        : "network_error";
      attempts.push({ provider: provider.id, status: "failed", reason });
    }
  }

  return { status: "fallback", provider: null, model: null, proposals: [], composedStrategies: [], attempts };
}
