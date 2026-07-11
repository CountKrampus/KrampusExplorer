import { describe, expect, it, vi, beforeEach } from "vitest";
import { usePluginStore } from "./usePluginStore";
import { useSettingsStore } from "./useSettingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

function manifest(id: string) {
  return {
    id,
    name: id,
    version: "1.0.0",
    author: "test",
    permissions: [],
    entry: "index.js",
    dir: `/plugins/${id}`,
    hasIcon: false,
  };
}

describe("usePluginStore.loadPlugins", () => {
  beforeEach(() => {
    useSettingsStore.setState({ disabledPlugins: [] });
  });

  it("fetches every enabled plugin's entry code in parallel, not one at a time", async () => {
    const manifests = [manifest("a"), manifest("b"), manifest("c")];
    const resolvers: Array<() => void> = [];
    const pendingFetches: string[] = [];

    vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
      if (command === "list_plugins") return Promise.resolve(manifests);
      if (command === "read_plugin_entry") {
        pendingFetches.push(args?.path as string);
        return new Promise<string>((resolve) => {
          resolvers.push(() => resolve("// no-op"));
        });
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);

    const loadPromise = usePluginStore.getState().loadPlugins();

    // Give the microtask queue a turn so any synchronously-kicked-off fetches land.
    await Promise.resolve();
    await Promise.resolve();

    expect(pendingFetches).toHaveLength(3);

    resolvers.forEach((resolve) => resolve());
    await loadPromise;
  });

  it("skips disabled plugins entirely", async () => {
    const manifests = [manifest("a"), manifest("b")];
    useSettingsStore.setState({ disabledPlugins: ["b"] });
    const fetchedPaths: string[] = [];

    vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
      if (command === "list_plugins") return Promise.resolve(manifests);
      if (command === "read_plugin_entry") {
        fetchedPaths.push(args?.path as string);
        return Promise.resolve("// no-op");
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);

    await usePluginStore.getState().loadPlugins();

    expect(fetchedPaths).toEqual(["/plugins/a/index.js"]);
  });
});
