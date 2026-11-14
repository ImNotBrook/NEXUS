const ACTIONS_URL = "https://github.com/ImNotBrook/NEXUS/actions/workflows/automated-research.yml";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountAutomationConsole(container: HTMLElement): void {
  const panel = el("section", "panel automation-panel");
  panel.append(el("span", "panel-label", "RESEARCH AUTOMATION"));
  panel.append(el("h2", "", "Scheduled candidate research"));
  panel.append(el("p", "small", "Daily at 00:15 UTC, GitHub Actions fetches completed BTC/USDT hourly candles, generates a bounded candidate set and runs execution-aware walk-forward backtests. If the GROQ_API_KEY repository secret is configured, Groq can propose up to four parameter variants; otherwise the deterministic set runs."));
  const stats = el("div", "automation-facts");
  for (const [label, value] of [
    ["Candidate set", "16 deterministic + up to 4 AI proposals"],
    ["Strategy families", "SMA · RSI · Donchian"],
    ["Market history", "Up to 1,500 closed 1h candles"],
    ["Validation", "Expanding walk-forward · 2-bar embargo"],
    ["Execution costs", "Fees · slippage · spread · impact · participation cap"],
    ["Report retention", "30-day GitHub Actions artifact"],
  ]) {
    const item = el("div", "automation-fact");
    item.append(el("span", "", label), el("strong", "", value));
    stats.append(item);
  }
  panel.append(stats);
  const notice = el("p", "automation-notice", "AI proposals are optional and constrained to three reviewed strategy templates. Generated code is never executed. NEXUS does not promote a winner, place paper orders or trade live. No exchange credentials or paid AI services are required.");
  panel.append(notice);
  const actions = el("div", "automation-actions");
  const open = el("a", "automation-link", "Open automation runs");
  open.href = ACTIONS_URL;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  actions.append(open);
  panel.append(actions);
  const details = el("details", "automation-details");
  details.append(el("summary", "", "How to run research manually"));
  details.append(el("p", "small", "Open the workflow link, choose Run workflow, then open the completed run and download its nexus-automated-research artifact. Scheduled runs occur daily; GitHub may delay scheduled jobs."));
  panel.append(details);

  const paper = el("section", "panel automation-panel paper-agent-panel");
  paper.append(el("span", "panel-label", "PAPER EXECUTION AGENT"));
  paper.append(el("h2", "", "Persistent automated paper trading"));
  paper.append(el("p", "small", "A separate daily worker processes newly closed hourly candles, simulates next-open orders, carries partial fills forward and stores its checkpoint on a dedicated repository branch."));
  paper.append(el("p", "automation-notice", "DISABLED BY DEFAULT · The worker cannot start until a human approves one exact strategy configuration. It is paper-only, long-only, unleveraged and has a daily loss lockout. Live trading is not available."));
  const paperActions = el("div", "automation-actions");
  const paperWorkflow = el("a", "automation-link", "Open paper trading workflow");
  paperWorkflow.href = "https://github.com/ImNotBrook/NEXUS/actions/workflows/paper-trading.yml";
  paperWorkflow.target = "_blank";
  paperWorkflow.rel = "noopener noreferrer";
  const paperConfig = el("a", "automation-link", "View approval configuration");
  paperConfig.href = "https://github.com/ImNotBrook/NEXUS/blob/nexus-paper-ledger/data/paper-trading-config.json";
  paperConfig.target = "_blank";
  paperConfig.rel = "noopener noreferrer";
  paperActions.append(paperWorkflow, paperConfig);
  paper.append(paperActions);
  const paperDetails = el("details", "automation-details");
  paperDetails.append(el("summary", "", "What approval means"));
  paperDetails.append(el("p", "small", "A strategy must first pass nested walk-forward review and an untouched holdout. The ledger config records the exact strategy ID, parameters, approver, rationale and approval timestamp. No strategy is selected automatically."));
  paper.append(paperDetails);
  container.replaceChildren(panel, paper);
}
