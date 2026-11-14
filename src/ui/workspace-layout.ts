import { WORKSPACE_PAGES } from "../domain/workspace-navigation";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let helpPopoverSequence = 0;

function attachHelp(button: HTMLButtonElement, explanation: string, host: HTMLElement): void {
  const bubble = element("div", "help-popover", explanation);
  bubble.hidden = true;
  bubble.id = `help-${++helpPopoverSequence}`;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", bubble.id);
  button.addEventListener("click", () => {
    bubble.hidden = !bubble.hidden;
    button.setAttribute("aria-expanded", String(!bubble.hidden));
  });
  host.append(bubble);
}

function helpButton(label: string, explanation: string): HTMLButtonElement {
  const button = element("button", "help-button", "?");
  button.type = "button";
  button.setAttribute("aria-label", `Help: ${label}`);
  button.title = explanation;
  return button;
}

export function mountWorkspaceLayout(root: HTMLElement): void {
  const shell = root.querySelector<HTMLElement>(".shell");
  const topbar = shell?.querySelector<HTMLElement>(".topbar");
  const hero = shell?.querySelector<HTMLElement>(".hero");
  const grid = shell?.querySelector<HTMLElement>(".grid");
  const research = shell?.querySelector<HTMLElement>("#research-console-mount");
  const skills = shell?.querySelector<HTMLElement>("#skill-console-mount");
  const footer = shell?.querySelector<HTMLElement>("footer");
  if (!shell || !topbar || !hero || !grid || !research || !skills || !footer) return;

  const panels = Array.from(grid.children) as HTMLElement[];
  if (panels.length < 5) return;
  const pageContent: Record<string, HTMLElement[]> = {
    overview: [hero],
    markets: [panels[0]],
    paper: [panels[1]],
    research: [research],
    skills: [skills],
    system: panels.slice(2),
  };

  const toggle = element("button", "sidebar-toggle", "☰");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Open navigation");
  toggle.setAttribute("aria-expanded", "false");
  topbar.prepend(toggle);

  const layout = element("div", "workspace-layout");
  const sidebar = element("aside", "workspace-sidebar");
  sidebar.setAttribute("aria-label", "Main navigation");
  const sidebarBrand = element("div", "sidebar-heading", "NEXUS WORKSPACE");
  sidebar.append(sidebarBrand);

  const nav = element("nav", "workspace-nav");
  nav.setAttribute("aria-label", "Workspace sections");
  const pages = new Map<string, HTMLElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  const groups = [...new Set(WORKSPACE_PAGES.map((page) => page.group))];

  for (const groupName of groups) {
    const group = element("div", "nav-group");
    group.append(element("p", "nav-group-label", groupName));
    for (const page of WORKSPACE_PAGES.filter((item) => item.group === groupName)) {
      const button = element("button", "nav-item", page.label);
      button.type = "button";
      button.dataset.page = page.id;
      button.title = page.description;
      button.setAttribute("aria-controls", `workspace-page-${page.id}`);
      button.setAttribute("aria-current", page.id === "overview" ? "page" : "false");
      group.append(button);
      buttons.set(page.id, button);

      const section = element("section", "workspace-page");
      section.id = `workspace-page-${page.id}`;
      section.dataset.page = page.id;
      section.hidden = page.id !== "overview";
      const heading = element("div", "page-heading");
      const headingText = element("div", "page-heading-copy");
      headingText.append(element("h1", "", page.label), element("p", "", page.description));
      const pageHelp = helpButton(page.label, page.help);
      heading.append(headingText, pageHelp);
      attachHelp(pageHelp, page.help, heading);
      section.append(heading);
      for (const node of pageContent[page.id] ?? []) section.append(node);
      pages.set(page.id, section);
    }
    nav.append(group);
  }

  const content = element("main", "workspace-content");
  for (const page of WORKSPACE_PAGES) {
    const section = pages.get(page.id);
    if (section) content.append(section);
  }
  const activeHelp = element("p", "workspace-help", "Select a section. Use the ? button beside its heading for an explanation.");
  activeHelp.setAttribute("aria-live", "polite");
  content.prepend(activeHelp);
  content.append(footer);

  const backdrop = element("button", "sidebar-backdrop");
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Close navigation");
  layout.append(sidebar, content, backdrop);
  shell.append(layout);
  grid.remove();

  const closeSidebar = (): void => {
    layout.classList.remove("sidebar-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
  };
  const openSidebar = (): void => {
    layout.classList.add("sidebar-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation");
  };
  toggle.addEventListener("click", () => {
    if (layout.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
  });
  backdrop.addEventListener("click", closeSidebar);

  for (const page of WORKSPACE_PAGES) {
    buttons.get(page.id)?.addEventListener("click", () => {
      for (const item of WORKSPACE_PAGES) {
        const selected = item.id === page.id;
        const section = pages.get(item.id);
        const button = buttons.get(item.id);
        if (section) section.hidden = !selected;
        if (button) button.setAttribute("aria-current", selected ? "page" : "false");
      }
      closeSidebar();
      content.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  shell.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
    const title = panel.querySelector("h2")?.textContent?.trim() ?? "Panel";
    const hint = element("button", "panel-help", "?");
    hint.type = "button";
    hint.setAttribute("aria-label", `Help: ${title}`);
    hint.title = `This panel: ${title}`;
    const explanation = title === "Simulated order desk"
      ? "Place simulated BTC spot orders. Fees and slippage are modelled; no exchange order is sent."
      : title === "BTC / USDT"
        ? "Displays completed hourly candles, RSI and checks data freshness and agreement between providers."
        : "Shows a system status or safety control. Read the panel text before taking action.";
    const label = panel.querySelector<HTMLElement>(".panel-label");
    if (label) {
      label.append(hint);
      attachHelp(hint, explanation, panel);
    }
  });
}
