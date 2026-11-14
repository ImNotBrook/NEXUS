import type { ShadowOutcomeServiceReport } from "../domain/shadow-outcome-service";
import type { NoSetupReplayServiceReport } from "../domain/no-setup-replay-service";

export type ShadowOutcomeRunner = () => Promise<ShadowOutcomeServiceReport>;
export type NoSetupReplayRunner = () => Promise<NoSetupReplayServiceReport>;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function metric(label: string, value: string): HTMLElement {
  const item = node("div", "workbench-metric");
  item.append(node("span", "", label), node("strong", "", value));
  return item;
}

function renderReport(report: ShadowOutcomeServiceReport): HTMLElement {
  const host = node("div", "workbench-output");
  const summary = node("div", "workbench-metrics");
  summary.append(
    metric("Decisions scanned", String(report.decisionsScanned)),
    metric("Plans evaluated", String(report.plansEvaluated)),
    metric("New outcome snapshots", String(report.outcomesRecorded)),
    metric("Unchanged snapshots", String(report.outcomesUnchanged)),
    metric("Mature observations", String(report.learning.eligibleObservations)),
    metric("Legacy decisions skipped", String(report.legacyDecisionsSkipped)),
  );
  host.append(summary);

  host.append(node("h3", "", "Latest shadow outcomes"));
  if (!report.latestOutcomes.length) {
    host.append(node("p", "small", "No registered shadow plans have outcome observations yet. Run a new approved workbench scan to register one."));
  } else {
    const list = node("div", "journal-list");
    for (const outcome of report.latestOutcomes) {
      const card = node("article", "journal-record");
      const header = node("div", "journal-record-header");
      header.append(
        node("strong", "", outcome.symbol + " · " + outcome.decisionStatus + " · " + outcome.outcomeStatus.toUpperCase()),
        node("span", "journal-meta", outcome.horizonReached ? "HORIZON REACHED" : "IN PROGRESS"),
      );
      card.append(header);
      card.append(node("p", "small", "Data quality: " + outcome.dataQuality.toUpperCase() +
        " · Simulation: " + outcome.simulationVersion));
      card.append(node("p", "small", "Observed through: " +
        (outcome.observedThrough === null ? "No closed post-decision candle yet" : new Date(outcome.observedThrough).toLocaleString())));
      list.append(card);
    }
    host.append(list);
  }

  host.append(node("h3", "", "Mature learning cohorts"));
  if (!report.learning.cohorts.length) {
    host.append(node("p", "small", "No observations currently qualify for mature cohort statistics. Pending, open, ambiguous, incomplete or data-degraded paths are excluded."));
  } else {
    for (const cohort of report.learning.cohorts) {
      const card = node("article", "journal-record");
      card.append(node("strong", "", cohort.symbol + " · " + cohort.timeframe.toUpperCase() +
        " · " + cohort.decisionStatus + " · " + cohort.setupFamily));
      const metrics = node("div", "workbench-metrics");
      metrics.append(
        metric("Matured candidates", String(cohort.maturedCandidates)),
        metric("Completed trades", String(cohort.completedTrades)),
        metric("No fills", String(cohort.noFillCandidates)),
        metric("Mean net R", cohort.meanNetR === null ? "—" : cohort.meanNetR.toFixed(3)),
        metric("Median net R", cohort.medianNetR === null ? "—" : cohort.medianNetR.toFixed(3)),
        metric("Win rate", cohort.winRate === null ? "—" : (cohort.winRate * 100).toFixed(1) + "%"),
        metric("Mean MFE", cohort.meanMfeBps === null ? "—" : cohort.meanMfeBps.toFixed(1) + " bps"),
        metric("Mean MAE", cohort.meanMaeBps === null ? "—" : cohort.meanMaeBps.toFixed(1) + " bps"),
      );
      card.append(metrics);
      card.append(node("p", "small", "Simulation version: " + cohort.simulationVersion +
        " · Decision range: " + new Date(cohort.firstDecisionAt).toLocaleDateString() +
        " – " + new Date(cohort.lastDecisionAt).toLocaleDateString()));
      host.append(card);
    }
  }

  host.append(node("h3", "", "Excluded observations"));
  const exclusions = new Map<string, number>();
  for (const item of report.learning.excluded) {
    exclusions.set(item.reason, (exclusions.get(item.reason) ?? 0) + 1);
  }
  host.append(node("p", "small", exclusions.size
    ? [...exclusions.entries()].map(([reason, count]) => reason.replaceAll("_", " ") + ": " + count).join(" · ")
    : "No excluded learning observations."));
  if (report.failures.length) {
    host.append(node("h3", "", "Collection failures"));
    for (const failure of report.failures) {
      host.append(node("p", "small", failure.decisionId + " · " + failure.reason));
    }
  }
  host.append(node("p", "workbench-safety",
    "HYPOTHETICAL RESEARCH ONLY · Single public historical source (Binance) · No paper-account or exchange orders · Descriptive statistics are not proof of edge"));
  return host;
}

