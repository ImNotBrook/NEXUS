import { parseAiStrategyProposals, type AiStrategyProposal } from "./ai-strategy-proposals";
import { createStrategyDefinition, type StrategyDefinition } from "./strategy-studio";

const AI_PROVIDER_IDS = ["groq", "gemini", "zai", "cloudflare", "nvidia"] as const;

export interface ParsedAutomatedResearchAiArtifact {
  schemaVersion: 1;
  createdAt: string;
  symbol: string;
  interval: "1h";
  provider: "groq" | "gemini" | "zai" | "cloudflare" | "nvidia";
  model: string;
  proposals: AiStrategyProposal[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableParameters(parameters: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))));
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

/** Accepts only the AI proposal section of the versioned CI research artifact. */
export function parseAutomatedResearchAiArtifact(input: unknown): ParsedAutomatedResearchAiArtifact {
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw new TypeError("Unsupported automated research artifact schema");
  }
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt)) ||
      typeof input.symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(input.symbol) ||
      input.interval !== "1h" || !isRecord(input.aiGeneration)) {
    throw new TypeError("Automated research artifact metadata is invalid");
  }
  const generation = input.aiGeneration;
  if (generation.status !== "generated" || typeof generation.provider !== "string" ||
      !AI_PROVIDER_IDS.includes(generation.provider as typeof AI_PROVIDER_IDS[number]) ||
      typeof generation.model !== "string" || !generation.model.trim() ||
      !Array.isArray(generation.proposals)) {
    throw new TypeError("Artifact does not contain successful AI-generated proposals");
  }
  const proposals = parseAiStrategyProposals({ candidates: generation.proposals });
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    symbol: input.symbol,
    interval: "1h",
    provider: generation.provider as typeof AI_PROVIDER_IDS[number],
    model: generation.model,
    proposals,
  };
}

/**
 * Converts one proposal into a human-origin definition only at the explicit
 * review boundary. The caller must obtain a real approval timestamp first.
 */
export function createHumanReviewedStrategyDefinition(
  proposal: AiStrategyProposal,
  approvedAt: number,
  source: Pick<ParsedAutomatedResearchAiArtifact, "createdAt" | "symbol" | "interval" | "provider" | "model">,
): Readonly<StrategyDefinition> {
  if (!Number.isSafeInteger(approvedAt) || approvedAt < 0) {
    throw new RangeError("A valid human approval timestamp is required");
  }
  if (typeof proposal.rationale !== "string" || proposal.rationale.trim().length < 12 ||
      proposal.rationale.length > 500) {
    throw new TypeError("AI proposal rationale must contain 12–500 characters");
  }
  const parameters = proposal.parameters as unknown as Record<string, number>;
  const identity = hash(proposal.family + ":" + stableParameters(parameters));
  const names = {
    "sma-crossover": "SMA crossover",
    "rsi-mean-reversion": "RSI mean reversion",
    "donchian-breakout": "Donchian breakout",
  } as const;
  return createStrategyDefinition({
    schemaVersion: 1,
    id: "ai-" + proposal.family + "-" + identity,
    version: "1.0.0",
    name: "AI " + names[proposal.family] + " " + identity.slice(0, 4),
    family: proposal.family,
    parameters: structuredClone(proposal.parameters),
    createdAt: approvedAt,
    origin: "human",
    description: proposal.rationale.trim(),
    aiProvenance: {
      provider: source.provider,
      model: source.model,
      generatedAt: source.createdAt,
      symbol: source.symbol,
      interval: source.interval,
    },
  });
}
