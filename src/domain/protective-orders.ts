import type { Candle } from "./candles";

export interface ProtectiveExitConfig {
  /** Stop distance below the long entry price, expressed as a percentage. */
  stopLossPct?: number;
  /** Take-profit distance above the long entry price, expressed as a percentage. */
  takeProfitPct?: number;
}

export interface ProtectiveExit {
  reason: "stop-loss" | "take-profit";
  /** Reference fill before any stop-market adverse slippage. */
  referencePrice: number;
}

/**
 * Resolve a long spot position's protective exit from one OHLC candle.
 *
 * Opening gaps are resolved first. A stop-market order fills at the opening
 * price when the market gaps through it. A take-profit limit receives the
 * opening price when it gaps above the limit. If both levels are touched
 * intrabar and OHLC cannot reveal the path, the adverse stop is selected.
 */
export function validateProtectiveExitConfig(config: ProtectiveExitConfig): void {
  const hasStop = config.stopLossPct !== undefined;
  const hasTarget = config.takeProfitPct !== undefined;
  if (!hasStop && !hasTarget) {
    throw new RangeError("At least one protective order must be configured");
  }
  if (hasStop && (!Number.isFinite(config.stopLossPct) || config.stopLossPct! <= 0 || config.stopLossPct! >= 100)) {
    throw new RangeError("stopLossPct must be in (0, 100)");
  }
  if (hasTarget && (!Number.isFinite(config.takeProfitPct) || config.takeProfitPct! <= 0)) {
    throw new RangeError("takeProfitPct must be positive");
  }
}

export function resolveLongProtectiveExit(
  entryPrice: number,
  candle: Candle,
  config: ProtectiveExitConfig,
): ProtectiveExit | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new RangeError("entryPrice must be positive");
  }
  validateProtectiveExitConfig(config);

  const stop = config.stopLossPct !== undefined ? entryPrice - (entryPrice * config.stopLossPct) / 100 : null;
  const target = config.takeProfitPct !== undefined ? entryPrice + (entryPrice * config.takeProfitPct) / 100 : null;

  // Opening gaps are observable before the rest of the candle's range.
  if (stop !== null && candle.open <= stop) {
    return { reason: "stop-loss", referencePrice: candle.open };
  }
  if (target !== null && candle.open >= target) {
    return { reason: "take-profit", referencePrice: candle.open };
  }

  const stopTouched = stop !== null && candle.low <= stop;
  const targetTouched = target !== null && candle.high >= target;

  // Intrabar path is unknowable from OHLC; assume the adverse order happened first.
  if (stopTouched) return { reason: "stop-loss", referencePrice: stop };
  if (targetTouched) return { reason: "take-profit", referencePrice: target };
  return null;
}