/** Manual, explicit collector; no background polling or paid service is used. */
export function mountShadowOutcomeConsole(root: HTMLElement, run: ShadowOutcomeRunner, runNoSetupReplay?: NoSetupReplayRunner): void {
  const panel = node("section", "panel journal-panel");
  panel.append(
    node("span", "panel-label", "CAUSAL OUTCOME EVALUATION"),
    node("h2", "", "Shadow outcomes & learning"),
    node("p", "small", "Fetch closed hourly candles after each pre-registered decision, simulate the frozen plan, and append a content-addressed outcome snapshot. The first candle proving the 24-hour horizon is a timestamp-only maturity proof; its OHLC is excluded from the path."),
    node("p", "small", "Only ENTER, WAIT or REJECT decisions with a candidate and a plan registered at decision time can be simulated. NO_SETUP and older decisions without a pre-registered plan are not reconstructed retrospectively."),
  );
  const controls = node("div", "journal-actions");
  const evaluate = node("button", "refresh-button", "Fetch candles & evaluate outcomes");
  evaluate.type = "button";
  controls.append(evaluate);
  panel.append(controls);
  const status = node("p", "small", "Ready · manual evaluation only");
  status.setAttribute("role", "status");
  panel.append(status);
  const output = node("div", "workbench-output");
  panel.append(output);
  if (runNoSetupReplay) {
    panel.append(node("h3", "", "Causal NO_SETUP diagnostics"));
    panel.append(node("p", "small", "Replays only the first post-decision 1H Donchian breakout using frozen decision-time inputs. This diagnostic does not replay higher-timeframe filters, create a trade plan, or enter shadow P&L cohorts."));
    const replayButton = node("button", "refresh-button", "Evaluate NO_SETUP replays");
    replayButton.type = "button";
    const replayStatus = node("p", "small", "Ready · manual evaluation only");
    replayStatus.setAttribute("role", "status");
    const replayOutput = node("div", "workbench-output");
    panel.append(replayButton, replayStatus, replayOutput);
    replayButton.addEventListener("click", () => {
      replayButton.disabled = true;
      replayStatus.textContent = "Fetching closed hourly candles and replaying frozen rules…";
      replayOutput.replaceChildren();
      void runNoSetupReplay().then((report) => {
        const metrics = node("div", "workbench-metrics");
        metrics.append(
          metric("Registered specs", String(report.replaySpecsFound)),
          metric("Evaluated", String(report.evaluated)),
          metric("First triggers", String(report.triggersDetected)),
          metric("No trigger yet", String(report.noTrigger)),
          metric("Already detected", String(report.alreadyDetected)),
        );
        replayOutput.append(metrics);
        for (const item of report.detected) {
          replayOutput.append(node("p", "small", item.decisionId + " · first trigger " +
            new Date(item.triggerAt).toLocaleString() + " · reference " + item.entryReferencePrice.toFixed(2) + " USDT"));
        }
        for (const failure of report.failures) {
          replayOutput.append(node("p", "small", failure.decisionId + " · " + failure.reason));
        }
        replayOutput.append(node("p", "workbench-safety", "DONCHIAN-ONLY DIAGNOSTIC · Not a full strategy pass · Not a simulated fill · Not included in performance statistics"));
        replayStatus.textContent = "Replay complete · " + report.triggersDetected + " new trigger(s)";
      }).catch((error: unknown) => {
        replayStatus.textContent = error instanceof Error ? "Replay failed: " + error.message : "Replay failed";
      }).finally(() => { replayButton.disabled = false; });
    });
  }
  root.replaceChildren(panel);

  evaluate.addEventListener("click", () => {
    evaluate.disabled = true;
    status.textContent = "Fetching post-decision history and evaluating fixed plans…";
    output.replaceChildren();
    void run().then((report) => {
      output.replaceChildren(renderReport(report));
      status.textContent = "Evaluation complete · " + report.outcomesRecorded +
        " new snapshots · " + report.learning.eligibleObservations + " mature observations";
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? "Evaluation failed: " + error.message : "Evaluation failed";
    }).finally(() => {
      evaluate.disabled = false;
    });
  });
}
