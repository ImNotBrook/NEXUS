export type AiStrategyProposal =
  | {
      family: "sma-crossover";
      parameters: { fastPeriod: number; slowPeriod: number };
      rationale: string;
    }
  | {
      family: "rsi-mean-reversion";
      parameters: { period: number; oversold: number; overbought: number };
      rationale: string;
    }
  | {
      family: "donchian-breakout";
      parameters: { period: number };
      rationale: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

/** Strictly parses bounded parameters. It never accepts or executes generated source code. */
export function parseAiStrategyProposals(payload: unknown): AiStrategyProposal[] {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) ||
      payload.candidates.length < 1 || payload.candidates.length > 4) {
    throw new TypeError("AI output must contain between 1 and 4 candidate proposals");
  }

  return payload.candidates.map((raw, index): AiStrategyProposal => {
    if (!isRecord(raw) || typeof raw.rationale !== "string" || raw.rationale.trim().length < 12 ||
        !isRecord(raw.parameters)) {
      throw new TypeError("AI candidate " + index + " has invalid rationale or parameters");
    }
    const p = raw.parameters;
    if (raw.family === "sma-crossover") {
      if (!integerInRange(p.fastPeriod, 2, 30) || !integerInRange(p.slowPeriod, 5, 100) ||
          p.fastPeriod >= p.slowPeriod) {
        throw new RangeError("AI SMA parameters must satisfy 2 <= fast < slow <= 100");
      }
      return { family: raw.family, parameters: { fastPeriod: p.fastPeriod, slowPeriod: p.slowPeriod }, rationale: raw.rationale.trim() };
    }
    if (raw.family === "rsi-mean-reversion") {
      if (!integerInRange(p.period, 5, 50) || !integerInRange(p.oversold, 10, 40) ||
          !integerInRange(p.overbought, 60, 90) || p.oversold >= p.overbought) {
        throw new RangeError("AI RSI parameters are outside the permitted research bounds");
      }
      return { family: raw.family, parameters: { period: p.period, oversold: p.oversold, overbought: p.overbought }, rationale: raw.rationale.trim() };
    }
    if (raw.family === "donchian-breakout") {
      if (!integerInRange(p.period, 5, 100)) {
        throw new RangeError("AI Donchian period must be between 5 and 100");
      }
      return { family: raw.family, parameters: { period: p.period }, rationale: raw.rationale.trim() };
    }
    throw new TypeError("AI candidate " + index + " uses an unsupported strategy family");
  });
}
