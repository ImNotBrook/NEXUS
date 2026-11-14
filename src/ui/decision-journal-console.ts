import { DecisionJournalStore } from "../adapters/decision-journal-store";
import type { DecisionJournalRecord } from "../domain/decision-journal";
import {
  buildDecisionJournalListItem,
  serializeDecisionJournalExport,
} from "../domain/decision-journal-view";

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

function renderRecord(record: DecisionJournalRecord): HTMLElement {
  const item = buildDecisionJournalListItem(record);
  const article = node("article", "journal-record");
  const header = node("div", "journal-record-header");
  const identity = node("div");
  identity.append(
    node("strong", "", item.symbol + " · " + item.timeframe.toUpperCase()),
    node("span", "journal-meta", new Date(item.decisionAt).toLocaleString()),
  );
  const status = node("span", "journal-status journal-status-" + item.status.toLowerCase(), item.status);
  header.append(identity, status);
  article.append(header);
  article.append(node("p", "journal-reasons", item.reasonSummary));
  article.append(node("p", "journal-thesis", item.thesisSummary));
  const details = node("details", "journal-details");
  details.append(node("summary", "", "Inspect immutable decision snapshot"));
  const snapshot = node("pre", "journal-snapshot", JSON.stringify(record, null, 2));
  details.append(snapshot);
  article.append(details);
  return article;
}

export function mountDecisionJournalConsole(root: HTMLElement): void {
  const store = new DecisionJournalStore();
  const panel = node("section", "panel journal-panel");
  panel.append(
    node("span", "panel-label", "DECISION AUDIT"),
    node("h2", "", "Immutable decision journal"),
    node("p", "small", "Every evaluated decision belongs here, including WAIT, REJECT and NO_SETUP. This view is read-only."),
  );
  const actions = node("div", "journal-actions");
  const refresh = node("button", "refresh-button", "Refresh journal");
  refresh.type = "button";
  const exportButton = node("button", "refresh-button", "Export JSON");
  exportButton.type = "button";
  exportButton.disabled = true;
  actions.append(refresh, exportButton);
  panel.append(actions);
  const status = node("p", "small", "Loading local journal…");
  status.setAttribute("role", "status");
  panel.append(status);
  const list = node("div", "journal-list");
  panel.append(list);
  root.replaceChildren(panel);

  let records: DecisionJournalRecord[] = [];

  const render = (): void => {
    list.replaceChildren();
    if (!records.length) {
      list.append(node("p", "small", "No decisions have been journalled on this device yet."));
      exportButton.disabled = true;
      return;
    }
    for (const record of records) list.append(renderRecord(record));
    exportButton.disabled = false;
  };

  const load = async (): Promise<void> => {
    refresh.disabled = true;
    status.textContent = "Reading local IndexedDB journal…";
    try {
      records = await store.list(100);
      render();
      status.textContent = records.length
        ? records.length + " most recent decision record(s) · stored on this device"
        : "Journal is empty · no decision records found";
    } catch (error) {
      status.textContent = error instanceof Error
        ? "Journal unavailable: " + error.message
        : "Journal unavailable";
    } finally {
      refresh.disabled = false;
    }
  };

  refresh.addEventListener("click", () => { void load(); });
  window.addEventListener("nexus:decision-journal-updated", () => { void load(); });
  exportButton.addEventListener("click", () => {
    if (!records.length) return;
    const blob = new Blob([serializeDecisionJournalExport(records)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = node("a");
    anchor.href = url;
    anchor.download = "nexus-decision-journal.json";
    anchor.click();
    URL.revokeObjectURL(url);
    status.textContent = "Export prepared · " + records.length + " complete record(s)";
  });

  void load();
}
