import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { useSettingsStore } from "./useSettingsStore";

describe("setSidebarWidth", () => {
  it("clamps to the [140, 480] range", () => {
    useSettingsStore.getState().setSidebarWidth(50);
    expect(useSettingsStore.getState().sidebarWidth).toBe(140);

    useSettingsStore.getState().setSidebarWidth(9999);
    expect(useSettingsStore.getState().sidebarWidth).toBe(480);

    useSettingsStore.getState().setSidebarWidth(300);
    expect(useSettingsStore.getState().sidebarWidth).toBe(300);
  });
});

describe("setSort", () => {
  it("switches to a new field at ascending order", () => {
    useSettingsStore.setState({ sortField: "name", sortDirection: "asc" });

    useSettingsStore.getState().setSort("size");

    expect(useSettingsStore.getState().sortField).toBe("size");
    expect(useSettingsStore.getState().sortDirection).toBe("asc");
  });

  it("reverses direction when the same field is clicked again", () => {
    useSettingsStore.setState({ sortField: "size", sortDirection: "asc" });

    useSettingsStore.getState().setSort("size");
    expect(useSettingsStore.getState().sortDirection).toBe("desc");

    useSettingsStore.getState().setSort("size");
    expect(useSettingsStore.getState().sortDirection).toBe("asc");
  });
});

describe("setActivePluginPanel", () => {
  it("sets and clears the active panel key", () => {
    useSettingsStore.setState({ activePluginPanel: null });

    useSettingsStore.getState().setActivePluginPanel("duplicate-finder:duplicate-finder");
    expect(useSettingsStore.getState().activePluginPanel).toBe("duplicate-finder:duplicate-finder");

    useSettingsStore.getState().setActivePluginPanel(null);
    expect(useSettingsStore.getState().activePluginPanel).toBeNull();
  });
});

describe("toggleSidebarSection", () => {
  it("adds then removes a section id", () => {
    useSettingsStore.setState({ collapsedSidebarSections: [] });

    useSettingsStore.getState().toggleSidebarSection("drives");
    expect(useSettingsStore.getState().collapsedSidebarSections).toEqual(["drives"]);

    useSettingsStore.getState().toggleSidebarSection("drives");
    expect(useSettingsStore.getState().collapsedSidebarSections).toEqual([]);
  });
});
