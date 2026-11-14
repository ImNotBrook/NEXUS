export interface RiskCircuitBreakerConfig {
  maxWeeklyLossFraction: number;
  maxWeeklyDrawdownFraction: number;
  maxMonthlyLossFraction: number;
  maxMonthlyDrawdownFraction: number;
  maxConsecutiveLosses: number;
  cooldownDurationMs: number;
}

export interface RiskCircuitBreakerState {
  schemaVersion: 1;
  lastTimestamp: number;
  weekKey: string;
  monthKey: string;
  weekStartEquity: number;
  weekPeakEquity: number;
  monthStartEquity: number;
  monthPeakEquity: number;
  weeklyLossHalted: boolean;
  weeklyDrawdownHalted: boolean;
  monthlyLossHalted: boolean;
  monthlyDrawdownHalted: boolean;
  consecutiveLosses: number;
  cooldownUntilTimestamp: number | null;
}

export interface RiskCircuitBreakerOptions {
  dataQualityHealthy: boolean;
  /** Net P&L for exactly one newly completed trade, after all execution costs. */
  completedTradePnl?: number;
}

export interface RiskCircuitBreakerDecision {
  state: RiskCircuitBreakerState;
  entryBlocked: boolean;
  reasons: Array<
    | "weekly-loss-limit"
    | "weekly-drawdown-limit"
    | "monthly-loss-limit"
    | "monthly-drawdown-limit"
    | "consecutive-loss-cooldown"
    | "data-quality-halt"
  >;
  /** Existing positions may always be reduced or closed, even during a halt. */
  riskReducingExitsAllowed: true;
}

function validateTimestamp(timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("timestamp must be a non-negative safe integer");
  }
}

function utcWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function utcMonthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function validateConfig(config: RiskCircuitBreakerConfig): void {
  for (const [name, value] of Object.entries({
    maxWeeklyLossFraction: config.maxWeeklyLossFraction,
    maxWeeklyDrawdownFraction: config.maxWeeklyDrawdownFraction,
    maxMonthlyLossFraction: config.maxMonthlyLossFraction,
    maxMonthlyDrawdownFraction: config.maxMonthlyDrawdownFraction,
  })) {
    if (!Number.isFinite(value) || value <= 0 || value >= 1) {
      throw new RangeError(`${name} must be in (0, 1)`);
    }
  }
  if (!Number.isSafeInteger(config.maxConsecutiveLosses) || config.maxConsecutiveLosses < 1) {
    throw new RangeError("maxConsecutiveLosses must be a positive safe integer");
  }
  if (!Number.isSafeInteger(config.cooldownDurationMs) || config.cooldownDurationMs < 1) {
    throw new RangeError("cooldownDurationMs must be a positive safe integer");
  }
}

function validateState(state: RiskCircuitBreakerState): void {
  validateTimestamp(state.lastTimestamp);
  if (state.schemaVersion !== 1 ||
      state.weekKey !== utcWeekKey(state.lastTimestamp) ||
      state.monthKey !== utcMonthKey(state.lastTimestamp) ||
      !Number.isFinite(state.weekStartEquity) || state.weekStartEquity <= 0 ||
      !Number.isFinite(state.weekPeakEquity) || state.weekPeakEquity < state.weekStartEquity ||
      !Number.isFinite(state.monthStartEquity) || state.monthStartEquity <= 0 ||
      !Number.isFinite(state.monthPeakEquity) || state.monthPeakEquity < state.monthStartEquity ||
      typeof state.weeklyLossHalted !== "boolean" ||
      typeof state.weeklyDrawdownHalted !== "boolean" ||
      typeof state.monthlyLossHalted !== "boolean" ||
      typeof state.monthlyDrawdownHalted !== "boolean" ||
      !Number.isSafeInteger(state.consecutiveLosses) || state.consecutiveLosses < 0 ||
      (state.cooldownUntilTimestamp !== null &&
        (!Number.isSafeInteger(state.cooldownUntilTimestamp) ||
          state.cooldownUntilTimestamp < state.lastTimestamp))) {
    throw new TypeError("Persisted risk circuit-breaker state failed validation");
  }
}

export function createRiskCircuitBreakerState(
  timestamp: number,
  equity: number,
): RiskCircuitBreakerState {
  validateTimestamp(timestamp);
  if (!Number.isFinite(equity) || equity <= 0) {
    throw new RangeError("equity must be a positive finite number");
  }
  return {
    schemaVersion: 1,
    lastTimestamp: timestamp,
    weekKey: utcWeekKey(timestamp),
    monthKey: utcMonthKey(timestamp),
    weekStartEquity: equity,
    weekPeakEquity: equity,
    monthStartEquity: equity,
    monthPeakEquity: equity,
    weeklyLossHalted: false,
    weeklyDrawdownHalted: false,
    monthlyLossHalted: false,
    monthlyDrawdownHalted: false,
    consecutiveLosses: 0,
    cooldownUntilTimestamp: null,
  };
}

