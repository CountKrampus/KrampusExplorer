import type { PluginApi, PluginManifest, PluginSidebarPanel } from "../types/plugin";

export interface PluginApiHandlers {
  registerSidebarPanel: (pluginId: string, panel: PluginSidebarPanel) => void;
}

/**
 * Builds the API object handed to a plugin's entry code. Only includes methods the plugin's
 * manifest actually declared permission for — a plugin without "ui.sidebar" simply has no
 * `registerSidebarPanel` function to call, rather than a runtime permission check on every call.
 */
export function createPluginApi(manifest: PluginManifest, handlers: PluginApiHandlers): PluginApi {
  const api: PluginApi = {};

  if (manifest.permissions.includes("ui.sidebar")) {
    api.registerSidebarPanel = (panel) => handlers.registerSidebarPanel(manifest.id, panel);
  }

  return api;
}
