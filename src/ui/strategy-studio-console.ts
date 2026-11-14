import { StrategyLibraryStore, type StoredStrategyDefinition } from "../adapters/strategy-library-store";
import { createLocalBackup, parseLocalBackup, type LocalBackupEnvelope } from "../domain/local-backup";
import { createHumanReviewedComposedStrategyDefinition, createHumanReviewedStrategyDefinition, parseAutomatedResearchAiArtifact } from "../domain/ai-strategy-review";
import {
  STRATEGY_TEMPLATE_CATALOG,
  createStrategyDefinition,
  type StrategyDefinition,
  type StrategyFamily,
} from "../domain/strategy-studio";

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

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function field(labelText: string, name: string, value: string, type = "text"): HTMLLabelElement {
  const label = el("label", "strategy-field", labelText);
  const input = el("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.required = true;
  label.append(input);
  return label;
}

export function mountStrategyStudioConsole(root: HTMLElement): void {
  root.replaceChildren();
  const store = new StrategyLibraryStore();
  const section = el("section", "saved-research strategy-studio");
  section.append(
    el("h2", "", "Strategy Creation Studio"),
    el("p", "small", "Create immutable, versioned strategy definitions from reviewed deterministic templates. Saved strategies can enter historical research; saving does not approve paper execution."),
  );

  const form = el("form", "strategy-studio-form");
  const templateLabel = el("label", "strategy-field", "Strategy template");
  const templateSelect = el("select");
  templateSelect.name = "template";
  for (const template of STRATEGY_TEMPLATE_CATALOG) {
    const option = el("option", "", template.name);
    option.value = template.id;
    templateSelect.append(option);
  }
  templateLabel.append(templateSelect);

  const identity = el("div", "strategy-form-grid");
  const idField = field("Strategy ID (lowercase kebab-case)", "strategyId", "my-strategy");
  const nameField = field("Display name", "name", "My strategy");
  const descriptionField = field("Description", "description", "A transparent strategy definition.");
  const versionField = field("Version", "version", "1.0.0");
  identity.append(idField, nameField, versionField, descriptionField);

  const parameterFields = el("div", "strategy-form-grid");
  const status = el("p", "small", "Definitions are stored locally on this device.");
  status.setAttribute("role", "status");
  const submit = el("button", "primary-button", "Save strategy version");
  submit.type = "submit";
  form.append(templateLabel, identity, el("h3", "", "Strategy parameters"), parameterFields, submit, status);

  const library = el("div", "strategy-library");
  const libraryHeading = el("h3", "", "Saved strategy versions");
  section.append(form, libraryHeading, library);

  const aiInbox = el("section", "research-result ai-strategy-inbox");
  aiInbox.append(
    el("h3", "", "AI Strategy Proposal Inbox"),
    el("p", "small", "NEXUS generates strategies in its scheduled AI research workflow. Refresh to load the latest proposal feed automatically, or import a downloaded automated-research.json artifact. Every proposal requires your explicit approval before it enters the strategy library."),
  );
  const refreshAiFeed = el("button", "primary-button", "Refresh latest AI proposals");
  refreshAiFeed.type = "button";
  const aiArtifactLabel = el("label", "strategy-field", "Or import automated-research.json");
  const aiArtifactFile = el("input");
  aiArtifactFile.type = "file";
  aiArtifactFile.accept = "application/json,.json";
  aiArtifactLabel.append(aiArtifactFile);
  const aiInboxStatus = el("p", "small", "No AI research artifact loaded.");
  aiInboxStatus.setAttribute("role", "status");
  const aiProposalList = el("div", "strategy-library");
  aiInbox.append(refreshAiFeed, aiArtifactLabel, aiInboxStatus, aiProposalList);
  section.append(aiInbox);

  const renderAiArtifact = (input: unknown, source: string): void => {
    aiProposalList.replaceChildren();
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const generation = (input as { aiGeneration?: { status?: unknown } }).aiGeneration;
      if (generation?.status !== "generated") {
        aiInboxStatus.textContent = "Latest research feed (" + source + ") reports AI status: " +
          String(generation?.status ?? "unknown") +
          ". No AI proposals are available from this run; deterministic research remains available.";
        return;
      }
    }
    try {
      const parsed = parseAutomatedResearchAiArtifact(input);
      aiInboxStatus.textContent = "Validated " + parsed.proposals.length + " AI proposal(s) · " +
        parsed.provider + " / " + parsed.model + " · " + parsed.symbol + " " + parsed.interval +
        " · generated " + new Date(parsed.createdAt).toLocaleString() +
        " · source: " + source + ". Review each proposal before approving it into the strategy library.";
      parsed.proposals.forEach((proposal, index) => {
        const card = el("article", "research-result");
        const parameters = Object.entries(proposal.parameters).map(([key, value]) => key + "=" + value).join(" · ");
        const heading = el("h4", "", "AI proposal " + (index + 1) + " · " + proposal.family);
        const detail = el("p", "small", parameters);
        const rationale = el("p", "small", "AI rationale: " + proposal.rationale);
        const approval = el("button", "primary-button", "Approve and save strategy");
        approval.type = "button";
        const result = el("p", "small", "Not approved · no strategy has been saved.");
        result.setAttribute("role", "status");
        approval.addEventListener("click", async () => {
          approval.disabled = true;
          try {
            const definition = createHumanReviewedStrategyDefinition(proposal, Date.now(), parsed);
            const saved = await store.save(definition as import("../domain/strategy-studio").StrategyDefinition);
            result.textContent = "Human-approved and saved as " + saved.id +
              ". It is now eligible for historical research, but not approved for paper execution.";
            approval.textContent = "Approved";
            await refreshLibrary();
          } catch (error) {
            result.textContent = error instanceof Error ? "Approval/save refused: " + error.message : "Approval/save refused";
            approval.disabled = false;
          }
        });
        card.append(heading, detail, rationale, approval, result);
        aiProposalList.append(card);
      });
      parsed.composedStrategies.forEach((specification, index) => {
        const card = el("article", "research-result");
        const trigger = specification.entry.trigger;
        const triggerText = trigger.type === "sma_cross"
          ? "SMA cross " + trigger.fastPeriod + "/" + trigger.slowPeriod
          : trigger.type === "rsi_recovery"
            ? "RSI " + trigger.period + " recovery above " + trigger.oversold
            : "Donchian breakout " + trigger.period;
        const confirmationText = specification.entry.confirmations.map((filter) =>
          "EMA alignment " + filter.fastPeriod + "/" + filter.slowPeriod,
        ).join(" AND ") || "No additional confirmation";
        const exit = specification.exit.type === "opposite_sma_cross"
          ? "Opposite SMA cross " + specification.exit.fastPeriod + "/" + specification.exit.slowPeriod
          : specification.exit.type === "rsi_overbought"
            ? "RSI " + specification.exit.period + " >= " + specification.exit.threshold
            : "Close below SMA " + specification.exit.period;
        const heading = el("h4", "", "AI-composed strategy " + (index + 1) + " · " + specification.name);
        const details = el("p", "small", "Entry: " + triggerText + " · " + confirmationText + " · Exit: " + exit + " · Regime: " + specification.regimeScope);
        const hypothesis = el("p", "small", "Hypothesis: " + specification.marketHypothesis);
        const invalidation = el("p", "small", "Invalidation: " + specification.invalidation);
        const approval = el("button", "primary-button", "Approve and save complete strategy");
        approval.type = "button";
        const result = el("p", "small", "Not approved · no strategy has been saved.");
        result.setAttribute("role", "status");
        approval.addEventListener("click", async () => {
          approval.disabled = true;
          try {
            const definition = createHumanReviewedComposedStrategyDefinition(specification, Date.now(), parsed);
            const saved = await store.save(definition as StrategyDefinition);
            result.textContent = "Human-approved and saved as " + saved.id + ". Eligible for historical research only; paper execution still requires separate qualification and approval.";
            approval.textContent = "Approved";
            await refreshLibrary();
          } catch (error) {
            result.textContent = error instanceof Error ? "Approval/save refused: " + error.message : "Approval/save refused";
            approval.disabled = false;
          }
        });
        card.append(heading, details, hypothesis, invalidation, approval, result);
        aiProposalList.append(card);
      });
    } catch (error) {
      aiInboxStatus.textContent = error instanceof Error ? "AI artifact rejected: " + error.message : "AI artifact rejected";
    }
  };

  refreshAiFeed.addEventListener("click", async () => {
    refreshAiFeed.disabled = true;
    aiInboxStatus.textContent = "Fetching latest scheduled AI proposal feed…";
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/ImNotBrook/NEXUS/ai-proposals/ai-strategy-proposals.json",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Latest AI feed is not available yet (HTTP " + response.status + ")");
      renderAiArtifact(await response.json() as unknown, "latest scheduled feed");
    } catch (error) {
      aiInboxStatus.textContent = error instanceof Error
        ? error.message + ". Run NEXUS Automated Research successfully, or import its downloaded JSON artifact."
        : "Could not load the latest AI proposal feed.";
    } finally {
      refreshAiFeed.disabled = false;
    }
  });

  aiArtifactFile.addEventListener("change", async () => {
    const file = (aiArtifactFile as HTMLInputElement).files?.[0];
    if (!file) {
      aiInboxStatus.textContent = "No AI research artifact loaded.";
      return;
    }
    aiInboxStatus.textContent = "Validating AI research artifact and proposal schemas…";
    try {
      renderAiArtifact(JSON.parse(await file.text()) as unknown, file.name);
    } catch (error) {
      aiInboxStatus.textContent = error instanceof Error ? "AI artifact rejected: " + error.message : "AI artifact rejected";
    }
  });

  const backupPanel = el("section", "research-result strategy-backup");
  backupPanel.append(
    el("h3", "", "Strategy library backup"),
    el("p", "small", "Export every saved immutable strategy version to a JSON file on your device. Restore is append-only: identical versions are skipped and conflicting content is blocked."),
  );
  const exportBackup = el("button", "primary-button", "Download strategy library backup");
  exportBackup.type = "button";
  const backupFileLabel = el("label", "strategy-field", "Select strategy library backup");
  const backupFile = el("input");
  backupFile.type = "file";
  backupFile.accept = "application/json,.json";
  backupFileLabel.append(backupFile);
  const backupPreview = el("p", "small", "No strategy backup selected");
  backupPreview.setAttribute("role", "status");
  const restoreBackup = el("button", "primary-button", "Confirm strategy restore");
  restoreBackup.type = "button";
  restoreBackup.disabled = true;
  backupPanel.append(exportBackup, backupFileLabel, backupPreview, restoreBackup);
  section.append(backupPanel);
  root.append(section);

  let pendingBackup: LocalBackupEnvelope<{ records: StoredStrategyDefinition[] }> | null = null;
  exportBackup.addEventListener("click", async () => {
    exportBackup.disabled = true;
    try {
      const records = await store.exportAll();
      if (!records.length) throw new Error("There are no saved strategy versions to back up");
      const backup = await createLocalBackup("strategy-library", { records });
      downloadJson("nexus-strategy-library-backup-" + new Date().toISOString().slice(0, 10) + ".json", backup);
      backupPreview.textContent = "Full strategy library backup downloaded · " + records.length + " immutable version(s).";
    } catch (error) {
      backupPreview.textContent = error instanceof Error ? "Strategy backup failed: " + error.message : "Strategy backup failed";
    } finally {
      exportBackup.disabled = false;
    }
  });
  backupFile.addEventListener("change", async () => {
    pendingBackup = null;
    restoreBackup.disabled = true;
    const file = (backupFile as HTMLInputElement).files?.[0];
    if (!file) {
      backupPreview.textContent = "No strategy backup selected";
      return;
    }
    backupPreview.textContent = "Verifying strategy backup checksum and records…";
    try {
      const envelope = await parseLocalBackup(await file.text(), "strategy-library");
      if (!Array.isArray(envelope.payload.records)) throw new Error("Strategy backup must contain a record array");
      const preview = await store.previewRestore(envelope.payload.records);
      pendingBackup = envelope as unknown as LocalBackupEnvelope<{ records: StoredStrategyDefinition[] }>;
      backupPreview.textContent = "Verified " + file.name + " · " + envelope.payload.records.length +
        " version(s) · " + preview.added + " new · " + preview.unchanged + " identical · " +
        preview.conflicts.length + " conflict(s). " +
        (preview.conflicts.length ? preview.conflicts.join("; ") : "Confirm to import without overwriting existing versions.");
      restoreBackup.disabled = preview.conflicts.length > 0;
    } catch (error) {
      backupPreview.textContent = error instanceof Error ? "Strategy backup rejected: " + error.message : "Strategy backup rejected";
    }
  });
  restoreBackup.addEventListener("click", async () => {
    if (!pendingBackup) return;
    restoreBackup.disabled = true;
    try {
      const result = await store.restoreAll(pendingBackup.payload.records);
      backupPreview.textContent = "Restore complete · added " + result.added +
        " version(s) · skipped identical " + result.unchanged + ". Existing definitions were not overwritten.";
      pendingBackup = null;
      (backupFile as HTMLInputElement).value = "";
      await refreshLibrary();
    } catch (error) {
      backupPreview.textContent = error instanceof Error ? "Strategy restore refused: " + error.message : "Strategy restore refused";
      restoreBackup.disabled = false;
    }
  });

  const selectedTemplate = (): typeof STRATEGY_TEMPLATE_CATALOG[number] => {
    const match = STRATEGY_TEMPLATE_CATALOG.find((item) => item.id === templateSelect.value);
    if (!match) throw new Error("Select a supported strategy template");
    return match;
  };

  const renderParameterFields = (): void => {
    parameterFields.replaceChildren();
    const parameters = selectedTemplate().definition.parameters;
    for (const [key, value] of Object.entries(parameters)) {
      parameterFields.append(field(
        key.replace(/[A-Z]/g, (letter) => " " + letter.toLowerCase()).replace(/^./, (letter) => letter.toUpperCase()),
        key,
        String(value),
        "number",
      ));
    }
  };

  const refreshLibrary = async (): Promise<void> => {
    try {
      const records = await store.list(100);
      library.replaceChildren();
      if (!records.length) {
        library.append(el("p", "small", "No saved strategies yet. Create your first version above."));
        return;
      }
      for (const record of records) {
        const card = el("article", "research-result");
        const definition = record.definition;
        card.append(
          el("h4", "", definition.name + " · v" + definition.version),
          el("p", "small", definition.family + " · " + definition.id),
          el("p", "small", definition.description),
          el("p", "small", "Parameters: " + Object.entries(definition.parameters).map(([key, value]) => key + "=" + value).join(" · ")),
          el("p", "small", "Created " + new Date(record.createdAt).toLocaleString() + " · " + definition.origin),
          el("p", "small", "Immutable version. Create a higher version to change parameters."),
        );
        library.append(card);
      }
    } catch (error) {
      library.replaceChildren(el("p", "small", error instanceof Error ? error.message : "Could not load the strategy library"));
    }
  };

  templateSelect.addEventListener("change", renderParameterFields);
  renderParameterFields();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = new FormData(form);
    const template = selectedTemplate();
    const parameters: Record<string, number> = {};
    for (const [key] of Object.entries(template.definition.parameters)) {
      const raw = String(data.get(key) ?? "");
      if (raw.trim() === "") {
        status.textContent = "Every strategy parameter is required.";
        return;
      }
      parameters[key] = Number(raw);
    }
    const definition: StrategyDefinition = {
      schemaVersion: 1,
      id: String(data.get("strategyId") ?? ""),
      version: String(data.get("version") ?? ""),
      name: String(data.get("name") ?? ""),
      family: template.id as StrategyFamily,
      parameters: parameters as StrategyDefinition["parameters"],
      createdAt: Date.now(),
      origin: "human",
      description: String(data.get("description") ?? ""),
    };
    let immutable: Readonly<StrategyDefinition>;
    try {
      immutable = createStrategyDefinition(definition);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Strategy definition is invalid";
      return;
    }
    submit.disabled = true;
    status.textContent = "Saving immutable strategy version…";
    void store.save(immutable as StrategyDefinition).then(async (saved) => {
      status.textContent = "Saved " + saved.definition.id + "@" + saved.definition.version + " locally. It is available to historical research, not approved for paper execution.";
      await refreshLibrary();
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : "Could not save strategy version";
    }).finally(() => {
      submit.disabled = false;
    });
  });

  void refreshLibrary();
}
