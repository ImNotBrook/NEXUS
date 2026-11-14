export type IndicatorCategory =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "market_structure"
  | "derivatives"
  | "breadth"
  | "sentiment";

export type IndicatorImplementation = "implemented" | "planned";
export type TrendContext = "uptrend" | "downtrend" | "range" | "unknown";
export type VolatilityContext = "low" | "normal" | "high" | "unknown";

export interface IndicatorDefinition {
  id: string;
  name: string;
  category: IndicatorCategory;
  implementation: IndicatorImplementation;
  purpose: string;
  inputs: Array<"close" | "high" | "low" | "volume" | "open_interest" | "funding" | "market_universe" | "news">;
  bestIn: string[];
  usefulWhen: string[];
  avoidWhen: string[];
  interpretation: string;
  limitations: string[];
  redundancyGroup: string;
  defaultParameters?: Record<string, number>;
}

export interface IndicatorRecommendationContext {
  trend: TrendContext;
  volatility: VolatilityContext;
}

export interface IndicatorRecommendation {
  indicator: IndicatorDefinition;
  relevance: "primary" | "supporting";
  rationale: string;
}

/**
 * Research reference catalogue. "planned" entries are educational metadata only:
 * they must not be selected for computation until a tested implementation exists.
 * The catalogue never emits trading signals or changes risk permissions.
 */
