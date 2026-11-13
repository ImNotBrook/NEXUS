export interface Candle {
  /** Unix timestamp in milliseconds, aligned to the source interval. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Validate untrusted OHLCV without sorting or mutating it. */
export function validateCandles(input: readonly Candle[]): Candle[] {
  if (!Array.isArray(input)) throw new TypeError("Candles must be an array");
  let previousTimestamp = -1;
  const validated: Candle[] = [];
  for (const candle of input) {
    if (!candle || !Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0) {
      throw new RangeError("timestamp must be a non-negative safe integer in milliseconds");
    }
    if (candle.timestamp <= previousTimestamp) {
      throw new RangeError("Candle timestamps must be strictly increasing");
    }
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite)) throw new TypeError("OHLCV values must all be finite numbers");
    if (candle.volume < 0) throw new RangeError("volume cannot be negative");
    if (
      candle.high < candle.low ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)
    ) {
      throw new RangeError("Invalid OHLC relationship: high/low do not contain open and close");
    }
    validated.push({ ...candle });
    previousTimestamp = candle.timestamp;
  }
  return validated;
}
