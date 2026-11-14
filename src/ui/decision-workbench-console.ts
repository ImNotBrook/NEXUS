import type { DecisionWorkbenchResult } from "../domain/decision-workbench-service";
import type { ApprovedDonchianStrategy } from "../domain/strategy-candidate-generator";

export type DecisionWorkbenchRunner = (
  strategy: ApprovedDonchianStrategy,
) => Promise<DecisionWorkbenchResult>;

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

function renderResult(result: DecisionWorkbenchResult): HTMLElement {
  const panel = node("div", "workbench-result");
  const { generation, assessment, gateAssessment } = result;
  const status = node(
    "span",
    "journal-status journal-status-" + assessment.result.status.toLowerCase(),
    assessment.result.status,
  );
  const heading = node("div", "workbench-result-heading");
  heading.append(
    node("strong", "", generation.candidate
      ? generation.candidate.symbol + " · " + generation.candidate.side.toUpperCase() + " · " + generation.candidate.timeframe
      : "No candidate generated"),
    status,
  );
  panel.append(heading);
  panel.append(node("p", "small", "Decision reasons: " + assessment.result.reasonCodes.join(" · ")));
  panel.append(node("p", "small", "Candidate generation: " + generation.reasonCodes.join(" · ")));

  if (generation.candidate) {
    const candidate = generation.candidate;
    const metrics = node("div", "workbench-metrics");
    metrics.append(
      metric("Entry reference", candidate.plan.entryPrice.toFixed(2)),
      metric("Stop", candidate.plan.stopPrice.toFixed(2)),
      metric("Target", candidate.plan.targetPrices[0].toFixed(2)),
      metric("Quantity", candidate.plan.quantity.toFixed(6)),
      metric("Support score*", assessment.result.supportScore.toFixed(3)),
      metric("Contradiction score*", assessment.result.contradictionScore.toFixed(3)),
      metric("Evidence coverage*", assessment.result.coverageScore.toFixed(3)),
      metric("Uncertainty*", assessment.result.uncertaintyScore.toFixed(3)),
    );
    if (gateAssessment) {
      metrics.append(
        metric("Gross risk", gateAssessment.metrics.grossRisk.toFixed(2) + " USDT"),
        metric("Net reward / risk*", gateAssessment.metrics.netRewardRisk.toFixed(2) + "R"),
      );
      panel.append(node("p", "small", "Risk gate: " +
        (gateAssessment.riskGate.eligible ? "PASS" : "BLOCKED") +
        (gateAssessment.riskGate.reasonCodes.length ? " · " + gateAssessment.riskGate.reasonCodes.join(", ") : "")));
      panel.append(node("p", "small", "Economics gate: " +
        (gateAssessment.economicsGate.eligible ? "PASS" : "BLOCKED") +
        (gateAssessment.economicsGate.reasonCodes.length ? " · " + gateAssessment.economicsGate.reasonCodes.join(", ") : "")));
    }
    panel.append(metrics);
    panel.append(node("p", "small", "Bull case: " + (generation.thesis.bullCase.join("; ") || "Not established")));
    panel.append(node("p", "small", "Bear case: " + (generation.thesis.bearCase.join("; ") || "Not established")));
    panel.append(node("p", "small", "Alternatives: " + generation.thesis.alternatives.join("; ")));
    const evidenceDetails = node("details", "journal-details");
    evidenceDetails.append(node("summary", "", "Inspect decision evidence and provenance"));
    for (const item of assessment.record.evidence) {
      evidenceDetails.append(node("p", "small",
        item.family.toUpperCase() + " · " + item.polarity.toUpperCase() + " · " +
        item.claim + " · strength " + item.strength.toFixed(2) +
        " · quality " + item.quality.toFixed(2) + " · " + item.timeframe.toUpperCase()));
    }
    panel.append(evidenceDetails);
  } else {
    panel.append(node("p", "small", "The detector did not create a trade plan. The status and reasons are journalled; no substitute entry is invented."));
  }

  panel.append(node("p", "workbench-safety", "PAPER RESEARCH ONLY · No order was sent · Scores are diagnostics, not probabilities"));
  panel.append(node("p", "small", "Shadow outcome plan: " +
    (result.shadowPlanRegistered && result.shadowPlan.status === "ready"
      ? "registered at decision time · 24-hour evaluation horizon"
      : result.shadowPlan.status === "not_simulatable"
        ? result.shadowPlan.reasonCode + " · " + result.shadowPlan.explanation
        : "not registered")));
  panel.append(node("p", "small", "Journal record: " + assessment.record.decisionId));
  panel.append(node("p", "small", "* Diagnostic score and net reward/risk are not probabilities or guarantees."));
  return panel;
}

