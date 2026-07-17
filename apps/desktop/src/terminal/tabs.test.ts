import { describe, expect, it } from "vitest";
import { addTab, initialTabs, removeTab } from "./tabs";

describe("initialTabs", () => {
  it("starts with exactly one tab", () => {
    expect(initialTabs().tabs).toHaveLength(1);
  });

  it("the initial tab has no explicit shell (uses the auto-detected default)", () => {
    expect(initialTabs().tabs[0].shell).toBeNull();
  });
});

describe("addTab", () => {
  it("appends a new tab with a key distinct from existing ones", () => {
    const state = addTab(initialTabs());

    expect(state.tabs).toHaveLength(2);
    expect(new Set(state.tabs.map((tab) => tab.key)).size).toBe(2);
  });

  it("keeps generating distinct keys across repeated calls", () => {
    const state = addTab(addTab(addTab(initialTabs())));

    expect(new Set(state.tabs.map((tab) => tab.key)).size).toBe(4);
  });

  it("defaults to no explicit shell when none is given", () => {
    const state = addTab(initialTabs());

    expect(state.tabs[1].shell).toBeNull();
  });

  it("records the requested shell for the new tab", () => {
    const state = addTab(initialTabs(), "powershell.exe");

    expect(state.tabs[1].shell).toBe("powershell.exe");
  });

  it("doesn't change the shell of existing tabs", () => {
    const withPs = addTab(initialTabs(), "powershell.exe");
    const withCmd = addTab(withPs, "cmd.exe");

    expect(withCmd.tabs[0].shell).toBeNull();
    expect(withCmd.tabs[1].shell).toBe("powershell.exe");
    expect(withCmd.tabs[2].shell).toBe("cmd.exe");
  });
});

describe("removeTab", () => {
  it("removes the given tab's key", () => {
    const withTwo = addTab(initialTabs());
    const [firstKey] = withTwo.tabs.map((tab) => tab.key);

    const result = removeTab(withTwo, firstKey);

    expect(result.tabs.map((tab) => tab.key)).not.toContain(firstKey);
    expect(result.tabs).toHaveLength(1);
  });

  it("can remove every tab, leaving an empty list", () => {
    const state = initialTabs();

    const result = removeTab(state, state.tabs[0].key);

    expect(result.tabs).toHaveLength(0);
  });

  it("removing a key that isn't present is a no-op", () => {
    const state = initialTabs();

    const result = removeTab(state, "not-a-real-key");

    expect(result.tabs).toEqual(state.tabs);
  });
});
