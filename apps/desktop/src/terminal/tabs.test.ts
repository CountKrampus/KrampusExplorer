import { describe, expect, it } from "vitest";
import { addTab, initialTabs, removeTab } from "./tabs";

describe("initialTabs", () => {
  it("starts with exactly one tab", () => {
    expect(initialTabs().tabs).toHaveLength(1);
  });
});

describe("addTab", () => {
  it("appends a new tab with a key distinct from existing ones", () => {
    const state = addTab(initialTabs());

    expect(state.tabs).toHaveLength(2);
    expect(new Set(state.tabs).size).toBe(2);
  });

  it("keeps generating distinct keys across repeated calls", () => {
    const state = addTab(addTab(addTab(initialTabs())));

    expect(new Set(state.tabs).size).toBe(4);
  });
});

describe("removeTab", () => {
  it("removes the given tab's key", () => {
    const withTwo = addTab(initialTabs());
    const [firstKey] = withTwo.tabs;

    const result = removeTab(withTwo, firstKey);

    expect(result.tabs).not.toContain(firstKey);
    expect(result.tabs).toHaveLength(1);
  });

  it("can remove every tab, leaving an empty list", () => {
    const state = initialTabs();

    const result = removeTab(state, state.tabs[0]);

    expect(result.tabs).toHaveLength(0);
  });

  it("removing a key that isn't present is a no-op", () => {
    const state = initialTabs();

    const result = removeTab(state, "not-a-real-key");

    expect(result.tabs).toEqual(state.tabs);
  });
});
