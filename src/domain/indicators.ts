type NullableSeries = Array<number | null>;

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
}

function assertFinite(values: readonly number[], label = "values"): void {
  if (!values.every(Number.isFinite)) throw new TypeError(label + " must contain only finite numbers");
}

function assertSameLength(...series: readonly (readonly number[])[]): void {
  if (series.length === 0 || !series.every((values) => values.length === series[0].length)) {
    throw new RangeError("OHLC series must have the same length");
  }
}

export function sma(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period);
  assertFinite(values);
  const output: NullableSeries = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) output[i] = sum / period;
  }
  return output;
}

/** EMA seeded with the first period-sized SMA window. */
export function ema(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period);
  assertFinite(values);
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length < period) return output;
  const alpha = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let i = period; i < values.length; i += 1) {
    current = (values[i] - current) * alpha + current;
    output[i] = current;
  }
  return output;
}

/** Wilder RSI; the first output follows period price changes. */
export function rsi(values: readonly number[], period = 14): NullableSeries {
  assertPeriod(period);
  assertFinite(values);
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const calculate = (): number => {
    if (averageLoss === 0 && averageGain === 0) return 50;
    if (averageLoss === 0) return 100;
    if (averageGain === 0) return 0;
    const rs = averageGain / averageLoss;
    return 100 - 100 / (1 + rs);
  };
  output[period] = calculate();
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[i] = calculate();
  }
  return output;
}

/** Wilder ATR; first true range is high minus low. */
export function atr(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): NullableSeries {
  assertPeriod(period);
  assertSameLength(high, low, close);
  assertFinite(high, "high");
  assertFinite(low, "low");
  assertFinite(close, "close");
  const ranges: number[] = [];
  for (let i = 0; i < high.length; i += 1) {
    if (high[i] < low[i] || close[i] < low[i] || close[i] > high[i]) {
      throw new RangeError("Invalid OHLC values: close must be within high and low");
    }
    const previousClose = i === 0 ? close[i] : close[i - 1];
    ranges.push(Math.max(high[i] - low[i], Math.abs(high[i] - previousClose), Math.abs(low[i] - previousClose)));
  }
  const output: NullableSeries = Array(high.length).fill(null);
  if (ranges.length < period) return output;
  let current = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let i = period; i < ranges.length; i += 1) {
    current = (current * (period - 1) + ranges[i]) / period;
    output[i] = current;
  }
  return output;
}

export interface MacdResult {
  macd: NullableSeries;
  signal: NullableSeries;
  histogram: NullableSeries;
}

export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  assertPeriod(fastPeriod);
  assertPeriod(slowPeriod);
  assertPeriod(signalPeriod);
  if (fastPeriod >= slowPeriod) throw new RangeError("fastPeriod must be less than slowPeriod");
  assertFinite(values);
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line: NullableSeries = values.map((_, i) =>
    fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!,
  );
  const compact = line.filter((value): value is number => value !== null);
  const compactSignal = ema(compact, signalPeriod);
  const signal: NullableSeries = Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== null) {
      signal[i] = compactSignal[j];
      j += 1;
    }
  }
  const histogram = line.map((value, i) =>
    value === null || signal[i] === null ? null : value - signal[i]!,
  );
  return { macd: line, signal, histogram };
}

export interface BollingerBandsResult {
  middle: NullableSeries;
  upper: NullableSeries;
  lower: NullableSeries;
}

/** Bollinger Bands use population standard deviation over the trailing window. */
export function bollingerBands(
  values: readonly number[],
  period = 20,
  deviations = 2,
): BollingerBandsResult {
  assertPeriod(period);
  assertFinite(values);
  if (!Number.isFinite(deviations) || deviations < 0) {
    throw new RangeError("deviations must be a finite non-negative number");
  }
  const middle = sma(values, period);
  const upper: NullableSeries = Array(values.length).fill(null);
  const lower: NullableSeries = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i]!;
    const variance = values.slice(i - period + 1, i + 1)
      .reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const width = deviations * Math.sqrt(variance);
    upper[i] = mean + width;
    lower[i] = mean - width;
  }
  return { middle, upper, lower };
}
