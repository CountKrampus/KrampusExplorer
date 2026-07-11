import { describe, expect, it, vi } from "vitest";
import { createPluginApi } from "./pluginApi";
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

describe("createPluginApi", () => {
  it("grants registerSidebarPanel when the manifest declares ui.sidebar", () => {
    const registerSidebarPanel = vi.fn();
    const api = createPluginApi(manifest(["ui.sidebar"]), { registerSidebarPanel });

    expect(api.registerSidebarPanel).toBeTypeOf("function");
  });

  it("omits registerSidebarPanel when the manifest does not declare ui.sidebar", () => {
    const registerSidebarPanel = vi.fn();
    const api = createPluginApi(manifest([]), { registerSidebarPanel });

    expect(api.registerSidebarPanel).toBeUndefined();
  });

  it("omits registerSidebarPanel for an unrelated permission", () => {
    const registerSidebarPanel = vi.fn();
    const api = createPluginApi(manifest(["filesystem.read"]), { registerSidebarPanel });

    expect(api.registerSidebarPanel).toBeUndefined();
  });

  it("forwards the plugin's id and the panel to the handler when called", () => {
    const registerSidebarPanel = vi.fn();
    const api = createPluginApi(manifest(["ui.sidebar"]), { registerSidebarPanel });
    const panel = { id: "panel-1", title: "My Panel", render: vi.fn() };

    api.registerSidebarPanel?.(panel);

    expect(registerSidebarPanel).toHaveBeenCalledWith("test-plugin", panel);
  });
});
