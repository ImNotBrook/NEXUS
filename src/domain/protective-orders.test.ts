import { describe, expect, it } from "vitest";
import { resolveLongProtectiveExit, type ProtectiveExitConfig } from "./protective-orders";
import type { Candle } from "./candles";

const candle = (open: number, high: number, low: number): Candle => ({
  timestamp: 2, open, high, low, close: open, volume: 1,
});
const orders: ProtectiveExitConfig = { stopLossPct: 5, takeProfitPct: 10 };

describe("resolveLongProtectiveExit", () => {
  it("triggers a stop at its level when traded through intrabar", () => {
    expect(resolveLongProtectiveExit(100, candle(100, 103, 94), orders))
      .toEqual({ reason: "stop-loss", referencePrice: 95 });
  });

  it("fills a gap below the stop at the worse opening price", () => {
    expect(resolveLongProtectiveExit(100, candle(90, 92, 88), orders))
      .toEqual({ reason: "stop-loss", referencePrice: 90 });
  });

  it("triggers a take-profit at its limit when reached intrabar", () => {
    expect(resolveLongProtectiveExit(100, candle(101, 112, 99), orders))
      .toEqual({ reason: "take-profit", referencePrice: 110 });
  });

  it("gives a marketable take-profit limit price improvement on a gap up", () => {
    expect(resolveLongProtectiveExit(100, candle(115, 117, 111), orders))
      .toEqual({ reason: "take-profit", referencePrice: 115 });
  });

  it("chooses the adverse stop when both levels are touched intrabar", () => {
    expect(resolveLongProtectiveExit(100, candle(100, 112, 94), orders))
      .toEqual({ reason: "stop-loss", referencePrice: 95 });
  });

  it("resolves an opening gap before considering later intrabar movement", () => {
    expect(resolveLongProtectiveExit(100, candle(90, 115, 88), orders))
      .toEqual({ reason: "stop-loss", referencePrice: 90 });
  });

  it("returns null when neither protective level is reached", () => {
    expect(resolveLongProtectiveExit(100, candle(100, 104, 97), orders)).toBeNull();
  });

  it("rejects invalid entry prices and protective percentages", () => {
    expect(() => resolveLongProtectiveExit(0, candle(100, 101, 99), orders)).toThrow();
    expect(() => resolveLongProtectiveExit(100, candle(100, 101, 99), { stopLossPct: 100 })).toThrow();
    expect(() => resolveLongProtectiveExit(100, candle(100, 101, 99), { takeProfitPct: 0 })).toThrow();
    expect(() => resolveLongProtectiveExit(100, candle(100, 101, 99), {})).toThrow();
  });
});
