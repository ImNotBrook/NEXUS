import { describe, expect, it } from "vitest";
import { createPaperAccount, executePaperMarketOrder, markPaperAccount, normalizePaperAccountSnapshot } from "./paper-broker";

describe("paper broker", () => {
  const timestamp = Date.UTC(2026, 0, 1);
  it("starts with an isolated 10,000 USDT simulated account", () => {
    const account = createPaperAccount({}, timestamp);
    expect(account.cash).toBe(10_000);
    expect(account.initialCash).toBe(10_000);
    expect(account.fills).toHaveLength(0);
  });

  it("normalizes a legacy paper backup that predates open-order persistence", () => {
    const legacy = { ...createPaperAccount({}, timestamp) } as Record<string, unknown>;
    delete legacy.openOrders;
    const normalized = normalizePaperAccountSnapshot(legacy);
    expect(normalized.openOrders).toEqual([]);
  });

  it("does not repair invalid legacy positions or fills while normalizing", () => {
    const legacy = { ...createPaperAccount({}, timestamp), positions: null };
    delete (legacy as unknown as Record<string, unknown>).openOrders;
    expect(() => normalizePaperAccountSnapshot(legacy)).toThrow(/positions, fills or open orders/i);
  });

  it("applies adverse slippage and fees to a buy fill", () => {
    const account = createPaperAccount({ feeRate: 0.001, slippageRate: 0.002, maxPositionValueFraction: 0.9 }, timestamp);
    const result = executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.1, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1, 12),
    });
    expect(result.fills[0].price).toBeCloseTo(50_100);
    expect(result.fills[0].fee).toBeCloseTo(5.01);
    expect(result.cash).toBeCloseTo(4_984.99);
    expect(result.positions.BTCUSDT.quantity).toBe(0.1);
  });

  it("rejects a buy that exceeds the per-position allocation cap", () => {
    const account = createPaperAccount({ maxPositionValueFraction: 0.2 }, timestamp);
    expect(() => executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.05, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    })).toThrow(/allocation limit/i);
  });

  it("rejects overspending including fees and slippage", () => {
    const account = createPaperAccount({ feeRate: 0.06, slippageRate: 0, maxPositionValueFraction: 1 }, timestamp);
    expect(() => executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.2, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    })).toThrow(/insufficient cash/i);
  });

  it("enforces the allocation cap across repeated buys in one symbol", () => {
    const account = createPaperAccount({ maxPositionValueFraction: 0.25 }, timestamp);
    const first = executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.04, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    });
    expect(() => executePaperMarketOrder(first, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.02, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1, 1),
    })).toThrow(/allocation limit/i);
  });

  it("allows risk-reducing sells after the daily loss limit is breached", () => {
    const account = createPaperAccount({ maxDailyLossFraction: 0.02, maxPositionValueFraction: 0.9 }, timestamp);
    const bought = executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.1, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    });
    const stressed = markPaperAccount(bought, { BTCUSDT: 39_000 }, Date.UTC(2026, 0, 1, 2));
    const exited = executePaperMarketOrder(stressed, {
      symbol: "BTCUSDT", side: "sell", quantity: 0.1, referencePrice: 39_000,
      timestamp: Date.UTC(2026, 0, 1, 3),
    });
    expect(exited.positions.BTCUSDT).toBeUndefined();
  });

  it("rejects sells larger than the open position", () => {
    const account = createPaperAccount({}, timestamp);
    expect(() => executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "sell", quantity: 1, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    })).toThrow(/insufficient position/i);
  });

  it("realizes P&L and charges fees on both sides", () => {
    const config = { feeRate: 0.001, slippageRate: 0, maxPositionValueFraction: 0.9 };
    const bought = executePaperMarketOrder(createPaperAccount(config, timestamp), {
      symbol: "BTCUSDT", side: "buy", quantity: 0.1, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    });
    const sold = executePaperMarketOrder(bought, {
      symbol: "BTCUSDT", side: "sell", quantity: 0.1, referencePrice: 51_000,
      timestamp: Date.UTC(2026, 0, 1, 1),
    });
    expect(sold.positions.BTCUSDT).toBeUndefined();
    expect(sold.fills).toHaveLength(2);
    expect(sold.realizedPnl).toBeCloseTo(89.9);
  });

  it("blocks new orders after the configured daily drawdown limit", () => {
    const account = createPaperAccount({ maxDailyLossFraction: 0.02, maxPositionValueFraction: 0.9 }, timestamp);
    const bought = executePaperMarketOrder(account, {
      symbol: "BTCUSDT", side: "buy", quantity: 0.1, referencePrice: 50_000,
      timestamp: Date.UTC(2026, 0, 1),
    });
    const stressed = markPaperAccount(bought, { BTCUSDT: 39_000 }, Date.UTC(2026, 0, 1, 2));
    expect(() => executePaperMarketOrder(stressed, {
      symbol: "ETHUSDT", side: "buy", quantity: 0.1, referencePrice: 1_000,
      timestamp: Date.UTC(2026, 0, 1, 3),
    })).toThrow(/daily loss limit/i);
  });

  it("rejects invalid prices, quantities and symbols", () => {
    const account = createPaperAccount({}, timestamp);
    const base = { symbol: "BTCUSDT", side: "buy" as const, quantity: 0.1, referencePrice: 50_000, timestamp: 1 };
    expect(() => executePaperMarketOrder(account, { ...base, quantity: 0 })).toThrow();
    expect(() => executePaperMarketOrder(account, { ...base, referencePrice: -1 })).toThrow();
    expect(() => executePaperMarketOrder(account, { ...base, symbol: "BTC/USDT" })).toThrow();
  });
});
