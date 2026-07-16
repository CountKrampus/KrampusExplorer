import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((payload: unknown) => void) | undefined;
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import { performTransferBatch, resolvePendingConflict } from "./fileTransfer";

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("performTransferBatch", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useExplorerStore.setState({
      tabs: [],
      activeTabId: "",
      clipboard: null,
      pendingConflict: null,
    });
    useExplorerStore.getState().newTab("C:\\dest");
    useExplorerStore.getState().setTabResult(useExplorerStore.getState().activeTabId, {
      entries: [],
      parent: null,
    });
  });

  it("pauses on a conflict and resumes with the next file once it's resolved", async () => {
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
      if (command === "copy_entry_with_progress") {
        const source = args?.source as string;
        calls.push(source);
        if (source === "a.txt") return Promise.reject("EEXIST");
        return Promise.resolve(`C:\\dest\\${source}`);
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);

    const batch = performTransferBatch(["a.txt", "b.txt"], "C:\\dest", "copy");

    // Let performTransfer("a.txt") run and raise the conflict.
    await flushMicrotasks();
    expect(calls).toEqual(["a.txt"]);
    expect(useExplorerStore.getState().pendingConflict).not.toBeNull();

    // The batch must not have touched "b.txt" yet — it's paused waiting on the dialog.
    await flushMicrotasks();
    expect(calls).toEqual(["a.txt"]);

    await resolvePendingConflict("cancel");
    await batch;

    expect(calls).toEqual(["a.txt", "b.txt"]);
  });

  it("transfers every source when none conflict", async () => {
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
      if (command === "copy_entry_with_progress") {
        const source = args?.source as string;
        calls.push(source);
        return Promise.resolve(`C:\\dest\\${source}`);
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);

    await performTransferBatch(["a.txt", "b.txt", "c.txt"], "C:\\dest", "copy");

    expect(calls).toEqual(["a.txt", "b.txt", "c.txt"]);
  });
});
