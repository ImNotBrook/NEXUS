import { describe, expect, it } from "vitest";
import { findFirstCausalDonchianTrigger, type NoSetupReplaySpec } from "./no-setup-replay";
import type { Candle } from "./candles";

const hour = 3_600_000;
const decisionAt = 1_800_000_000_000;
const initial: Candle[] = [
  { timestamp: decisionAt - 3 * hour, open: 98, high: 101, low: 97, close: 100, volume: 10 },
  { timestamp: decisionAt - 2 * hour, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { timestamp: decisionAt - hour, open: 101, high: 103, low: 100, close: 102, volume: 10 },
];
const spec: NoSetupReplaySpec = {
  schemaVersion: 1, detectorVersion: "donchian-no-setup-v1",
  decisionId: "decision-no-setup", symbol: "BTCUSDT", timeframe: "1h",
  decisionAt, lookback: 3, initialWindow: initial,
  strategyId: "donchian-breakout", strategyVersion: "1.0.0",
  atrStopMultiple: 2, rewardRiskMultiple: 2, riskBudget: 20,
  maxNotional: 2_000, expiryBars: 2,
};

function candle(timestamp: number, close: number, high = close + 1): Candle {
  return { timestamp, open: close - 1, high, low: close - 2, close, volume: 10 };
}

describe("causal NO_SETUP Donchian replay", () => {
  it("selects the first future close above its then-known Donchian channel", () => {
    const result = findFirstCausalDonchianTrigger(spec, [
      candle(decisionAt, 102.5, 103),
      candle(decisionAt + hour, 103, 104),
      candle(decisionAt + 2 * hour, 104, 105),
      candle(decisionAt + 3 * hour, 106, 107),
    ]);
    expect(result.status).toBe("trigger_found");
    if (result.status === "trigger_found") {
      expect(result.trigger.timestamp).toBe(decisionAt + 3 * hour);
      expect(result.trigger.entryReferencePrice).toBe(106);
      expect(result.evaluationBars).toBe(3);
    }
  });

  it("does not inspect a candle whose close is after the as-of cutoff", () => {
    const result = findFirstCausalDonchianTrigger(spec, [
      candle(decisionAt + hour, 104, 105),
    ], decisionAt + hour - 1);
    expect(result.status).toBe("no_trigger");
    if (result.status === "no_trigger") expect(result.evaluationBars).toBe(0);
  });

  it("never replaces the first trigger with a later, more profitable breakout", () => {
    const result = findFirstCausalDonchianTrigger(spec, [
      candle(decisionAt + hour, 104, 105),
      candle(decisionAt + 2 * hour, 120, 121),
    ]);
    expect(result.status).toBe("trigger_found");
    if (result.status === "trigger_found") {
      expect(result.trigger.timestamp).toBe(decisionAt + hour);
      expect(result.trigger.entryReferencePrice).toBe(104);
    }
  });

  it("rejects gaps and malformed hourly history rather than silently bridging them", () => {
    expect(() => findFirstCausalDonchianTrigger(spec, [
      candle(decisionAt + 2 * hour, 104, 105),
    ])).toThrow(/continuous/i);
  });
});
