import { describe, expect, it } from "vitest";
import { compileComposedStrategy, parseComposedStrategy } from "../strategies/composed-strategy-compiler";

const valid = {
  schemaVersion: 1,
  id: "trend-pullback-confirmed",
  name: "Trend pullback with momentum recovery",
  marketHypothesis: "In an established uptrend, a momentum recovery after a pullback may resume the prior move.",
  regimeScope: "uptrend",
  timeframe: "1h",
  entry: {
    trigger: { type: "rsi_recovery", period: 14, oversold: 30 },
    confirmations: [{ type: "ema_alignment", fastPeriod: 10, slowPeriod: 30 }],
  },
  exit: { type: "rsi_overbought", period: 14, threshold: 70 },
  invalidation: "The hypothesis is invalidated if the trend filter loses bullish alignment.",
};

describe("AI-composed strategy contract", () => {
  it("parses a complete, bounded strategy specification", () => {
    const parsed = parseComposedStrategy(valid);
    expect(parsed.id).toBe("trend-pullback-confirmed");
    expect(parsed.entry.trigger.type).toBe("rsi_recovery");
    expect(parsed.exit.type).toBe("rsi_overbought");
    expect(Object.isFrozen(parsed.entry)).toBe(true);
  });

  it("rejects generated code, unknown indicators and unsupported timeframes", () => {
    expect(() => parseComposedStrategy({ ...valid, code: "fetch('/secrets')" })).toThrow();
    expect(() => parseComposedStrategy({
      ...valid,
      entry: { trigger: { type: "custom_python", source: "..." }, confirmations: [] },
    })).toThrow();
    expect(() => parseComposedStrategy({ ...valid, timeframe: "5m" })).toThrow();
  });

  it("rejects invalid parameters, too many filters and malformed falsifiable text", () => {
    expect(() => parseComposedStrategy({
      ...valid,
      entry: { trigger: { type: "rsi_recovery", period: 14, oversold: 95 }, confirmations: [] },
    })).toThrow();
    expect(() => parseComposedStrategy({
      ...valid,
      entry: { ...valid.entry, confirmations: Array(4).fill({ type: "ema_alignment", fastPeriod: 10, slowPeriod: 30 }) },
    })).toThrow();
    expect(() => parseComposedStrategy({ ...valid, invalidation: "No" })).toThrow();
  });

  it("compiles the validated specification into a deterministic long-only research candidate", () => {
    const specification = parseComposedStrategy(valid);
    const candidate = compileComposedStrategy(specification);
    expect(candidate.id).toBe("ai-composed-trend-pullback-confirmed-v1");
    expect(candidate.name).toContain(specification.name);
    expect(typeof candidate.fit([])).toBe("function");
  });

  it("uses completed history only and does not mutate caller candles", () => {
    const specification = parseComposedStrategy({
      ...valid,
      entry: { trigger: { type: "sma_cross", fastPeriod: 5, slowPeriod: 15 }, confirmations: [] },
      exit: { type: "opposite_sma_cross", fastPeriod: 5, slowPeriod: 15 },
    });
    const candidate = compileComposedStrategy(specification);
    const evaluator = candidate.fit([]);
    const candles = Array.from({ length: 40 }, (_, index) => {
      const close = 100 + index;
      return { timestamp: index * 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
    });
    const before = JSON.stringify(candles);
    for (let index = 1; index <= candles.length; index += 1) evaluator(candles.slice(0, index));
    expect(JSON.stringify(candles)).toBe(before);
  });
});
