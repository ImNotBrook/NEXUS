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
  panel.append(el("p", "small", "Daily at 00:15 UTC, GitHub Actions fetches completed BTC/USDT hourly candles, generates a bounded candidate set and runs execution-aware walk-forward backtests."));
  const stats = el("div", "automation-facts");
  for (const [label, value] of [
    ["Candidate set", "16 deterministic variants"],
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
  const notice = el("p", "automation-notice", "Important: this first automation is deterministic parameterized research, not an LLM. It does not promote a winner, place paper orders or trade live. No exchange credentials or paid AI services are used.");
  panel.append(notice);
  const actions = el("div", "automation-actions");
  const open = el("a", "automation-link", "Open automation runs");
  open.href = ACTIONS_URL;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  actions.append(open);
  panel.append(actions);
  const details = el("details", "automation-details");
  details.append(el("summary", "", "How to run it manually"));
  details.append(el("p", "small", "Open the workflow link, choose Run workflow, then open the completed run and download its nexus-automated-research artifact. Scheduled runs occur daily; GitHub may delay scheduled jobs."));
  panel.append(details);
  container.replaceChildren(panel);
}
