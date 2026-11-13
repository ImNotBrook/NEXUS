import { validateCandles, type Candle } from "./candles";
import { resolveLongProtectiveExit, validateProtectiveExitConfig, type ProtectiveExitConfig } from "./protective-orders";

export type BacktestSignal = "buy" | "sell" | "hold";
export type StrategyEvaluator = (history: readonly Candle[]) => BacktestSignal;

export interface BacktestConfig {
  initialCapital: number;
  feeRate: number;
  slippageBps: number;
  allocationFraction: number;
  /** Number of leading candles used only as strategy context, not traded or reported. */
  warmupBars?: number;
  /** Optional long-only protective exits. Orders become active from the candle after entry. */
  protectiveOrders?: ProtectiveExitConfig;
}

export interface BacktestTrade {
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryFee: number;
  exitFee: number;
  pnl: number;
  pnlPct: number;
  exitReason: "signal" | "stop-loss" | "take-profit";
}

export interface BacktestPosition {
  entryTimestamp: number;
  entryPrice: number;
  quantity: number;
  entryFee: number;
  entryCost: number;
}

export interface BacktestResult {
  startingCapital: number;
  endingEquity: number;
  cash: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  completedTrades: number;
  winRatePct: number;
  totalFees: number;
  trades: BacktestTrade[];
  equityCurve: Array<{ timestamp: number; equity: number; cash: number; positionValue: number }>;
  openPosition: BacktestPosition | null;
}

export function runBacktest(
  inputCandles: readonly Candle[],
  evaluate: StrategyEvaluator,
  config: BacktestConfig,
): BacktestResult {
  const { initialCapital, feeRate, slippageBps, allocationFraction } = config;
  if (config.protectiveOrders) validateProtectiveExitConfig(config.protectiveOrders);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new RangeError("initialCapital must be positive");
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) throw new RangeError("feeRate must be in [0, 1)");
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new RangeError("slippageBps must be in [0, 10000)");
  if (!Number.isFinite(allocationFraction) || allocationFraction <= 0 || allocationFraction > 1) throw new RangeError("allocationFraction must be in (0, 1]");

  const candles = validateCandles(inputCandles);
  const warmupBars = config.warmupBars ?? 0;
  if (!Number.isSafeInteger(warmupBars) || warmupBars < 0 || warmupBars > candles.length ||
      (candles.length > 0 && warmupBars === candles.length)) {
    throw new RangeError("warmupBars must be a non-negative integer smaller than the candle count");
  }
  if (candles.some((candle) => candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0)) {
    throw new RangeError("Spot backtests require strictly positive OHLC prices");
  }

  let cash = initialCapital;
  let position: BacktestPosition | null = null;
  let entryIndex = -1;
  let pending: BacktestSignal = "hold";
  let totalFees = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestResult["equityCurve"] = [];
  const slippage = slippageBps / 10_000;

  const closePosition = (
    timestamp: number,
    referencePrice: number,
    reason: BacktestTrade["exitReason"],
    applyAdverseSlippage: boolean,
  ): void => {
    if (!position) return;
    const fillPrice = referencePrice * (applyAdverseSlippage ? 1 - slippage : 1);
    const notional = position.quantity * fillPrice;
    const exitFee = notional * feeRate;
    const pnl = notional - exitFee - position.entryCost;
    cash += notional - exitFee;
    totalFees += exitFee;
    trades.push({
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: timestamp,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      quantity: position.quantity,
      entryFee: position.entryFee,
      exitFee,
      pnl,
      pnlPct: (pnl / position.entryCost) * 100,
      exitReason: reason,
    });
    position = null;
    entryIndex = -1;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];

    // Warm-up candles establish historical context but cannot generate or fill test trades.
    if (i >= warmupBars && pending === "buy" && position === null) {
      const fillPrice = candle.open * (1 + slippage);
      const budget = Math.min(cash, cash * allocationFraction);
      const quantity = budget / (fillPrice * (1 + feeRate));
      if (quantity > 0 && Number.isFinite(quantity)) {
        const notional = quantity * fillPrice;
        const fee = notional * feeRate;
        const entryCost = notional + fee;
        cash -= entryCost;
        totalFees += fee;
        position = { entryTimestamp: candle.timestamp, entryPrice: fillPrice, quantity, entryFee: fee, entryCost };
        entryIndex = i;
      }
    } else if (i >= warmupBars && pending === "sell" && position !== null) {
      // A close-generated strategy exit is already queued for this opening auction.
      closePosition(candle.timestamp, candle.open, "signal", true);
    } else if (i >= warmupBars && position !== null && entryIndex < i && config.protectiveOrders) {
      // Never inspect the entry candle's high/low: entry occurs at its open and intrabar
      // ordering is unknown. Protective orders become active on the following candle.
      const protectiveExit = resolveLongProtectiveExit(position.entryPrice, candle, config.protectiveOrders);
      if (protectiveExit) {
        closePosition(
          candle.timestamp,
          protectiveExit.referencePrice,
          protectiveExit.reason,
          protectiveExit.reason === "stop-loss",
        );
      }
    }
    pending = "hold";

    if (i >= warmupBars) {
      const positionValue = position ? position.quantity * candle.close : 0;
      const equity = cash + positionValue;
      equityCurve.push({ timestamp: candle.timestamp, equity, cash, positionValue });

      // The strategy receives only candles through the current close; future bars are inaccessible.
      const history = candles.slice(0, i + 1).map((item) => Object.freeze({ ...item }));
      const signal = evaluate(Object.freeze(history));
      if (signal !== "buy" && signal !== "sell" && signal !== "hold") {
        throw new TypeError("Strategy returned an invalid signal");
      }
      pending = signal;
    } else {
      pending = "hold";
    }
  }

  const endingEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }
  const winners = trades.filter((trade) => trade.pnl > 0).length;

  return {
    startingCapital: initialCapital,
    endingEquity,
    cash,
    totalReturnPct: ((endingEquity - initialCapital) / initialCapital) * 100,
    maxDrawdownPct,
    completedTrades: trades.length,
    winRatePct: trades.length ? (winners / trades.length) * 100 : 0,
    totalFees,
    trades,
    equityCurve,
    openPosition: position,
  };
}
