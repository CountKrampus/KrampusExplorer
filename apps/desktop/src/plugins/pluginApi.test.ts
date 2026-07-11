import { describe, expect, it, vi } from "vitest";
import { createPluginApi, type PluginApiHandlers } from "./pluginApi";
import type { PluginManifest } from "../types/plugin";

function manifest(permissions: string[]): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    author: "Someone",
    permissions,
    entry: "index.js",
    dir: "/plugins/test-plugin",
  };
}

function handlers(): PluginApiHandlers {
  return {
    registerSidebarPanel: vi.fn(),
    registerToolbarButton: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue("file contents"),
    getCurrentPath: vi.fn().mockReturnValue("C:\\Users\\boo"),
    onSelectionChange: vi.fn().mockReturnValue(() => {}),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createPluginApi", () => {
  const ALL_PERMISSIONS = ["ui.sidebar", "ui.toolbar", "fs.readText", "nav.read", "clipboard.write"];
  const ALL_METHODS = [
    "registerSidebarPanel",
    "registerToolbarButton",
    "readTextFile",
    "getCurrentPath",
    "onSelectionChange",
    "copyToClipboard",
  ] as const;

  it("grants every method when every permission is declared", () => {
    const api = createPluginApi(manifest(ALL_PERMISSIONS), handlers());

    for (const method of ALL_METHODS) {
      expect(api[method]).toBeTypeOf("function");
    }
  });

  it("grants no methods when no permissions are declared", () => {
    const api = createPluginApi(manifest([]), handlers());

    for (const method of ALL_METHODS) {
      expect(api[method]).toBeUndefined();
    }
  });

  it.each([
    ["ui.sidebar", "registerSidebarPanel"],
    ["ui.toolbar", "registerToolbarButton"],
    ["fs.readText", "readTextFile"],
    ["clipboard.write", "copyToClipboard"],
  ] as const)("granting only %s exposes only %s", (permission, method) => {
    const api = createPluginApi(manifest([permission]), handlers());

    expect(api[method]).toBeTypeOf("function");
    for (const other of ALL_METHODS) {
      if (other !== method) expect(api[other]).toBeUndefined();
    }
  });

  it("nav.read grants both getCurrentPath and onSelectionChange together", () => {
    const api = createPluginApi(manifest(["nav.read"]), handlers());

    expect(api.getCurrentPath).toBeTypeOf("function");
    expect(api.onSelectionChange).toBeTypeOf("function");
    expect(api.registerSidebarPanel).toBeUndefined();
  });

  it("forwards the plugin's id when registering a sidebar panel", () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.sidebar"]), h);
    const panel = { id: "panel-1", title: "My Panel", render: vi.fn() };

    api.registerSidebarPanel?.(panel);

    expect(h.registerSidebarPanel).toHaveBeenCalledWith("test-plugin", panel);
  });

  it("forwards the plugin's id when registering a toolbar button", () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.toolbar"]), h);
    const button = { id: "btn-1", label: "Go", onClick: vi.fn() };

    api.registerToolbarButton?.(button);

    expect(h.registerToolbarButton).toHaveBeenCalledWith("test-plugin", button);
  });

  it("readTextFile resolves with the handler's result", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.readText"]), h);

    await expect(api.readTextFile?.("C:\\a.txt")).resolves.toBe("file contents");
    expect(h.readTextFile).toHaveBeenCalledWith("C:\\a.txt");
  });

  it("getCurrentPath returns the handler's snapshot", () => {
    const api = createPluginApi(manifest(["nav.read"]), handlers());

    expect(api.getCurrentPath?.()).toBe("C:\\Users\\boo");
  });
});
