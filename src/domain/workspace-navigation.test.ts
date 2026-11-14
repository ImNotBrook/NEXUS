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
      ["research", "Research"],
      ["skills", "Research"],
      ["system", "Controls"],
    ]);
  });

  it("returns only known pages", () => {
    expect(getWorkspacePage("research")?.label).toBe("Strategy research");
    expect(getWorkspacePage("missing")).toBeUndefined();
  });
});
