export interface WorkspacePage {
  id: string;
  label: string;
  group: string;
  description: string;
  help: string;
}

export const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  { id: "overview", label: "Overview", group: "Workspace", description: "A concise view of market state and NEXUS readiness.", help: "Your landing page. It summarises the system and links you to the main work areas." },
  { id: "markets", label: "Market data", group: "Workspace", description: "Live public market snapshots and data-quality checks.", help: "Market prices come from public exchange candle feeds. Cross-feed and freshness checks determine whether paper orders are unlocked." },
  { id: "paper", label: "Paper trading", group: "Workspace", description: "A simulated account. No orders are sent to an exchange.", help: "Practice with simulated funds only. Fees and adverse slippage are applied. This is not live trading." },
  { id: "workbench", label: "Decision workbench", group: "Research", description: "Approve a deterministic baseline, generate candidates and inspect hard-gate decisions.", help: "A human must approve the exact baseline and rationale for this session. The workbench uses completed candles, causal market evidence, explicit risk limits and execution costs. Every scan is journalled. It never sends an exchange order." },
  { id: "decisions", label: "Decision journal", group: "Research", description: "Inspect immutable decision records and export the local audit ledger.", help: "Every decision status is recorded locally with its evidence, thesis, reasons and software-policy versions. Export regularly: this journal is stored only in this browser on this device." },
  { id: "outcomes", label: "Shadow outcomes", group: "Research", description: "Evaluate frozen candidate plans against subsequent closed candles and inspect mature cohorts.", help: "Only plans registered with the original decision can be simulated. Outcome candles are kept separate from decision evidence; incomplete, ambiguous or data-degraded paths are excluded from learning metrics. This is hypothetical research, not execution." },
  { id: "research", label: "Strategy research", group: "Research", description: "Build repeatable experiments and evaluate strategies out of sample.", help: "Run historical experiments with walk-forward folds, execution costs, protective exits and saved reports. Results are historical simulations, not forecasts." },
  { id: "skills", label: "Skill intelligence", group: "Research", description: "Review external trading research skills and their provenance.", help: "Candidate skills are reviewed for source, licence, tests and security. External code is not executed or automatically trusted." },
  { id: "automation", label: "Automation", group: "Automation", description: "Inspect scheduled candidate research and its execution history.", help: "Daily research can optionally use Groq to propose parameters within reviewed strategy templates. Automated paper trading runs hourly only after a human approves an exact strategy and risk configuration. Live trading remains disabled." },
  { id: "system", label: "Controls & safety", group: "Controls", description: "Qualification rules, execution restrictions and safeguards.", help: "Qualification can only request human review. It never enables live trading; live execution remains locked." },
] as const;

export function getWorkspacePage(id: string): WorkspacePage | undefined {
  return WORKSPACE_PAGES.find((page) => page.id === id);
}
