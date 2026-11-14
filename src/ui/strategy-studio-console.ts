import { StrategyLibraryStore } from "../adapters/strategy-library-store";
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
  root.append(section);

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
