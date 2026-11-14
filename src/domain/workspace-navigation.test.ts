import { describe, expect, it } from "vitest";
import { getWorkspacePage, WORKSPACE_PAGES } from "./workspace-navigation";

describe("workspace navigation", () => {
  it("defines unique page identifiers and labels", () => {
    expect(new Set(WORKSPACE_PAGES.map((page) => page.id)).size).toBe(WORKSPACE_PAGES.length);
    expect(new Set(WORKSPACE_PAGES.map((page) => page.label)).size).toBe(WORKSPACE_PAGES.length);
  });

  it("provides a group, description and contextual help for every page", () => {
    for (const page of WORKSPACE_PAGES) {
      expect(page.group.trim()).not.toBe("");
      expect(page.description.trim()).not.toBe("");
      expect(page.help.trim()).not.toBe("");
    }
  });

  it("exposes every required workspace destination in its intended group", () => {
    expect(WORKSPACE_PAGES.map(({ id, group }) => [id, group])).toEqual([
      ["overview", "Workspace"],
      ["markets", "Workspace"],
      ["paper", "Workspace"],
      ["workbench", "Research"],
      ["decisions", "Research"],
      ["outcomes", "Research"],
      ["research", "Research"],
      ["skills", "Research"],
      ["automation", "Automation"],
      ["system", "Controls"],
    ]);
  });

  it("explains the optional AI and human approval gates for automation", () => {
    const automation = WORKSPACE_PAGES.find((page) => page.id === "automation");
    expect(automation?.help).toContain("human approves");
    expect(automation?.help).toContain("Live trading remains disabled");
  });

  it("requires explicit human approval before the decision workbench can scan", () => {
    const workbench = WORKSPACE_PAGES.find((page) => page.id === "workbench");
    expect(workbench?.help).toContain("human must approve");
    expect(workbench?.help).toContain("never sends an exchange order");
  });

  it("explains that outcomes require pre-registered plans and exclude immature paths", () => {
    const outcomes = WORKSPACE_PAGES.find((page) => page.id === "outcomes");
    expect(outcomes?.help).toContain("registered with the original decision");
    expect(outcomes?.help).toContain("ambiguous");
  });

  it("returns only known pages", () => {
    expect(getWorkspacePage("research")?.label).toBe("Strategy research");
    expect(getWorkspacePage("missing")).toBeUndefined();
  });
});
