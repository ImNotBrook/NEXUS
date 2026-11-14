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


function validateOhlcArrays(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
): void {
  assertSameLength(high, low, close);
  assertFinite(high, "high");
  assertFinite(low, "low");
  assertFinite(close, "close");
  for (let index = 0; index < high.length; index += 1) {
    if (high[index] < low[index] || close[index] < low[index] || close[index] > high[index]) {
      throw new RangeError("Invalid OHLC values: close must be within high and low");
    }
  }
}

function validateVolume(values: readonly number[]): void {
  assertFinite(values, "volume");
  if (values.some((value) => value < 0)) throw new RangeError("volume cannot be negative");
}

/** Weighted moving average; the newest observation receives the largest weight. */
export function wma(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period);
  assertFinite(values);
  const output: NullableSeries = Array(values.length).fill(null);
  const denominator = (period * (period + 1)) / 2;
  for (let index = period - 1; index < values.length; index += 1) {
    let weighted = 0;
    for (let offset = 0; offset < period; offset += 1) {
      weighted += values[index - period + 1 + offset] * (offset + 1);
    }
    output[index] = weighted / denominator;
  }
  return output;
}

/** Percentage change from the close period observations earlier. */
export function rateOfChange(values: readonly number[], period = 12): NullableSeries {
  assertPeriod(period);
  assertFinite(values);
  const output: NullableSeries = Array(values.length).fill(null);
  for (let index = period; index < values.length; index += 1) {
    const reference = values[index - period];
    if (reference <= 0 || values[index] <= 0) {
      throw new RangeError("Rate of change requires positive prices");
    }
    output[index] = ((values[index] / reference) - 1) * 100;
  }
  return output;
}

export interface StochasticResult {
  k: NullableSeries;
  d: NullableSeries;
}

/** Stochastic %K uses the trailing high/low range; %D is an SMA of %K. */
export function stochastic(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  assertPeriod(kPeriod);
  assertPeriod(dPeriod);
  validateOhlcArrays(high, low, close);
  const k: NullableSeries = Array(close.length).fill(null);
  const d: NullableSeries = Array(close.length).fill(null);
  for (let index = kPeriod - 1; index < close.length; index += 1) {
    const start = index - kPeriod + 1;
    const highest = Math.max(...high.slice(start, index + 1));
    const lowest = Math.min(...low.slice(start, index + 1));
    k[index] = highest === lowest ? 50 : ((close[index] - lowest) / (highest - lowest)) * 100;
    if (index >= kPeriod + dPeriod - 2) {
      const values = k.slice(index - dPeriod + 1, index + 1);
      if (values.every((value): value is number => value !== null)) {
        d[index] = values.reduce((sum, value) => sum + value, 0) / dPeriod;
      }
    }
  }
  return { k, d };
}

/** Commodity Channel Index using mean absolute deviation of typical price. */
export function cci(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 20,
): NullableSeries {
  assertPeriod(period);
  validateOhlcArrays(high, low, close);
  const typical = close.map((value, index) => (high[index] + low[index] + value) / 3);
  const output: NullableSeries = Array(close.length).fill(null);
  for (let index = period - 1; index < typical.length; index += 1) {
    const window = typical.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const meanDeviation = window.reduce((sum, value) => sum + Math.abs(value - mean), 0) / period;
    output[index] = meanDeviation === 0 ? 0 : (typical[index] - mean) / (0.015 * meanDeviation);
  }
  return output;
}

export interface AdxResult {
  adx: NullableSeries;
  plusDI: NullableSeries;
  minusDI: NullableSeries;
}

