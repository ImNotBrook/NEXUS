import { DecisionJournalStore } from "../adapters/decision-journal-store";
import { PaperAccountStore } from "../adapters/paper-account-store";
import type { DecisionJournalEvent, DecisionJournalRecord } from "../domain/decision-journal";
import type { PaperAccount } from "../domain/paper-broker";
import { isPristinePaperAccount, validatePaperAccountSnapshot } from "../domain/paper-broker";
import {
  createLocalBackup,
  parseLocalBackup,
  type LocalBackupEnvelope,
} from "../domain/local-backup";
import { buildDecisionJournalListItem } from "../domain/decision-journal-view";

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

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  details.append(node("pre", "journal-snapshot", JSON.stringify(record, null, 2)));
  article.append(details);
  return article;
}

interface JournalBackupPayload {
  records: DecisionJournalRecord[];
  events: DecisionJournalEvent[];
}
interface PaperBackupPayload {
  account: PaperAccount;
}

export function mountDecisionJournalConsole(root: HTMLElement): void {
  const store = new DecisionJournalStore();
  const paperStore = new PaperAccountStore();
  const panel = node("section", "panel journal-panel");
  panel.append(
    node("span", "panel-label", "DECISION AUDIT"),
    node("h2", "", "Immutable decision journal"),
    node("p", "small", "Every evaluated decision belongs here, including WAIT, REJECT and NO_SETUP. This view is read-only."),
  );
  const actions = node("div", "journal-actions");
  const refresh = node("button", "refresh-button", "Refresh journal");
  refresh.type = "button";
  actions.append(refresh);
  panel.append(actions);
  const status = node("p", "small", "Loading local journal…");
  status.setAttribute("role", "status");
  panel.append(status);
  const list = node("div", "journal-list");
  panel.append(list);

  const backupPanel = node("section", "panel journal-backup-panel");
  backupPanel.append(
    node("span", "panel-label", "LOCAL DATA PROTECTION"),
    node("h2", "", "Backup and restore"),
    node("p", "small", "Backups are generated locally and downloaded to your device. Decision evidence and paper-account state use separate files. Restore never overwrites existing IDs or an existing paper account."),
  );

  const journalExport = node("button", "refresh-button", "Download full decision journal backup");
  journalExport.type = "button";
  const paperExport = node("button", "refresh-button", "Download separate paper account backup");
  paperExport.type = "button";
  const exportActions = node("div", "journal-actions");
  exportActions.append(journalExport, paperExport);
  backupPanel.append(exportActions);

  const journalRestoreLabel = node("label", "small", "Select decision journal backup");
  const journalFile = node("input");
  journalFile.type = "file";
  journalFile.id = "nexus-journal-backup-file";
  journalRestoreLabel.htmlFor = journalFile.id;
  journalFile.accept = "application/json,.json";
  journalFile.setAttribute("aria-label", "Select decision journal backup file");
  const journalPreview = node("p", "small", "No journal backup selected");
  journalPreview.setAttribute("role", "status");
  const journalConfirm = node("button", "refresh-button", "Confirm journal restore");
  journalConfirm.type = "button";
  journalConfirm.disabled = true;
  backupPanel.append(journalRestoreLabel, journalFile, journalPreview, journalConfirm);

  const paperRestoreLabel = node("label", "small", "Select paper account backup");
  const paperFile = node("input");
  paperFile.type = "file";
  paperFile.id = "nexus-paper-backup-file";
  paperRestoreLabel.htmlFor = paperFile.id;
  paperFile.accept = "application/json,.json";
  paperFile.setAttribute("aria-label", "Select paper account backup file");
  const paperPreview = node("p", "small", "No paper account backup selected");
  paperPreview.setAttribute("role", "status");
  const paperConfirm = node("button", "refresh-button", "Confirm paper account restore");
  paperConfirm.type = "button";
  paperConfirm.disabled = true;
  backupPanel.append(paperRestoreLabel, paperFile, paperPreview, paperConfirm);
  root.replaceChildren(panel, backupPanel);

  let records: DecisionJournalRecord[] = [];
  let pendingJournal: LocalBackupEnvelope<JournalBackupPayload> | null = null;
  let pendingPaper: LocalBackupEnvelope<PaperBackupPayload> | null = null;

  const render = (): void => {
    list.replaceChildren();
    if (!records.length) {
      list.append(node("p", "small", "No decisions have been journalled on this device yet."));
      return;
    }
    for (const record of records) list.append(renderRecord(record));
  };

  const load = async (): Promise<void> => {
    refresh.disabled = true;
    status.textContent = "Reading all local IndexedDB journal records…";
    try {
      const snapshot = await store.exportAll();
      records = snapshot.records.sort((a, b) =>
        b.decisionAt - a.decisionAt || b.decisionId.localeCompare(a.decisionId),
      ).slice(0, 100);
      render();
      status.textContent = snapshot.records.length
        + " total decision record(s) and " + snapshot.events.length
        + " linked event(s) · newest 100 displayed · stored on this device";
    } catch (error) {
      status.textContent = error instanceof Error ? "Journal unavailable: " + error.message : "Journal unavailable";
    } finally {
      refresh.disabled = false;
    }
  };

  journalExport.addEventListener("click", async () => {
    journalExport.disabled = true;
    try {
      const snapshot = await store.exportAll();
      if (!snapshot.records.length) throw new Error("There are no decision records to back up");
      const backup = await createLocalBackup("decision-journal", snapshot);
      downloadJson("nexus-decision-journal-backup-" + new Date().toISOString().slice(0, 10) + ".json", backup);
      status.textContent = "Full journal backup downloaded · " + snapshot.records.length + " decisions · " + snapshot.events.length + " events";
    } catch (error) {
      status.textContent = error instanceof Error ? "Journal backup failed: " + error.message : "Journal backup failed";
    } finally {
      journalExport.disabled = false;
    }
  });

  paperExport.addEventListener("click", async () => {
    paperExport.disabled = true;
    try {
      const account = await paperStore.load();
      if (!account) throw new Error("No paper account exists on this device yet");
      const backup = await createLocalBackup("paper-account", { account });
      downloadJson("nexus-paper-account-backup-" + new Date().toISOString().slice(0, 10) + ".json", backup);
      paperPreview.textContent = "Paper account backup downloaded separately · " + account.fills.length + " fills · " + Object.keys(account.positions).length + " open positions";
    } catch (error) {
      paperPreview.textContent = error instanceof Error ? "Paper backup failed: " + error.message : "Paper backup failed";
    } finally {
      paperExport.disabled = false;
    }
  });

  journalFile.addEventListener("change", async () => {
    pendingJournal = null;
    journalConfirm.disabled = true;
    const file = journalFile.files?.[0];
    if (!file) {
      journalPreview.textContent = "No journal backup selected";
      return;
    }
    journalPreview.textContent = "Checking file integrity and backup structure…";
    try {
      const envelope = await parseLocalBackup(await file.text(), "decision-journal");
      if (!Array.isArray(envelope.payload.records) || !Array.isArray(envelope.payload.events)) {
        throw new Error("Journal backup must contain both records and linked events");
      }
      pendingJournal = envelope as LocalBackupEnvelope<JournalBackupPayload>;
      const preview = await store.previewRestore(pendingJournal.payload);
      journalPreview.textContent = "Verified " + file.name + " · " + envelope.payload.records.length
        + " decisions · " + envelope.payload.events.length + " events · checksum valid. Preview: "
        + preview.addedRecords + " new decisions, " + preview.addedEvents + " new events, "
        + (preview.unchangedRecords + preview.unchangedEvents) + " identical duplicates. "
        + (preview.conflicts.length ? "Restore blocked: " + preview.conflicts.join("; ") : "No conflicts. Confirm to import.");
      journalConfirm.disabled = preview.conflicts.length > 0;
    } catch (error) {
      journalPreview.textContent = error instanceof Error ? "Journal backup rejected: " + error.message : "Journal backup rejected";
    }
  });

  journalConfirm.addEventListener("click", async () => {
    if (!pendingJournal) return;
    journalConfirm.disabled = true;
    journalPreview.textContent = "Validating and restoring journal in one transaction…";
    try {
      const result = await store.restoreAll(pendingJournal.payload);
      journalPreview.textContent = "Restore complete · added " + result.addedRecords + " decisions and "
        + result.addedEvents + " events · unchanged duplicates " + (result.unchangedRecords + result.unchangedEvents)
        + ". Existing records were not overwritten.";
      pendingJournal = null;
      journalFile.value = "";
      window.dispatchEvent(new CustomEvent("nexus:decision-journal-updated"));
      await load();
    } catch (error) {
      journalPreview.textContent = error instanceof Error ? "Restore refused: " + error.message : "Restore refused";
      journalConfirm.disabled = false;
    }
  });

  paperFile.addEventListener("change", async () => {
    pendingPaper = null;
    paperConfirm.disabled = true;
    const file = paperFile.files?.[0];
    if (!file) {
      paperPreview.textContent = "No paper account backup selected";
      return;
    }
    paperPreview.textContent = "Checking paper account backup…";
    try {
      const envelope = await parseLocalBackup(await file.text(), "paper-account");
      validatePaperAccountSnapshot(envelope.payload.account);
      pendingPaper = envelope as LocalBackupEnvelope<PaperBackupPayload>;
      const current = await paperStore.load();
      if (current && !isPristinePaperAccount(current)) {
        paperPreview.textContent = "Verified backup, but this device already has paper trading activity. Restore is blocked to protect existing state. Export the current account first; active accounts are never overwritten.";
        pendingPaper = null;
        return;
      }
      const account = pendingPaper.payload.account;
      paperPreview.textContent = "Verified " + file.name + " · cash " + account.cash.toFixed(2)
        + " · " + account.fills.length + " fills · " + Object.keys(account.positions).length
        + " positions · checksum valid. Confirm to restore. Only an untouched starter account may be replaced.";
      paperConfirm.disabled = false;
    } catch (error) {
      paperPreview.textContent = error instanceof Error ? "Paper backup rejected: " + error.message : "Paper backup rejected";
    }
  });

  paperConfirm.addEventListener("click", async () => {
    if (!pendingPaper) return;
    paperConfirm.disabled = true;
    try {
      await paperStore.restore(pendingPaper.payload.account);
      paperPreview.textContent = "Paper account restored. Existing accounts are never overwritten.";
      pendingPaper = null;
      paperFile.value = "";
      window.dispatchEvent(new CustomEvent("nexus:paper-account-updated"));
    } catch (error) {
      paperPreview.textContent = error instanceof Error ? "Paper restore refused: " + error.message : "Paper restore refused";
      paperConfirm.disabled = false;
    }
  });

  refresh.addEventListener("click", () => { void load(); });
  window.addEventListener("nexus:decision-journal-updated", () => { void load(); });
  void load();
}