/**
 * Advances the persisted circuit-breaker state once per new market observation.
 * All period boundaries use UTC. Loss thresholds are evaluated on marked equity;
 * completed-trade streaks use net P&L after fees and execution costs.
 */
export function advanceRiskCircuitBreaker(
  previousState: RiskCircuitBreakerState,
  timestamp: number,
  equity: number,
  config: RiskCircuitBreakerConfig,
  options: RiskCircuitBreakerOptions,
): RiskCircuitBreakerDecision {
  validateConfig(config);
  validateState(previousState);
  validateTimestamp(timestamp);
  if (timestamp <= previousState.lastTimestamp) {
    throw new RangeError("timestamp must be strictly greater than the previous timestamp");
  }
  if (!Number.isFinite(equity) || equity <= 0) {
    throw new RangeError("equity must be a positive finite number");
  }
  if (typeof options.dataQualityHealthy !== "boolean") {
    throw new TypeError("dataQualityHealthy must be a boolean");
  }
  if (options.completedTradePnl !== undefined && !Number.isFinite(options.completedTradePnl)) {
    throw new RangeError("completedTradePnl must be finite");
  }

  const weekKey = utcWeekKey(timestamp);
  const monthKey = utcMonthKey(timestamp);
  const state: RiskCircuitBreakerState = {
    ...previousState,
    lastTimestamp: timestamp,
    weekKey,
    monthKey,
    weekStartEquity: weekKey === previousState.weekKey ? previousState.weekStartEquity : equity,
    weekPeakEquity: weekKey === previousState.weekKey ? Math.max(previousState.weekPeakEquity, equity) : equity,
    monthStartEquity: monthKey === previousState.monthKey ? previousState.monthStartEquity : equity,
    monthPeakEquity: monthKey === previousState.monthKey ? Math.max(previousState.monthPeakEquity, equity) : equity,
    weeklyLossHalted: weekKey === previousState.weekKey ? previousState.weeklyLossHalted : false,
    weeklyDrawdownHalted: weekKey === previousState.weekKey ? previousState.weeklyDrawdownHalted : false,
    monthlyLossHalted: monthKey === previousState.monthKey ? previousState.monthlyLossHalted : false,
    monthlyDrawdownHalted: monthKey === previousState.monthKey ? previousState.monthlyDrawdownHalted : false,
    cooldownUntilTimestamp:
      previousState.cooldownUntilTimestamp !== null && timestamp < previousState.cooldownUntilTimestamp
        ? previousState.cooldownUntilTimestamp
        : null,
  };

  if (options.completedTradePnl !== undefined) {
    if (options.completedTradePnl < 0) state.consecutiveLosses += 1;
    else if (options.completedTradePnl > 0) state.consecutiveLosses = 0;
  }

  if (state.consecutiveLosses >= config.maxConsecutiveLosses) {
    state.cooldownUntilTimestamp = timestamp + config.cooldownDurationMs;
    if (!Number.isSafeInteger(state.cooldownUntilTimestamp)) {
      throw new RangeError("cooldown expiry exceeds the safe timestamp range");
    }
    state.consecutiveLosses = 0;
  }

  const weeklyLoss = Math.max(0, (state.weekStartEquity - equity) / state.weekStartEquity);
  const weeklyDrawdown = Math.max(0, (state.weekPeakEquity - equity) / state.weekPeakEquity);
  const monthlyLoss = Math.max(0, (state.monthStartEquity - equity) / state.monthStartEquity);
  const monthlyDrawdown = Math.max(0, (state.monthPeakEquity - equity) / state.monthPeakEquity);
  if (weeklyLoss >= config.maxWeeklyLossFraction) state.weeklyLossHalted = true;
  if (weeklyDrawdown >= config.maxWeeklyDrawdownFraction) state.weeklyDrawdownHalted = true;
  if (monthlyLoss >= config.maxMonthlyLossFraction) state.monthlyLossHalted = true;
  if (monthlyDrawdown >= config.maxMonthlyDrawdownFraction) state.monthlyDrawdownHalted = true;

  const reasons: RiskCircuitBreakerDecision["reasons"] = [];
  if (state.weeklyLossHalted) reasons.push("weekly-loss-limit");
  if (state.weeklyDrawdownHalted) reasons.push("weekly-drawdown-limit");
  if (state.monthlyLossHalted) reasons.push("monthly-loss-limit");
  if (state.monthlyDrawdownHalted) reasons.push("monthly-drawdown-limit");
  if (state.cooldownUntilTimestamp !== null && timestamp < state.cooldownUntilTimestamp) {
    reasons.push("consecutive-loss-cooldown");
  }
  if (!options.dataQualityHealthy) reasons.push("data-quality-halt");

  return {
    state,
    entryBlocked: reasons.length > 0,
    reasons,
    riskReducingExitsAllowed: true,
  };
}
