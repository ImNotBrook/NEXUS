import { ema, rsi, sma } from "../domain/indicators";
import type { ResearchCandidate } from "../domain/research-pipeline";
import type { Candle } from "../domain/candles";

export type ComposedTrigger =
  | { type: "sma_cross"; fastPeriod: number; slowPeriod: number }
  | { type: "rsi_recovery"; period: number; oversold: number }
  | { type: "donchian_breakout"; period: number };
export type ComposedConfirmation = { type: "ema_alignment"; fastPeriod: number; slowPeriod: number };
export type ComposedExit =
  | { type: "opposite_sma_cross"; fastPeriod: number; slowPeriod: number }
  | { type: "rsi_overbought"; period: number; threshold: number }
  | { type: "close_below_sma"; period: number };

export interface ComposedStrategySpecification {
  schemaVersion: 1; id: string; name: string; marketHypothesis: string;
  regimeScope: "uptrend" | "downtrend" | "range" | "any"; timeframe: "1h";
  entry: { trigger: ComposedTrigger; confirmations: ComposedConfirmation[] };
  exit: ComposedExit; invalidation: string;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function exactKeys(v: Record<string, unknown>, keys: string[], label: string): void {
  const a = Object.keys(v).sort(), e = [...keys].sort();
  if (a.length !== e.length || a.some((k, i) => k !== e[i])) throw new TypeError(label + " contains missing or unsupported fields");
}
function integer(v: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) throw new RangeError(label + " is outside permitted bounds");
  return v as number;
}
function prose(v: unknown, label: string, max = 400): string {
  if (typeof v !== "string" || v.trim().length < 20 || v.length > max) throw new TypeError(label + " must contain 20–" + max + " characters");
  return v.trim();
}
function parseTrigger(v: unknown): ComposedTrigger {
  if (!isRecord(v) || typeof v.type !== "string") throw new TypeError("Invalid entry trigger");
  if (v.type === "sma_cross") {
    exactKeys(v, ["type", "fastPeriod", "slowPeriod"], "SMA trigger");
    const fastPeriod = integer(v.fastPeriod, 2, 30, "SMA fastPeriod"), slowPeriod = integer(v.slowPeriod, 5, 100, "SMA slowPeriod");
    if (fastPeriod >= slowPeriod) throw new RangeError("SMA fastPeriod must be less than slowPeriod");
    return { type: v.type, fastPeriod, slowPeriod };
  }
  if (v.type === "rsi_recovery") {
    exactKeys(v, ["type", "period", "oversold"], "RSI trigger");
    return { type: v.type, period: integer(v.period, 5, 50, "RSI period"), oversold: integer(v.oversold, 10, 40, "RSI oversold") };
  }
  if (v.type === "donchian_breakout") {
    exactKeys(v, ["type", "period"], "Donchian trigger");
    return { type: v.type, period: integer(v.period, 5, 100, "Donchian period") };
  }
  throw new TypeError("Unsupported entry trigger");
}
function parseConfirmation(v: unknown): ComposedConfirmation {
  if (!isRecord(v) || v.type !== "ema_alignment") throw new TypeError("Unsupported confirmation filter");
  exactKeys(v, ["type", "fastPeriod", "slowPeriod"], "EMA confirmation");
  const fastPeriod = integer(v.fastPeriod, 2, 30, "EMA fastPeriod"), slowPeriod = integer(v.slowPeriod, 5, 100, "EMA slowPeriod");
  if (fastPeriod >= slowPeriod) throw new RangeError("EMA fastPeriod must be less than slowPeriod");
  return { type: "ema_alignment", fastPeriod, slowPeriod };
}
function parseExit(v: unknown): ComposedExit {
  if (!isRecord(v) || typeof v.type !== "string") throw new TypeError("Invalid exit rule");
  if (v.type === "opposite_sma_cross") {
    exactKeys(v, ["type", "fastPeriod", "slowPeriod"], "SMA exit");
    const fastPeriod = integer(v.fastPeriod, 2, 30, "Exit SMA fastPeriod"), slowPeriod = integer(v.slowPeriod, 5, 100, "Exit SMA slowPeriod");
    if (fastPeriod >= slowPeriod) throw new RangeError("Exit SMA fastPeriod must be less than slowPeriod");
    return { type: v.type, fastPeriod, slowPeriod };
  }
  if (v.type === "rsi_overbought") {
    exactKeys(v, ["type", "period", "threshold"], "RSI exit");
    return { type: v.type, period: integer(v.period, 5, 50, "Exit RSI period"), threshold: integer(v.threshold, 60, 90, "RSI threshold") };
  }
  if (v.type === "close_below_sma") {
    exactKeys(v, ["type", "period"], "SMA exit");
    return { type: v.type, period: integer(v.period, 5, 100, "Exit SMA period") };
  }
  throw new TypeError("Unsupported exit rule");
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v); for (const child of Object.values(v as Record<string, unknown>)) freeze(child);
  }
  return v;
}
/** Strict external boundary: only the versioned rule DSL is accepted; no source code is executable. */
export function parseComposedStrategy(input: unknown): Readonly<ComposedStrategySpecification> {
  if (!isRecord(input)) throw new TypeError("Composed strategy must be an object");
  exactKeys(input, ["schemaVersion", "id", "name", "marketHypothesis", "regimeScope", "timeframe", "entry", "exit", "invalidation"], "Strategy");
  if (input.schemaVersion !== 1 || input.timeframe !== "1h" || !["uptrend", "downtrend", "range", "any"].includes(String(input.regimeScope))) throw new TypeError("Unsupported schema, timeframe or regime scope");
  if (typeof input.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)) throw new TypeError("Strategy ID must be lowercase kebab-case");
  if (!isRecord(input.entry)) throw new TypeError("Entry rules are invalid");
  exactKeys(input.entry, ["trigger", "confirmations"], "Entry rules");
  if (!Array.isArray(input.entry.confirmations) || input.entry.confirmations.length > 2) throw new RangeError("At most two confirmation filters are allowed");
  const parsed: ComposedStrategySpecification = {
    schemaVersion: 1, id: input.id, name: prose(input.name, "Name", 80),
    marketHypothesis: prose(input.marketHypothesis, "Market hypothesis"),
    regimeScope: input.regimeScope as ComposedStrategySpecification["regimeScope"], timeframe: "1h",
    entry: { trigger: parseTrigger(input.entry.trigger), confirmations: input.entry.confirmations.map(parseConfirmation) },
    exit: parseExit(input.exit), invalidation: prose(input.invalidation, "Invalidation"),
  };
  return freeze(parsed);
}
function series(history: readonly Candle[]) {
  return { close: history.map(c => c.close), high: history.map(c => c.high) };
}
function trigger(history: readonly Candle[], rule: ComposedTrigger): boolean {
  const s = series(history), i = history.length - 1;
  if (rule.type === "sma_cross") {
    const f = sma(s.close, rule.fastPeriod), slow = sma(s.close, rule.slowPeriod);
    return i > 0 && f[i - 1] !== null && slow[i - 1] !== null && f[i] !== null && slow[i] !== null && f[i - 1]! <= slow[i - 1]! && f[i]! > slow[i]!;
  }
  if (rule.type === "rsi_recovery") {
    const r = rsi(s.close, rule.period);
    return i > 0 && r[i - 1] !== null && r[i] !== null && r[i - 1]! <= rule.oversold && r[i]! > rule.oversold;
  }
  if (i < rule.period) return false;
  return history[i].close > Math.max(...s.high.slice(i - rule.period, i));
}
function confirms(history: readonly Candle[], filters: readonly ComposedConfirmation[]): boolean {
  const close = history.map(c => c.close), i = close.length - 1;
  return filters.every(f => {
    const fast = ema(close, f.fastPeriod)[i], slow = ema(close, f.slowPeriod)[i];
    return fast !== null && slow !== null && fast > slow;
  });
}
function exits(history: readonly Candle[], rule: ComposedExit): boolean {
  const close = history.map(c => c.close), i = close.length - 1;
  if (rule.type === "close_below_sma") {
    const average = sma(close, rule.period)[i]; return average !== null && close[i] < average;
  }
  if (rule.type === "rsi_overbought") {
    const value = rsi(close, rule.period)[i]; return value !== null && value >= rule.threshold;
  }
  const fast = sma(close, rule.fastPeriod), slow = sma(close, rule.slowPeriod);
  return i > 0 && fast[i - 1] !== null && slow[i - 1] !== null && fast[i] !== null && slow[i] !== null && fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!;
}
/** Long-only evaluator; signals are evaluated at close and the existing backtester fills next open. */
export function compileComposedStrategy(spec: Readonly<ComposedStrategySpecification>): ResearchCandidate {
  const s = parseComposedStrategy(spec);
  return {
    id: "ai-composed-" + s.id + "-v1",
    name: s.name + " [regime: " + s.regimeScope + "]",
    fit: () => history => {
      if (history.length < 2) return "hold";
      if (exits(history, s.exit)) return "sell";
      return trigger(history, s.entry.trigger) && confirms(history, s.entry.confirmations) ? "buy" : "hold";
    },
  };
}
