import { describe, expect, it } from "vitest";
import {
  generateAiStrategyProposalsWithFallback,
  resolveAiProviderConfigs,
} from "./multi-provider-strategy-generator";

const context = {
  symbol: "BTCUSDT",
  interval: "1h" as const,
  recentReturnPct: 1.2,
  volatilityPct: 2.4,
  atrPct: 1.1,
  regime: "uptrend" as const,
};

const validPayload = {
  choices: [{
    message: {
      content: JSON.stringify({
        candidates: [{
          family: "sma-crossover",
          parameters: { fastPeriod: 8, slowPeriod: 24 },
          rationale: "Tests a quicker trend trigger against the slower baseline.",
        }],
      }),
    },
  }],
};

describe("multi-provider strategy generator", () => {
  it("resolves only configured providers in an explicit, allowlisted order", () => {
    const providers = resolveAiProviderConfigs({
      GROQ_API_KEY: "groq-test-key-12345",
      GEMINI_API_KEY: "gemini-test-key-12345",
      ZAI_API_KEY: "zai-test-key-12345",
      CLOUDFLARE_API_TOKEN: "cloudflare-test-key-12345",
      CLOUDFLARE_ACCOUNT_ID: "account-123",
      NEXUS_AI_PROVIDER_ORDER: "zai,unknown,gemini,zai",
    });
    expect(providers.map((provider) => provider.id)).toEqual(["zai", "gemini"]);
    expect(providers[0].model).toBe("glm-4.7-flash");
    expect(providers[1].model).toBe("gemini-2.5-flash");
  });


  it("keeps NVIDIA opt-in but permits explicit selection", () => {
    const providers = resolveAiProviderConfigs({
      NVIDIA_API_KEY: "nvidia-test-key-12345",
    });
    expect(providers).toEqual([]);
    const optedIn = resolveAiProviderConfigs({
      NVIDIA_API_KEY: "nvidia-test-key-12345",
      NEXUS_AI_PROVIDER_ORDER: "nvidia",
    });
    expect(optedIn.map((provider) => provider.id)).toEqual(["nvidia"]);
  });

  it("does not enable Cloudflare without both its token and account id", () => {
    expect(resolveAiProviderConfigs({
      CLOUDFLARE_API_TOKEN: "cloudflare-test-key-12345",
    }).some((provider) => provider.id === "cloudflare")).toBe(false);
  });

  it("uses the first successful provider and returns validated proposals", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify(validPayload), { status: 200 });
    };
    const result = await generateAiStrategyProposalsWithFallback(context, {
      GROQ_API_KEY: "groq-test-key-12345",
      GEMINI_API_KEY: "gemini-test-key-12345",
      NEXUS_AI_PROVIDER_ORDER: "gemini,groq",
    }, fetcher);
    expect(result.status).toBe("generated");
    expect(result.provider).toBe("gemini");
    expect(result.proposals).toHaveLength(1);
    expect(urls).toEqual(["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"]);
  });

  it("falls through a rate-limited provider without exposing credentials", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      if (String(input).includes("groq.com")) return new Response("limited", { status: 429 });
      return new Response(JSON.stringify(validPayload), { status: 200 });
    };
    const result = await generateAiStrategyProposalsWithFallback(context, {
      GROQ_API_KEY: "secret-groq-value-12345",
      ZAI_API_KEY: "secret-zai-value-12345",
      NEXUS_AI_PROVIDER_ORDER: "groq,zai",
    }, fetcher);
    expect(result.status).toBe("generated");
    expect(result.provider).toBe("zai");
    expect(result.attempts).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("secret-groq-value");
    expect(JSON.stringify(result)).not.toContain("secret-zai-value");
  });

  it("returns not_configured when no provider credentials are present", async () => {
    const result = await generateAiStrategyProposalsWithFallback(context, {}, fetch);
    expect(result.status).toBe("not_configured");
    expect(result.proposals).toEqual([]);
  });

  it("fails closed to deterministic fallback when every configured provider fails", async () => {
    const fetcher: typeof fetch = async () => new Response("bad request", { status: 400 });
    const result = await generateAiStrategyProposalsWithFallback(context, {
      GROQ_API_KEY: "groq-test-key-12345",
    }, fetcher);
    expect(result.status).toBe("fallback");
    expect(result.proposals).toEqual([]);
    expect(result.attempts[0].status).toBe("failed");
  });

  it("rejects invalid market context before making a network request", async () => {
    let called = false;
    const fetcher: typeof fetch = async () => {
      called = true;
      return new Response(JSON.stringify(validPayload), { status: 200 });
    };
    await expect(generateAiStrategyProposalsWithFallback({
      ...context,
      symbol: "bad symbol",
    }, { GROQ_API_KEY: "groq-test-key-12345" }, fetcher)).rejects.toThrow("market context is invalid");
    expect(called).toBe(false);
  });
});
