import { fetchBinanceHistory, type BinanceInterval } from "../adapters/binance-public";
import type { Candle } from "./candles";
import { runResearchBatch, type ResearchBatchResult, type ResearchPipelineConfig } from "./research-pipeline";
import { createBaselineResearchCandidates } from "../strategies/baseline-research-candidates";
import { ResearchRunStore, type StoredResearchRun } from "../adapters/research-run-store";
import { compareResearchRuns } from "./research-comparison";

const INTERVAL_MS: Partial<Record<BinanceInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

export interface ResearchRunInput {
  symbol: string;
  interval: string;
  candleCount: number;
  trainBars: number;
  testBars: number;
  feeBps: number;
  slippageBps: number;
  halfSpreadBps: number;
  maxParticipationPct: number;
  marketImpactBps: number;
}

export interface ResearchRunSettings {
  symbol: string;
  interval: BinanceInterval;
  historyLimit: number;
  intervalMs: number;
  pipeline: ResearchPipelineConfig;
}

export function createResearchRunSettings(input: ResearchRunInput): ResearchRunSettings {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new RangeError("Enter a valid market pair, for example BTCUSDT");
  if (!(input.interval in INTERVAL_MS)) throw new RangeError("Select a supported fixed-duration interval");
  const interval = input.interval as BinanceInterval;
  const intervalMs = INTERVAL_MS[interval]!;
  if (!Number.isSafeInteger(input.candleCount) || input.candleCount < 300 || input.candleCount > 5000) {
    throw new RangeError("Historical candles must be between 300 and 5,000");
  }
  if (!Number.isSafeInteger(input.trainBars) || !Number.isSafeInteger(input.testBars) ||
      input.trainBars < 100 || input.testBars < 20 || input.trainBars + input.testBars + 2 > input.candleCount) {
    throw new RangeError("Training/test windows are invalid for the selected history size");
  }
  const estimatedFoldCount = Math.floor((input.candleCount - input.trainBars - 2) / input.testBars) + 1;
  if (estimatedFoldCount > 40) {
    throw new RangeError("This configuration creates too many folds for a phone. Increase test bars or training bars (maximum 40 folds).");
  }
  if (!Number.isFinite(input.feeBps) || input.feeBps < 0 || input.feeBps > 100 ||
      !Number.isFinite(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 500) {
    throw new RangeError("Fee must be 0–100 bps and slippage 0–500 bps");
  }
  if (!Number.isFinite(input.halfSpreadBps) || input.halfSpreadBps < 0 || input.halfSpreadBps > 100 ||
      !Number.isFinite(input.maxParticipationPct) || input.maxParticipationPct <= 0 || input.maxParticipationPct > 100 ||
      !Number.isFinite(input.marketImpactBps) || input.marketImpactBps < 0 || input.marketImpactBps > 500) {
    throw new RangeError("Spread must be 0–100 bps, participation 0–100%, and impact 0–500 bps");
  }

  return {
    symbol,
    interval,
    historyLimit: input.candleCount,
    intervalMs,
    pipeline: {
      folds: {
        trainBars: input.trainBars,
        testBars: input.testBars,
        stepBars: input.testBars,
        embargoBars: 2,
        expanding: true,
      },
      backtest: {
        initialCapital: 10_000,
        feeRate: input.feeBps / 10_000,
        slippageBps: input.slippageBps,
        allocationFraction: 0.25,
      },
      executionModel: {
        feeRate: input.feeBps / 10_000,
        baseSlippageBps: input.slippageBps,
        halfSpreadBps: input.halfSpreadBps,
        maxParticipationRate: input.maxParticipationPct / 100,
        marketImpactBpsAtMaxParticipation: input.marketImpactBps,
      },
      regime: {
        fastEmaPeriod: 10,
        slowEmaPeriod: 30,
        atrPeriod: 14,
        trendThresholdPct: 0.15,
        lowVolatilityAtrPct: 0.5,
        highVolatilityAtrPct: 3,
      },
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metric(label: string, value: string): HTMLElement {
  const wrapper = el("div", "research-metric");
  wrapper.append(el("span", "", label), el("strong", "", value));
  return wrapper;
}

function renderReport(target: HTMLElement, report: ResearchBatchResult): void {
  target.replaceChildren();
  const summary = el("div", "research-summary");
  const execution = report.config.executionModel;
  target.append(el("p", "small execution-model-label", execution
    ? `EXECUTION-AWARE · fee ${(execution.feeRate * 10_000).toFixed(1)} bps · slippage ${execution.baseSlippageBps} bps · half-spread ${execution.halfSpreadBps} bps · participation cap ${(execution.maxParticipationRate * 100).toFixed(2)}% · impact-at-cap ${execution.marketImpactBpsAtMaxParticipation} bps`
    : "LEGACY MODEL · immediate full fills · fee and fixed slippage only"));
  summary.append(
    metric("CANDLES", report.dataset.candleCount.toLocaleString()),
    metric("WALK-FORWARD CANDIDATES", String(report.candidateResults.length)),
    metric("TEST FOLDS / STRATEGY", String(report.candidateResults[0]?.evaluation.foldCount ?? 0)),
    metric("DATASET FINGERPRINT", report.dataset.fingerprint),
  );
  target.append(summary);

  for (const candidate of report.candidateResults) {
    const card = el("article", "research-result");
    const heading = el("div", "research-result-heading");
    heading.append(el("h3", "", candidate.name), el("span", "tag safe", candidate.id));
    card.append(heading);
    const stats = el("div", "research-summary");
    stats.append(
      metric("COMPOUNDED OOS RETURN", candidate.evaluation.compoundedReturnPct.toFixed(2) + "%"),
      metric("WORST FOLD DRAWDOWN", candidate.scorecard.worstFoldDrawdownPct === null ? "—" : candidate.scorecard.worstFoldDrawdownPct.toFixed(2) + "%"),
      metric("COMPLETED TRADES", String(candidate.scorecard.completedTrades)),
      metric("WIN RATE", candidate.scorecard.winRatePct === null ? "—" : candidate.scorecard.winRatePct.toFixed(1) + "%"),
      metric("PROFIT FACTOR", candidate.scorecard.profitFactor === null ? "—" : candidate.scorecard.profitFactor.toFixed(2)),
      metric("NET EXPECTANCY", candidate.scorecard.expectancyPerTrade === null ? "—" : candidate.scorecard.expectancyPerTrade.toFixed(2) + " USDT"),
      metric("POSITIVE FOLDS", candidate.scorecard.positiveFoldPct === null ? "—" : candidate.scorecard.positiveFoldPct.toFixed(1) + "%"),
      metric("TOTAL FEES", candidate.scorecard.totalFees.toFixed(2) + " USDT"),
    );
    card.append(stats);

    const regimes = el("div", "regime-results");
    regimes.append(el("h4", "", "Performance by market regime"));
    if (candidate.regimeScorecard.groups.length === 0) {
      regimes.append(el("p", "small", "No completed trades with sufficient regime warm-up."));
    } else {
      const table = el("div", "regime-table");
      const header = el("div", "regime-row regime-header");
      ["TREND", "VOLATILITY", "TRADES", "NET PNL", "EXPECTANCY"].forEach((value) => header.append(el("span", "", value)));
      table.append(header);
      for (const group of candidate.regimeScorecard.groups) {
        const row = el("div", "regime-row");
        [group.trend, group.volatility, String(group.completedTrades),
          group.netPnl.toFixed(2), group.expectancyPerTrade?.toFixed(2) ?? "—"].forEach((value) => row.append(el("span", "", value)));
        table.append(row);
      }
      regimes.append(table);
    }
    regimes.append(el("p", "small", `Classified trades: ${candidate.regimeScorecard.classifiedTrades} · Unclassified: ${candidate.regimeScorecard.unclassifiedTrades}`));
    card.append(regimes);

    const folds = el("details", "fold-details");
    folds.append(el("summary", "", "Inspect individual test folds"));
    candidate.evaluation.folds.forEach((fold) => {
      folds.append(el("p", "small", `Fold ${fold.index + 1} · ${new Date(fold.testStartTimestamp).toLocaleDateString()}–${new Date(fold.testEndTimestamp).toLocaleDateString()} · ${fold.result.totalReturnPct.toFixed(2)}% return · ${fold.result.completedTrades} trades`));
    });
    card.append(folds);
    target.append(card);
  }
}

export function mountResearchConsole(container: HTMLElement): void {
  container.innerHTML = `
    <section class="panel research-console" aria-labelledby="research-title">
      <span class="panel-label">QUANTITATIVE RESEARCH</span>
      <h2 id="research-title">Strategy research console</h2>
      <p>Run reproducible walk-forward experiments against public historical spot candles. All orders are simulated.</p>
      <form id="research-form" class="research-form">
        <label>Market pair<input name="symbol" value="BTCUSDT" maxlength="20" required autocomplete="off" /></label>
        <label>Interval<select name="interval"><option>1h</option><option>4h</option><option>1d</option><option>15m</option></select></label>
        <label>Historical candles<input name="candleCount" type="number" min="300" max="5000" step="100" value="1500" required /></label>
        <label>Training bars<input name="trainBars" type="number" min="100" value="600" required /></label>
        <label>Test bars<input name="testBars" type="number" min="20" value="120" required /></label>
        <label>Fee (basis points)<input name="feeBps" type="number" min="0" max="100" step="1" value="10" required /></label>
        <label>Base slippage (bps)<input name="slippageBps" type="number" min="0" max="500" step="1" value="5" required /></label>
        <label>Half-spread (bps)<input name="halfSpreadBps" type="number" min="0" max="100" step="0.5" value="2" required /></label>
        <label>Max candle participation (%)<input name="maxParticipationPct" type="number" min="0.01" max="100" step="0.01" value="1" required /></label>
        <label>Impact at participation cap (bps)<input name="marketImpactBps" type="number" min="0" max="500" step="1" value="25" required /></label>
        <button id="run-research" type="submit">Run research batch</button>
      </form>
      <p id="research-status" class="paper-status" role="status">Ready · public Binance spot data · no API key required</p>
      <div id="research-results" aria-live="polite"></div>
      <section class="saved-research"><h3>Saved experiment history</h3><p class="small">Stored only on this device. Clearing browser site data can erase these records.</p><div id="research-history" aria-live="polite">Loading saved experiments…</div><button id="compare-research" type="button" disabled>Compare selected experiments</button><div id="research-comparison" aria-live="polite"></div></section>
      <p class="small">Baseline parameters and regime thresholds are fixed research defaults, not optimized recommendations. Results are historical simulations, not evidence of future profitability.</p>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>("#research-form");
  const button = container.querySelector<HTMLButtonElement>("#run-research");
  const status = container.querySelector<HTMLElement>("#research-status");
  const results = container.querySelector<HTMLElement>("#research-results");
  const history = container.querySelector<HTMLElement>("#research-history");
  const compareButton = container.querySelector<HTMLButtonElement>("#compare-research");
  const comparisonTarget = container.querySelector<HTMLElement>("#research-comparison");
  if (!form || !button || !status || !results || !history || !compareButton || !comparisonTarget) return;
  const runStore = new ResearchRunStore();
  const selectedRunIds = new Set<string>();
  let cachedRuns: StoredResearchRun[] = [];

  const updateCompareButton = (): void => {
    compareButton.disabled = selectedRunIds.size !== 2;
    compareButton.textContent = selectedRunIds.size === 2 ? "Compare selected experiments" : "Select 2 experiments to compare";
  };
  compareButton.addEventListener("click", () => {
    if (selectedRunIds.size !== 2) return;
    const [firstId, secondId] = [...selectedRunIds];
    const first = cachedRuns.find((record) => record.id === firstId);
    const second = cachedRuns.find((record) => record.id === secondId);
    if (!first || !second) return;
    const comparison = compareResearchRuns(first.report, second.report);
    comparisonTarget.replaceChildren();
    const panel = el("div", "research-result");
    panel.append(el("h4", "", "Experiment comparison"));
    if (!comparison.comparable) {
      panel.append(el("p", "small", "NOT APPLES-TO-APPLES · " + comparison.reasons.join(" · ")));
    } else {
      panel.append(el("p", "small", "Matched dataset fingerprint, candle range, walk-forward folds and execution assumptions."));
    }
    if (comparison.candidateDeltas.length === 0) panel.append(el("p", "small", "No matching strategy IDs across these runs."));
    for (const delta of comparison.candidateDeltas) {
      panel.append(el("p", "small", delta.name + " · OOS return delta " + delta.returnDeltaPct.toFixed(2) + " pp · worst drawdown delta " + (delta.worstFoldDrawdownDeltaPct?.toFixed(2) ?? "—") + " pp · trade delta " + delta.tradeCountDelta));
    }
    comparisonTarget.append(panel);
  });

  const refreshHistory = async (): Promise<void> => {
    try {
      const records = await runStore.list(50);
      cachedRuns = records;
      history.replaceChildren();
      if (records.length === 0) {
        selectedRunIds.clear();
        updateCompareButton();
        history.append(el("p", "small", "No saved experiments yet."));
        return;
      }
      for (const record of records) {
        const item = el("div", "saved-run");
        const info = el("div", "saved-run-info");
        const select = el("input", "saved-run-select");
        select.type = "checkbox";
        select.checked = selectedRunIds.has(record.id);
        select.setAttribute("aria-label", "Select experiment for comparison");
        select.addEventListener("change", () => {
          if (select.checked) {
            if (selectedRunIds.size >= 2) {
              const oldestSelected = selectedRunIds.values().next().value as string | undefined;
              if (oldestSelected) selectedRunIds.delete(oldestSelected);
            }
            selectedRunIds.add(record.id);
          } else selectedRunIds.delete(record.id);
          updateCompareButton();
          refreshHistory();
        });
        info.append(
          el("strong", "", record.report.config ? (record.report.config.executionModel ? "Execution-aware" : "Legacy") + " · " + record.report.candidateResults.length + " strategies · " + record.report.dataset.candleCount.toLocaleString() + " candles" : "Saved experiment"),
          el("span", "small", new Date(record.createdAt).toLocaleString() + " · " + record.report.dataset.fingerprint),
        );
        const actions = el("div", "saved-run-actions");
        const open = el("button", "saved-run-open", "Open");
        open.type = "button";
        open.addEventListener("click", () => renderReport(results, record.report));
        const remove = el("button", "saved-run-delete", "Delete");
        remove.type = "button";
        remove.addEventListener("click", () => {
          remove.disabled = true;
          selectedRunIds.delete(record.id);
          void runStore.delete(record.id).then(refreshHistory).catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message : "Could not delete saved experiment";
            remove.disabled = false;
          });
        });
        actions.append(open, remove);
        item.append(select, info, actions);
        history.append(item);
      }
      updateCompareButton();
    } catch (error) {
      history.textContent = error instanceof Error ? error.message : "Saved experiment history unavailable";
    }
  };
  void refreshHistory();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const data = new FormData(form);
    let settings: ResearchRunSettings;
    try {
      settings = createResearchRunSettings({
        symbol: String(data.get("symbol") ?? ""),
        interval: String(data.get("interval") ?? ""),
        candleCount: Number(data.get("candleCount")),
        trainBars: Number(data.get("trainBars")),
        testBars: Number(data.get("testBars")),
        feeBps: Number(data.get("feeBps")),
        slippageBps: Number(data.get("slippageBps")),
        halfSpreadBps: Number(data.get("halfSpreadBps")),
        maxParticipationPct: Number(data.get("maxParticipationPct")),
        marketImpactBps: Number(data.get("marketImpactBps")),
      });
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Invalid research configuration";
      return;
    }

    button.disabled = true;
    button.textContent = "Loading history…";
    results.replaceChildren();
    status.textContent = "Fetching completed public candles…";
    void (async () => {
      try {
        const now = Date.now();
        const endTime = now - 1;
        const startTime = endTime - settings.historyLimit * settings.intervalMs;
        const candles: Candle[] = await fetchBinanceHistory({
          symbol: settings.symbol,
          interval: settings.interval,
          startTime,
          endTime,
          pageLimit: 1000,
          maxCandles: settings.historyLimit,
        }, fetch, now);
        const embargoBars = settings.pipeline.folds.embargoBars ?? 0;
        if (candles.length < settings.pipeline.folds.trainBars + settings.pipeline.folds.testBars + embargoBars) {
          throw new Error(`Insufficient history: received ${candles.length} candles for the requested training/test windows`);
        }
        status.textContent = `Evaluating ${candles.length.toLocaleString()} candles across walk-forward folds…`;
        const candidates = createBaselineResearchCandidates({
          sma: { fastPeriod: 10, slowPeriod: 30 },
          rsi: { period: 14, oversold: 30, overbought: 70 },
          donchian: { period: 20 },
        });
        const metadata = {
          symbol: settings.symbol, interval: settings.interval, provider: "Binance public spot",
        };
        const legacyPipeline: ResearchPipelineConfig = {
          folds: { ...settings.pipeline.folds },
          backtest: { ...settings.pipeline.backtest },
          regime: { ...settings.pipeline.regime },
        };
        const legacyReport = runResearchBatch(candles, candidates, legacyPipeline, metadata);
        const executionReport = runResearchBatch(candles, candidates, settings.pipeline, metadata);
        results.replaceChildren();
        const comparisonGrid = el("div", "execution-comparison-grid");
        const legacyPanel = el("section", "execution-comparison-panel");
        const executionPanel = el("section", "execution-comparison-panel");
        legacyPanel.append(el("h3", "", "Legacy execution"));
        executionPanel.append(el("h3", "", "Execution-aware"));
        const legacyTarget = el("div", "execution-report");
        const executionTarget = el("div", "execution-report");
        legacyPanel.append(legacyTarget);
        executionPanel.append(executionTarget);
        comparisonGrid.append(legacyPanel, executionPanel);
        results.append(comparisonGrid);
        renderReport(legacyTarget, legacyReport);
        renderReport(executionTarget, executionReport);
        const sensitivity = compareResearchRuns(legacyReport, executionReport);
        const sensitivityPanel = el("section", "research-result execution-sensitivity");
        sensitivityPanel.append(el("h3", "", "Execution-cost sensitivity · execution-aware minus legacy"));
        sensitivityPanel.append(el("p", "small", "Same candles, folds, strategies and capital. This is an execution-model sensitivity analysis, not an apples-to-apples strategy comparison: the fill assumptions intentionally differ."));
        for (const delta of sensitivity.candidateDeltas) {
          sensitivityPanel.append(el("p", "small", delta.name + " · OOS return " + delta.returnDeltaPct.toFixed(2) + " pp · worst drawdown " + (delta.worstFoldDrawdownDeltaPct?.toFixed(2) ?? "—") + " pp · completed trade delta " + delta.tradeCountDelta));
        }
        results.append(sensitivityPanel);
        const legacySaved = await runStore.save(legacyReport);
        const executionSaved = await runStore.save(executionReport);
        await refreshHistory();
        status.textContent = `Completed · ${candles.length.toLocaleString()} candles · ${legacyReport.candidateResults[0].evaluation.foldCount} OOS folds per strategy · legacy ${legacySaved.id} · execution-aware ${executionSaved.id}`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Research batch failed";
      } finally {
        button.disabled = false;
        button.textContent = "Run research batch";
      }
    })();
  });
}
