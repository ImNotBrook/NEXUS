import { describe, expect, it } from "vitest";
import {
  advanceRiskCircuitBreaker,
  createRiskCircuitBreakerState,
  type RiskCircuitBreakerConfig,
} from "./risk-circuit-breaker";

const HOUR = 3_600_000;
const config: RiskCircuitBreakerConfig = {
  maxWeeklyLossFraction: 0.05,
  maxWeeklyDrawdownFraction: 0.04,
  maxMonthlyLossFraction: 0.10,
  maxMonthlyDrawdownFraction: 0.08,
  maxConsecutiveLosses: 3,
  cooldownDurationMs: 6 * HOUR,
};

const monday = Date.UTC(2026, 0, 5, 0, 0);

describe("multi-period risk circuit breaker", () => {
  it("starts with UTC weekly and monthly equity baselines", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    expect(state.weekKey).toBe("2026-01-05");
    expect(state.monthKey).toBe("2026-01");
    expect(state.weekStartEquity).toBe(10_000);
    expect(state.weekPeakEquity).toBe(10_000);
    expect(state.monthStartEquity).toBe(10_000);
    expect(state.monthPeakEquity).toBe(10_000);
  });

  it("blocks new entries when the weekly loss threshold is reached", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    const result = advanceRiskCircuitBreaker(state, monday + HOUR, 9_500, config, {
      dataQualityHealthy: true,
    });
    expect(result.entryBlocked).toBe(true);
    expect(result.reasons).toContain("weekly-loss-limit");
  });

  it("keeps a weekly halt latched after equity recovers until the next UTC week", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    const breached = advanceRiskCircuitBreaker(state, monday + HOUR, 9_500, config, { dataQualityHealthy: true });
    const recovered = advanceRiskCircuitBreaker(breached.state, monday + 2 * HOUR, 10_000, config, { dataQualityHealthy: true });
    expect(recovered.entryBlocked).toBe(true);
    expect(recovered.reasons).toContain("weekly-loss-limit");
    const nextWeek = advanceRiskCircuitBreaker(recovered.state, monday + 7 * 24 * HOUR, 10_000, config, { dataQualityHealthy: true });
    expect(nextWeek.entryBlocked).toBe(false);
  });

  it("blocks new entries when the monthly loss threshold is reached", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    const result = advanceRiskCircuitBreaker(state, monday + HOUR, 9_000, config, {
      dataQualityHealthy: true,
    });
    expect(result.entryBlocked).toBe(true);
    expect(result.reasons).toContain("monthly-loss-limit");
  });

  it("blocks new entries on a weekly peak-to-trough drawdown even when weekly P&L is positive", () => {
    let state = createRiskCircuitBreakerState(monday, 10_000);
    state = advanceRiskCircuitBreaker(state, monday + HOUR, 11_000, config, { dataQualityHealthy: true }).state;
    const result = advanceRiskCircuitBreaker(state, monday + 2 * HOUR, 10_500, config, { dataQualityHealthy: true });
    expect(result.entryBlocked).toBe(true);
    expect(result.reasons).toContain("weekly-drawdown-limit");
    expect(result.state.weekStartEquity).toBe(10_000);
  });

  it("blocks new entries on a monthly peak-to-trough drawdown even when monthly P&L is positive", () => {
    let state = createRiskCircuitBreakerState(monday, 10_000);
    state = advanceRiskCircuitBreaker(state, monday + HOUR, 11_000, config, { dataQualityHealthy: true }).state;
    const result = advanceRiskCircuitBreaker(state, monday + 2 * HOUR, 10_100, config, { dataQualityHealthy: true });
    expect(result.entryBlocked).toBe(true);
    expect(result.reasons).toContain("monthly-drawdown-limit");
    expect(result.state.monthStartEquity).toBe(10_000);
  });

  it("rolls weekly baselines at the UTC Monday boundary without resetting the monthly baseline", () => {
    const state = createRiskCircuitBreakerState(monday + 6 * 24 * HOUR, 10_000);
    const nextMonday = monday + 7 * 24 * HOUR;
    const result = advanceRiskCircuitBreaker(state, nextMonday, 9_700, config, {
      dataQualityHealthy: true,
    });
    expect(result.state.weekKey).toBe("2026-01-12");
    expect(result.state.weekStartEquity).toBe(9_700);
    expect(result.state.weekPeakEquity).toBe(9_700);
    expect(result.state.monthStartEquity).toBe(10_000);
    expect(result.state.monthPeakEquity).toBe(10_000);
    expect(result.entryBlocked).toBe(false);
  });

  it("rolls the monthly baseline at the UTC month boundary", () => {
    const start = Date.UTC(2026, 0, 31, 23);
    const state = createRiskCircuitBreakerState(start, 10_000);
    const result = advanceRiskCircuitBreaker(state, Date.UTC(2026, 1, 1), 9_800, config, {
      dataQualityHealthy: true,
    });
    expect(result.state.monthKey).toBe("2026-02");
    expect(result.state.monthStartEquity).toBe(9_800);
    expect(result.state.monthPeakEquity).toBe(9_800);
  });

  it("starts a cooldown after the configured consecutive losing trades", () => {
    let state = createRiskCircuitBreakerState(monday, 10_000);
    for (let index = 1; index <= 3; index += 1) {
      state = advanceRiskCircuitBreaker(state, monday + index * HOUR, 10_000, config, {
        dataQualityHealthy: true,
        completedTradePnl: -10,
      }).state;
    }
    const result = advanceRiskCircuitBreaker(state, monday + 4 * HOUR, 10_000, config, {
      dataQualityHealthy: true,
    });
    expect(result.entryBlocked).toBe(true);
    expect(result.reasons).toContain("consecutive-loss-cooldown");
    expect(result.state.cooldownUntilTimestamp).toBe(monday + 9 * HOUR);
    expect(result.state.consecutiveLosses).toBe(0);
  });

  it("clears an expired cooldown but does not allow entries while data quality is unhealthy", () => {
    let state = createRiskCircuitBreakerState(monday, 10_000);
    for (let index = 1; index <= 3; index += 1) {
      state = advanceRiskCircuitBreaker(state, monday + index * HOUR, 10_000, config, {
        dataQualityHealthy: true,
        completedTradePnl: -10,
      }).state;
    }
    const result = advanceRiskCircuitBreaker(state, monday + 10 * HOUR, 10_000, config, {
      dataQualityHealthy: false,
    });
    expect(result.reasons).toContain("data-quality-halt");
    expect(result.reasons).not.toContain("consecutive-loss-cooldown");
  });

  it("always permits risk-reducing exits while entries are blocked", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    const result = advanceRiskCircuitBreaker(state, monday + HOUR, 9_000, config, {
      dataQualityHealthy: false,
    });
    expect(result.entryBlocked).toBe(true);
    expect(result.riskReducingExitsAllowed).toBe(true);
  });

  it("rejects non-monotonic timestamps and invalid equity", () => {
    const state = createRiskCircuitBreakerState(monday, 10_000);
    expect(() => advanceRiskCircuitBreaker(state, monday - 1, 10_000, config, {
      dataQualityHealthy: true,
    })).toThrow(/timestamp/i);
    expect(() => advanceRiskCircuitBreaker(state, monday + HOUR, Number.NaN, config, {
      dataQualityHealthy: true,
    })).toThrow(/equity/i);
  });
});
