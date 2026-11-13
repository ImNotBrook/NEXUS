import { describe, expect, it } from "vitest";
import { createResearchRunSettings } from "./research-console";

describe("createResearchRunSettings", () => {
  it("builds bounded walk-forward settings for supported spot intervals", () => {
    const settings = createResearchRunSettings({
      symbol: " btcusdt ",
      interval: "1h",
      candleCount: 1500,
      trainBars: 600,
      testBars: 120,
      feeBps: 10,
      slippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationPct: 1,
      marketImpactBps: 25,
    });
    expect(settings.symbol).toBe("BTCUSDT");
    expect(settings.interval).toBe("1h");
    expect(settings.historyLimit).toBe(1500);
    expect(settings.pipeline.folds).toMatchObject({
      trainBars: 600, testBars: 120, stepBars: 120, embargoBars: 2, expanding: true,
    });
    expect(settings.pipeline.backtest).toMatchObject({
      initialCapital: 10_000, feeRate: 0.001, slippageBps: 5, allocationFraction: 0.25,
    });
    expect(settings.pipeline.executionModel).toEqual({ feeRate: 0.001, baseSlippageBps: 5, halfSpreadBps: 2, maxParticipationRate: 0.01, marketImpactBpsAtMaxParticipation: 25 });
  });

  it("rejects invalid pairs, unsupported intervals, impossible windows and excessive fold counts", () => {
    expect(() => createResearchRunSettings({
      symbol: "BTC/USDT", interval: "1h", candleCount: 1500, trainBars: 600,
      testBars: 120, feeBps: 10, slippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationPct: 1,
      marketImpactBps: 25,
    })).toThrow();
    expect(() => createResearchRunSettings({
      symbol: "BTCUSDT", interval: "1M", candleCount: 1500, trainBars: 600,
      testBars: 120, feeBps: 10, slippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationPct: 1,
      marketImpactBps: 25,
    })).toThrow();
    expect(() => createResearchRunSettings({
      symbol: "BTCUSDT", interval: "1h", candleCount: 500, trainBars: 400,
      testBars: 120, feeBps: 10, slippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationPct: 1,
      marketImpactBps: 25,
    })).toThrow();
    expect(() => createResearchRunSettings({
      symbol: "BTCUSDT", interval: "1h", candleCount: 5000, trainBars: 100,
      testBars: 20, feeBps: 10, slippageBps: 5,
      halfSpreadBps: 2,
      maxParticipationPct: 1,
      marketImpactBps: 25,
    })).toThrow();
  });

  it("includes validated protective stop and target settings in the execution-aware pipeline config", () => {
    const settings = createResearchRunSettings({
      symbol: "BTCUSDT", interval: "1h", candleCount: 1500, trainBars: 600,
      testBars: 120, feeBps: 10, slippageBps: 5, halfSpreadBps: 2,
      maxParticipationPct: 1, marketImpactBps: 25, stopLossPct: 4, takeProfitPct: 8,
    });
    expect(settings.pipeline.backtest.protectiveOrders).toEqual({ stopLossPct: 4, takeProfitPct: 8 });
  });

});