export const INDICATOR_CATALOGUE: readonly IndicatorDefinition[] = [
  {
    id: "sma", name: "Simple Moving Average", category: "trend", implementation: "implemented",
    purpose: "Smooth price and identify the direction and persistence of a trend.",
    inputs: ["close"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Trend direction confirmation", "Dynamic support/resistance hypotheses", "Slow regime context"],
    avoidWhen: ["Very short horizons where lag dominates", "Choppy ranges when used as a standalone crossover"],
    interpretation: "Price above a rising SMA supports bullish trend context; below a falling SMA supports bearish context. Crossovers are lagging observations.",
    limitations: ["Lag increases with period", "Repeated moving-average variants are highly correlated"],
    redundancyGroup: "moving_average", defaultParameters: { period: 20 },
  },
  {
    id: "ema", name: "Exponential Moving Average", category: "trend", implementation: "implemented",
    purpose: "Weight recent prices more heavily to track trend changes faster than SMA.",
    inputs: ["close"], bestIn: ["uptrend", "downtrend"],
    usefulWhen: ["Trend direction and pullback context", "Fast/slow trend filters", "Regime classification"],
    avoidWhen: ["Sideways markets without an independent filter", "Treating a crossover as predictive by itself"],
    interpretation: "Fast EMA above slow EMA indicates positive trend alignment; the spread measures separation.",
    limitations: ["Lagging and whipsaw-prone in ranges", "Results depend on initialization and period choices"],
    redundancyGroup: "moving_average", defaultParameters: { fastPeriod: 20, slowPeriod: 50 },
  },
  {
    id: "rsi", name: "Relative Strength Index", category: "momentum", implementation: "implemented",
    purpose: "Measure recent directional momentum on a bounded 0–100 scale.",
    inputs: ["close"], bestIn: ["range", "uptrend", "downtrend"],
    usefulWhen: ["Mean-reversion hypotheses in ranges", "Momentum persistence/divergence research", "Trend pullback context"],
    avoidWhen: ["Blindly fading overbought/oversold readings in strong trends", "Treating 70/30 as universal thresholds"],
    interpretation: "In ranges, extreme readings can identify stretched conditions; in trends, RSI can remain elevated or depressed.",
    limitations: ["Thresholds are regime-dependent", "Price-only and vulnerable to persistent trends"],
    redundancyGroup: "bounded_momentum", defaultParameters: { period: 14 },
  },
  {
    id: "atr", name: "Average True Range", category: "volatility", implementation: "implemented",
    purpose: "Measure absolute realized range including gaps; ATR/price provides a normalized volatility proxy.",
    inputs: ["high", "low", "close"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Volatility regime classification", "Volatility-scaled stops and position sizing research", "Comparing realized range through time"],
    avoidWhen: ["Comparing raw ATR across differently priced assets", "Interpreting ATR as direction"],
    interpretation: "Rising ATR indicates expanding realized range; falling ATR indicates contraction. ATR has no directional sign.",
    limitations: ["Backward-looking", "Not implied volatility or a liquidity measure"],
    redundancyGroup: "realized_volatility", defaultParameters: { period: 14 },
  },
  {
    id: "macd", name: "Moving Average Convergence Divergence", category: "momentum", implementation: "implemented",
    purpose: "Measure trend momentum using the difference between fast and slow EMAs and its signal line.",
    inputs: ["close"], bestIn: ["uptrend", "downtrend"],
    usefulWhen: ["Trend momentum confirmation", "Momentum acceleration/deceleration research"],
    avoidWhen: ["Range-bound markets without a trend filter", "Combining multiple near-identical moving-average signals"],
    interpretation: "MACD above zero indicates fast EMA above slow EMA; histogram tracks the MACD/signal-line difference.",
    limitations: ["Lagging", "Strongly correlated with EMA crossover features"],
    redundancyGroup: "moving_average_momentum", defaultParameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  },
  {
    id: "bollinger_bands", name: "Bollinger Bands", category: "volatility", implementation: "implemented",
    purpose: "Describe price dispersion around a moving average and identify volatility expansion/contraction.",
    inputs: ["close"], bestIn: ["range", "uptrend", "downtrend"],
    usefulWhen: ["Range extension and reversion research", "Volatility squeeze/expansion context", "Relative price location"],
    avoidWhen: ["Assuming an upper-band touch means sell or lower-band touch means buy", "Ignoring trend regime"],
    interpretation: "Band width represents rolling dispersion; price outside a band can persist during strong trends.",
    limitations: ["Band touches are not reversal signals", "Sensitive to period and deviation settings"],
    redundancyGroup: "band_volatility", defaultParameters: { period: 20, deviations: 2 },
  },
  {
    id: "adx", name: "Average Directional Index", category: "trend", implementation: "planned",
    purpose: "Estimate trend strength without specifying direction.",
    inputs: ["high", "low", "close"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Distinguishing trend-following from range strategies", "Filtering weak directional moves"],
    avoidWhen: ["Using ADX directionally", "Treating conventional thresholds as universal"],
    interpretation: "Higher ADX suggests stronger directional movement; +DI/-DI provide directional context.",
    limitations: ["Lagging", "Can rise during sharp two-sided volatility"],
    redundancyGroup: "trend_strength", defaultParameters: { period: 14 },
  },
  {
    id: "stochastic", name: "Stochastic Oscillator", category: "momentum", implementation: "planned",
    purpose: "Locate the close within its recent high-low range.",
    inputs: ["high", "low", "close"], bestIn: ["range"],
    usefulWhen: ["Range rotation and momentum turning-point research"],
    avoidWhen: ["Fading extremes in strong trends", "Using it alongside many correlated oscillators"],
    interpretation: "Values near the range extremes indicate close location, not guaranteed reversal.",
    limitations: ["Whipsaws in noisy markets", "Range-window sensitivity"],
    redundancyGroup: "bounded_momentum", defaultParameters: { period: 14, smoothK: 3, smoothD: 3 },
  },
  {
    id: "cci", name: "Commodity Channel Index", category: "momentum", implementation: "planned",
    purpose: "Measure deviation from a rolling typical-price mean.",
    inputs: ["high", "low", "close"], bestIn: ["range", "uptrend", "downtrend"],
    usefulWhen: ["Cyclical deviations and momentum regime research"],
    avoidWhen: ["Treating ±100 as universal reversal levels"],
    interpretation: "Large positive/negative values indicate price unusually far from its rolling mean.",
    limitations: ["Unbounded scale", "Sensitive to period and market distribution"],
    redundancyGroup: "unbounded_momentum", defaultParameters: { period: 20 },
  },
  {
    id: "roc", name: "Rate of Change", category: "momentum", implementation: "planned",
    purpose: "Measure percentage price change over a fixed lookback.",
    inputs: ["close"], bestIn: ["uptrend", "downtrend"],
    usefulWhen: ["Momentum ranking", "Acceleration and relative-strength research"],
    avoidWhen: ["Ignoring volatility and asset-specific scale"],
    interpretation: "Positive ROC indicates price above its lookback reference; negative indicates below.",
    limitations: ["Sensitive to lookback endpoints", "Can be dominated by one-off jumps"],
    redundancyGroup: "price_momentum", defaultParameters: { period: 12 },
  },
  {
    id: "obv", name: "On-Balance Volume", category: "volume", implementation: "planned",
    purpose: "Accumulate volume signed by close-to-close direction as a crude participation proxy.",
    inputs: ["close", "volume"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Price/volume confirmation", "Accumulation/distribution divergence research"],
    avoidWhen: ["Comparing absolute values across venues or instruments", "Using inconsistent volume units"],
    interpretation: "A rising OBV can confirm positive directional volume; divergence is a hypothesis to test.",
    limitations: ["Venue-specific volume", "Direction is assigned to the entire candle volume"],
    redundancyGroup: "volume_flow", defaultParameters: {},
  },
  {
    id: "vwap", name: "Volume Weighted Average Price", category: "volume", implementation: "planned",
    purpose: "Estimate volume-weighted traded price over a defined session or anchor.",
    inputs: ["high", "low", "close", "volume"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Intraday execution context", "Anchored fair-value and mean-reversion research"],
    avoidWhen: ["Using arbitrary session boundaries for 24/7 crypto without defining them", "Assuming venue VWAP is global fair value"],
    interpretation: "Price relative to VWAP describes location against the chosen session/anchor's volume-weighted mean.",
    limitations: ["Anchor/session definition matters", "Candle-based VWAP is an approximation"],
    redundancyGroup: "volume_price", defaultParameters: {},
  },
  {
    id: "mfi", name: "Money Flow Index", category: "volume", implementation: "planned",
    purpose: "Combine typical-price direction and volume into a bounded money-flow oscillator.",
    inputs: ["high", "low", "close", "volume"], bestIn: ["range"],
    usefulWhen: ["Volume-confirmed range momentum research"],
    avoidWhen: ["Using unreliable or fragmented volume", "Treating extreme values as automatic reversals"],
    interpretation: "High/low readings indicate strong positive/negative money flow over the window.",
    limitations: ["Volume quality is venue-dependent", "Correlated with RSI and other oscillators"],
    redundancyGroup: "bounded_momentum", defaultParameters: { period: 14 },
  },
  {
    id: "donchian_channels", name: "Donchian Channels", category: "market_structure", implementation: "planned",
    purpose: "Track the highest high and lowest low over a prior rolling window.",
    inputs: ["high", "low"], bestIn: ["uptrend", "downtrend", "low_volatility"],
    usefulWhen: ["Breakout and range-expansion hypotheses", "Mechanical trailing-channel research"],
    avoidWhen: ["Including the current candle in the breakout reference", "Ignoring false-breakout risk in ranges"],
    interpretation: "A close beyond the prior channel is a breakout observation; channel width describes recent range.",
    limitations: ["Breakouts can fail", "Lookback selection can overfit"],
    redundancyGroup: "price_channels", defaultParameters: { period: 20 },
  },
  {
    id: "keltner_channels", name: "Keltner Channels", category: "volatility", implementation: "planned",
    purpose: "Create an EMA-centred channel scaled by ATR.",
    inputs: ["high", "low", "close"], bestIn: ["uptrend", "downtrend", "low_volatility"],
    usefulWhen: ["Volatility-adjusted trend channels", "Squeeze comparisons with Bollinger Bands"],
    avoidWhen: ["Treating channel breaks as standalone signals"],
    interpretation: "Channel width scales with ATR; price outside a band indicates movement relative to recent range.",
    limitations: ["Lagging", "Shares inputs with ATR and EMA"],
    redundancyGroup: "band_volatility", defaultParameters: { emaPeriod: 20, atrPeriod: 10, multiplier: 2 },
  },
  {
    id: "funding_rate", name: "Perpetual Funding Rate", category: "derivatives", implementation: "planned",
    purpose: "Measure periodic payments between perpetual futures longs and shorts as a positioning/crowding proxy.",
    inputs: ["funding"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Perpetual positioning and crowding context", "Basis/carry research"],
    avoidWhen: ["Treating positive funding as a short signal", "Ignoring venue, contract and settlement interval"],
    interpretation: "Positive funding generally means longs pay shorts; negative means shorts pay longs.",
    limitations: ["Venue-specific", "Can remain extreme during sustained trends"],
    redundancyGroup: "derivatives_positioning", defaultParameters: {},
  },
  {
    id: "open_interest", name: "Open Interest", category: "derivatives", implementation: "planned",
    purpose: "Track outstanding derivatives contracts as a measure of open exposure.",
    inputs: ["open_interest"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Price/positioning divergence", "Leverage expansion and contraction context"],
    avoidWhen: ["Interpreting OI direction as long/short direction", "Combining incompatible contract units"],
    interpretation: "Rising OI means more contracts are open, not necessarily more net longs.",
    limitations: ["Venue and contract coverage differ", "Aggregated OI requires unit normalization"],
    redundancyGroup: "derivatives_positioning", defaultParameters: {},
  },
  {
    id: "long_short_ratio", name: "Long/Short Account Ratio", category: "derivatives", implementation: "planned",
    purpose: "Describe the distribution of accounts or positions classified as long versus short.",
    inputs: ["open_interest"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Crowding and sentiment context"],
    avoidWhen: ["Assuming account counts represent notional exposure", "Comparing different provider definitions"],
    interpretation: "An extreme ratio may indicate crowding but is not a timing signal.",
    limitations: ["Definitions vary by exchange", "Often measures accounts, not capital"],
    redundancyGroup: "derivatives_positioning", defaultParameters: {},
  },
  {
    id: "market_breadth", name: "Market Breadth", category: "breadth", implementation: "planned",
    purpose: "Measure how broadly a market move is shared across an asset universe.",
    inputs: ["market_universe"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["BTC versus altcoin regime analysis", "Confirming broad participation or narrow leadership"],
    avoidWhen: ["Using a changing universe without point-in-time membership"],
    interpretation: "Rising participation can confirm broad risk appetite; divergence can signal narrowing leadership.",
    limitations: ["Requires survivorship-safe universe history", "Asset weighting and universe definitions matter"],
    redundancyGroup: "market_breadth", defaultParameters: {},
  },
  {
    id: "fear_greed", name: "Fear & Greed Index", category: "sentiment", implementation: "planned",
    purpose: "Provide a broad sentiment context score, not an asset-specific signal.",
    inputs: ["news"], bestIn: ["uptrend", "downtrend", "range"],
    usefulWhen: ["Macro sentiment context", "Contrarian hypothesis generation with independent confirmation"],
    avoidWhen: ["Using as a standalone entry/exit signal", "Assuming index components are independent of price/volatility"],
    interpretation: "Extreme readings describe sentiment conditions; predictive value must be established out of sample.",
    limitations: ["Broad market rather than asset-specific", "Methodology and component availability can change"],
    redundancyGroup: "sentiment", defaultParameters: {},
  },
];

export function getIndicatorById(id: string): IndicatorDefinition | undefined {
  return INDICATOR_CATALOGUE.find((indicator) => indicator.id === id);
}

export function getImplementedIndicators(): IndicatorDefinition[] {
  return INDICATOR_CATALOGUE.filter((indicator) => indicator.implementation === "implemented");
}

/**
 * Returns only indicators whose calculations exist in the current codebase.
 * Recommendations are research aids, not signals or trade permissions.
 */
export function recommendIndicators(
  context: IndicatorRecommendationContext,
): IndicatorRecommendation[] {
  const recommendations = new Map<string, IndicatorRecommendation>();
  const add = (id: string, relevance: IndicatorRecommendation["relevance"], rationale: string): void => {
    const indicator = getIndicatorById(id);
    if (indicator?.implementation !== "implemented") return;
    const existing = recommendations.get(id);
    if (!existing || (existing.relevance === "supporting" && relevance === "primary")) {
      recommendations.set(id, { indicator, relevance, rationale });
    }
  };

  if (context.trend === "uptrend" || context.trend === "downtrend") {
    add("ema", "primary", "Trend regime: use EMA alignment to describe direction and pullback context.");
    add("macd", "supporting", "Trend regime: MACD can describe momentum confirmation, but overlaps with moving averages.");
    add("atr", "supporting", "Measure realized range so trend signals are interpreted alongside volatility.");
  } else if (context.trend === "range") {
    add("rsi", "primary", "Range regime: RSI can frame stretched momentum; test mean reversion rather than assuming reversal.");
    add("bollinger_bands", "supporting", "Range regime: bands describe dispersion and relative price location.");
    add("atr", "supporting", "Track realized range to detect when the range regime is breaking down.");
  } else {
    add("sma", "supporting", "Unknown regime: use a slow baseline for descriptive context, not a directional conclusion.");
    add("atr", "supporting", "Unknown regime: quantify realized range while the trend classification warms up.");
  }

  if (context.volatility === "high") {
    add("atr", "primary", "High volatility: quantify realized range; do not infer direction from ATR.");
    add("bollinger_bands", "supporting", "High volatility: monitor dispersion expansion and avoid assuming band touches reverse.");
  } else if (context.volatility === "low") {
    add("bollinger_bands", "primary", "Low volatility: monitor compression and possible expansion; a squeeze is not a direction forecast.");
    add("atr", "supporting", "Track whether realized range remains compressed or begins expanding.");
  }

  return [...recommendations.values()];
}
