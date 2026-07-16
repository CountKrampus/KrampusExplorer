import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "./useExplorerStore";

function resetStore() {
  useExplorerStore.setState({ tabs: [], activeTabId: "" });
}

describe("useExplorerStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("newTab creates a tab and makes it active", () => {
    useExplorerStore.getState().newTab("C:\\");
    const state = useExplorerStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].history).toEqual(["C:\\"]);
    expect(state.tabs[0].historyIndex).toBe(0);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it("navigateTo pushes history and truncates forward history", () => {
    useExplorerStore.getState().newTab("C:\\");
    const id = useExplorerStore.getState().activeTabId;
    const store = useExplorerStore.getState();

    store.navigateTo("C:\\Users");
    store.navigateTo("C:\\Users\\boo");
    store.back();
    store.navigateTo("C:\\Users\\other");

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history).toEqual(["C:\\", "C:\\Users", "C:\\Users\\other"]);
    expect(tab.historyIndex).toBe(2);
  });

  it("back and forward move the history index within bounds", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.navigateTo("C:\\Users");
    store.navigateTo("C:\\Users\\boo");

    store.back();
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(1);

    store.back();
    store.back(); // already at index 0, should stay
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(0);

    store.forward();
    store.forward();
    store.forward(); // already at last index, should stay
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(2);
  });

  it("up navigates to the tab's parent path", () => {
    useExplorerStore.getState().newTab("C:\\Users\\boo");
    const id = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().setTabResult(id, { entries: [], parent: "C:\\Users" });

    useExplorerStore.getState().up();

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history[tab.historyIndex]).toBe("C:\\Users");
  });

  it("up is a no-op when parent is null", () => {
    useExplorerStore.getState().newTab("C:\\");
    const id = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().setTabResult(id, { entries: [], parent: null });

    useExplorerStore.getState().up();

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history).toEqual(["C:\\"]);
  });

  it("keeps multiple tabs independent", () => {
    useExplorerStore.getState().newTab("C:\\");
    const firstId = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().newTab("D:\\");
    const secondId = useExplorerStore.getState().activeTabId;

    useExplorerStore.getState().navigateTo("D:\\Games");

    const state = useExplorerStore.getState();
    const first = state.tabs.find((t) => t.id === firstId)!;
    const second = state.tabs.find((t) => t.id === secondId)!;
    expect(first.history).toEqual(["C:\\"]);
    expect(second.history).toEqual(["D:\\", "D:\\Games"]);
  });

  it("closeTab removes a tab but never removes the last one", () => {
    useExplorerStore.getState().newTab("C:\\");
    const onlyId = useExplorerStore.getState().activeTabId;

    useExplorerStore.getState().closeTab(onlyId);
    expect(useExplorerStore.getState().tabs).toHaveLength(1);

    useExplorerStore.getState().newTab("D:\\");
    useExplorerStore.getState().closeTab(onlyId);
    expect(useExplorerStore.getState().tabs).toHaveLength(1);
    expect(useExplorerStore.getState().tabs[0].history).toEqual(["D:\\"]);
  });

  it("setSelected replaces the whole selection with a single item", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.selectAll(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);

    store.setSelected("C:\\b.txt");

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual(["C:\\b.txt"]);
    expect(tab.selectedPath).toBe("C:\\b.txt");
    expect(tab.selectionAnchor).toBe("C:\\b.txt");
  });

  it("setSelected(null) clears the selection", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.setSelected("C:\\a.txt");

    store.setSelected(null);

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual([]);
    expect(tab.selectedPath).toBeNull();
  });

  it("toggleSelected adds a path not yet selected, keeping the anchor on it", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.setSelected("C:\\a.txt");

    store.toggleSelected("C:\\b.txt");

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual(["C:\\a.txt", "C:\\b.txt"]);
    expect(tab.selectedPath).toBe("C:\\b.txt");
    expect(tab.selectionAnchor).toBe("C:\\b.txt");
  });

  it("toggleSelected removes a path already selected", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.selectAll(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);

    store.toggleSelected("C:\\b.txt");

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual(["C:\\a.txt", "C:\\c.txt"]);
    expect(tab.selectedPath).toBe("C:\\c.txt");
  });

  it("toggleSelected off the last remaining item clears selectedPath", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.setSelected("C:\\a.txt");

    store.toggleSelected("C:\\a.txt");

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual([]);
    expect(tab.selectedPath).toBeNull();
  });

  it("selectRange replaces the selection without moving the anchor", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.setSelected("C:\\a.txt"); // anchor = a.txt

    store.selectRange(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);
    expect(tab.selectedPath).toBe("C:\\c.txt");
    expect(tab.selectionAnchor).toBe("C:\\a.txt");
  });

  it("selectAll sets the anchor to the first path and primary to the last", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();

    store.selectAll(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);
    expect(tab.selectionAnchor).toBe("C:\\a.txt");
    expect(tab.selectedPath).toBe("C:\\c.txt");
  });

  it("clearSelection empties the selection and anchor", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.selectAll(["C:\\a.txt", "C:\\b.txt"]);

    store.clearSelection();

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual([]);
    expect(tab.selectedPath).toBeNull();
    expect(tab.selectionAnchor).toBeNull();
  });

  it("navigateTo clears the selection", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.selectAll(["C:\\a.txt", "C:\\b.txt"]);

    store.navigateTo("C:\\Users");

    const tab = useExplorerStore.getState().tabs[0];
    expect(tab.selectedPaths).toEqual([]);
    expect(tab.selectionAnchor).toBeNull();
  });

  it("closeTab activates the adjacent tab, not always the last tab", () => {
    useExplorerStore.getState().newTab("C:\\");
    useExplorerStore.getState().newTab("D:\\");
    useExplorerStore.getState().newTab("E:\\");
    const [first, second, third] = useExplorerStore.getState().tabs;
    useExplorerStore.getState().setActiveTab(second.id);

    useExplorerStore.getState().closeTab(second.id);

    const state = useExplorerStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual([first.id, third.id]);
    expect(state.activeTabId).toBe(third.id);
  });
});