/**
 * Mobile-first, explicit human approval and scan surface. Approval is held in
 * this page session only; each scan records its approver and rationale.
 */
export function mountDecisionWorkbenchConsole(
  root: HTMLElement,
  run: DecisionWorkbenchRunner,
): void {
  const panel = node("section", "panel workbench-panel");
  panel.append(
    node("span", "panel-label", "DETERMINISTIC STRATEGY PIPELINE"),
    node("h2", "", "Donchian breakout workbench"),
    node("p", "small", "A reviewed baseline scans completed 1H candles, checks 4H / 1H trend alignment, derives an ATR stop and target, then passes through hard risk and net execution-cost gates. It never submits orders."),
  );

  const form = node("div", "workbench-approval");
  const approverLabel = node("label", "workbench-label", "Approver");
  const approver = node("input", "workbench-input") as HTMLInputElement;
  approver.type = "text";
  approver.autocomplete = "off";
  approver.placeholder = "Enter your reviewer label";
  approverLabel.append(approver);

  const rationaleLabel = node("label", "workbench-label", "Approval rationale");
  const rationale = node("textarea", "workbench-input") as HTMLTextAreaElement;
  rationale.rows = 3;
  rationale.placeholder = "Why is this exact baseline approved for paper research?";
  rationaleLabel.append(rationale);
  form.append(approverLabel, rationaleLabel);
  panel.append(form);

  const controls = node("div", "workbench-actions");
  const approve = node("button", "refresh-button", "Approve baseline for this session");
  approve.type = "button";
  const scan = node("button", "refresh-button", "Refresh market and run scan");
  scan.type = "button";
  scan.disabled = true;
  controls.append(approve, scan);
  panel.append(controls);

  const status = node("p", "small", "Strategy not approved · enter an approver and rationale");
  status.setAttribute("role", "status");
  panel.append(status);
  const resultHost = node("div", "workbench-output");
  panel.append(resultHost);
  root.replaceChildren(panel);

  let approvedStrategy: ApprovedDonchianStrategy | null = null;

  approve.addEventListener("click", () => {
    const actor = approver.value.trim();
    const reason = rationale.value.trim();
    if (!actor || !reason) {
      status.textContent = "Approval requires both an approver label and a rationale.";
      return;
    }
    approvedStrategy = {
      id: "donchian-breakout",
      version: "1.0.0",
      approvedBy: actor,
      approvalRationale: reason,
      approvedAt: Date.now(),
      lookback: 20,
      atrStopMultiple: 2,
      rewardRiskMultiple: 2,
      riskBudget: 20,
      maxNotional: 2_000,
      expiryBars: 2,
    };
    scan.disabled = false;
    status.textContent = "Session approval recorded · " + actor + " · parameters are fixed for this scan";
  });

  const invalidateApproval = (): void => {
    if (!approvedStrategy) return;
    approvedStrategy = null;
    scan.disabled = true;
    status.textContent = "Approval invalidated · re-approve after changing the approver or rationale";
  };
  approver.addEventListener("input", invalidateApproval);
  rationale.addEventListener("input", invalidateApproval);

  scan.addEventListener("click", () => {
    if (!approvedStrategy) return;
    scan.disabled = true;
    approve.disabled = true;
    status.textContent = "Refreshing market feeds, evaluating the candidate and writing the journal…";
    resultHost.replaceChildren();
    void run(approvedStrategy).then((result) => {
      resultHost.replaceChildren(renderResult(result));
      status.textContent = "Decision persisted · " + result.assessment.result.status +
        " · " + result.assessment.record.decisionId;
      window.dispatchEvent(new Event("nexus:decision-journal-updated"));
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? "Scan failed: " + error.message : "Scan failed";
    }).finally(() => {
      approve.disabled = false;
      scan.disabled = !approvedStrategy;
    });
  });
}
