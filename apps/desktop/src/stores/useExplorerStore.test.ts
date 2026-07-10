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
});