/** Wilder ADX and directional indicators. ADX first becomes valid after 2*period-1 bars. */
export function adx(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): AdxResult {
  assertPeriod(period);
  validateOhlcArrays(high, low, close);
  const length = close.length;
  const adxValues: NullableSeries = Array(length).fill(null);
  const plusDI: NullableSeries = Array(length).fill(null);
  const minusDI: NullableSeries = Array(length).fill(null);
  if (length <= period) return { adx: adxValues, plusDI, minusDI };

  const trueRanges = Array<number>(length).fill(0);
  const positiveMoves = Array<number>(length).fill(0);
  const negativeMoves = Array<number>(length).fill(0);
  for (let index = 1; index < length; index += 1) {
    const upMove = high[index] - high[index - 1];
    const downMove = low[index - 1] - low[index];
    positiveMoves[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    negativeMoves[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    trueRanges[index] = Math.max(
      high[index] - low[index],
      Math.abs(high[index] - close[index - 1]),
      Math.abs(low[index] - close[index - 1]),
    );
  }

  let smoothedTR = trueRanges.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothedPositive = positiveMoves.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothedNegative = negativeMoves.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  const dx: NullableSeries = Array(length).fill(null);

  for (let index = period; index < length; index += 1) {
    if (index > period) {
      smoothedTR = smoothedTR - smoothedTR / period + trueRanges[index];
      smoothedPositive = smoothedPositive - smoothedPositive / period + positiveMoves[index];
      smoothedNegative = smoothedNegative - smoothedNegative / period + negativeMoves[index];
    }
    const positive = smoothedTR === 0 ? 0 : (smoothedPositive / smoothedTR) * 100;
    const negative = smoothedTR === 0 ? 0 : (smoothedNegative / smoothedTR) * 100;
    plusDI[index] = positive;
    minusDI[index] = negative;
    const denominator = positive + negative;
    dx[index] = denominator === 0 ? 0 : (Math.abs(positive - negative) / denominator) * 100;

    if (index === period * 2 - 1) {
      const initial = dx.slice(period, index + 1) as number[];
      adxValues[index] = initial.reduce((sum, value) => sum + value, 0) / period;
    } else if (index > period * 2 - 1) {
      adxValues[index] = ((adxValues[index - 1]! * (period - 1)) + dx[index]!) / period;
    }
  }
  return { adx: adxValues, plusDI, minusDI };
}

/** On-Balance Volume; the first observation anchors the series at zero. */
export function obv(close: readonly number[], volume: readonly number[]): NullableSeries {
  assertSameLength(close, volume);
  assertFinite(close, "close");
  validateVolume(volume);
  const output: NullableSeries = [];
  let cumulative = 0;
  for (let index = 0; index < close.length; index += 1) {
    if (index > 0) {
      if (close[index] > close[index - 1]) cumulative += volume[index];
      else if (close[index] < close[index - 1]) cumulative -= volume[index];
    }
    output.push(cumulative);
  }
  return output;
}

/** Cumulative anchored VWAP over the supplied input window using typical price. */
export function vwap(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
): NullableSeries {
  validateOhlcArrays(high, low, close);
  assertSameLength(close, volume);
  validateVolume(volume);
  const output: NullableSeries = [];
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  for (let index = 0; index < close.length; index += 1) {
    const typicalPrice = (high[index] + low[index] + close[index]) / 3;
    cumulativeVolume += volume[index];
    cumulativePriceVolume += typicalPrice * volume[index];
    output.push(cumulativeVolume === 0 ? null : cumulativePriceVolume / cumulativeVolume);
  }
  return output;
}

/** Money Flow Index using positive/negative typical-price volume flows. */
export function mfi(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
  period = 14,
): NullableSeries {
  assertPeriod(period);
  validateOhlcArrays(high, low, close);
  assertSameLength(close, volume);
  validateVolume(volume);
  const typical = close.map((value, index) => (high[index] + low[index] + value) / 3);
  const positiveFlow = Array<number>(close.length).fill(0);
  const negativeFlow = Array<number>(close.length).fill(0);
  for (let index = 1; index < close.length; index += 1) {
    const flow = typical[index] * volume[index];
    if (typical[index] > typical[index - 1]) positiveFlow[index] = flow;
    else if (typical[index] < typical[index - 1]) negativeFlow[index] = flow;
  }
  const output: NullableSeries = Array(close.length).fill(null);
  for (let index = period; index < close.length; index += 1) {
    const positive = positiveFlow.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0);
    const negative = negativeFlow.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0);
    if (positive === 0 && negative === 0) output[index] = 50;
    else if (negative === 0) output[index] = 100;
    else if (positive === 0) output[index] = 0;
    else output[index] = 100 - (100 / (1 + positive / negative));
  }
  return output;
}

export interface ChannelResult {
  middle: NullableSeries;
  upper: NullableSeries;
  lower: NullableSeries;
}

/** Donchian channels use the prior period candles and exclude the current candle. */
export function donchianChannels(
  high: readonly number[],
  low: readonly number[],
  period = 20,
): ChannelResult {
  assertPeriod(period);
  assertSameLength(high, low);
  assertFinite(high, "high");
  assertFinite(low, "low");
  if (high.some((value, index) => value < low[index])) throw new RangeError("high cannot be below low");
  const middle: NullableSeries = Array(high.length).fill(null);
  const upper: NullableSeries = Array(high.length).fill(null);
  const lower: NullableSeries = Array(high.length).fill(null);
  for (let index = period; index < high.length; index += 1) {
    const start = index - period;
    const highest = Math.max(...high.slice(start, index));
    const lowest = Math.min(...low.slice(start, index));
    upper[index] = highest;
    lower[index] = lowest;
    middle[index] = (highest + lowest) / 2;
  }
  return { middle, upper, lower };
}

/** Keltner channels centre on EMA and scale their width by Wilder ATR. */
export function keltnerChannels(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  emaPeriod = 20,
  atrPeriod = 10,
  multiplier = 2,
): ChannelResult {
  assertPeriod(emaPeriod);
  assertPeriod(atrPeriod);
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError("multiplier must be a finite non-negative number");
  }
  validateOhlcArrays(high, low, close);
  const middle = ema(close, emaPeriod);
  const ranges = atr(high, low, close, atrPeriod);
  const upper: NullableSeries = Array(close.length).fill(null);
  const lower: NullableSeries = Array(close.length).fill(null);
  for (let index = 0; index < close.length; index += 1) {
    if (middle[index] !== null && ranges[index] !== null) {
      upper[index] = middle[index]! + ranges[index]! * multiplier;
      lower[index] = middle[index]! - ranges[index]! * multiplier;
    }
  }
  return { middle, upper, lower };
}
