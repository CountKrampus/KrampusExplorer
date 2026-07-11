import type { PluginApi, PluginManifest, PluginSidebarPanel, PluginToolbarButton } from "../types/plugin";

export interface PluginApiHandlers {
  registerSidebarPanel: (pluginId: string, panel: PluginSidebarPanel) => void;
  registerToolbarButton: (pluginId: string, button: PluginToolbarButton) => void;
  readTextFile: (path: string) => Promise<string>;
  getCurrentPath: () => string | null;
  onSelectionChange: (callback: (path: string | null) => void) => () => void;
  copyToClipboard: (text: string) => Promise<void>;
}

/**
 * Builds the API object handed to a plugin's entry code. Only includes methods the plugin's
 * manifest actually declared permission for — a plugin without a given permission simply has
 * no corresponding function to call, rather than a runtime permission check on every call.
 */
export function createPluginApi(manifest: PluginManifest, handlers: PluginApiHandlers): PluginApi {
  const api: PluginApi = {};
  const has = (permission: string) => manifest.permissions.includes(permission);

  if (has("ui.sidebar")) {
    api.registerSidebarPanel = (panel) => handlers.registerSidebarPanel(manifest.id, panel);
  }
  if (has("ui.toolbar")) {
    api.registerToolbarButton = (button) => handlers.registerToolbarButton(manifest.id, button);
  }
  if (has("fs.readText")) {
    api.readTextFile = (path) => handlers.readTextFile(path);
  }
  if (has("nav.read")) {
    api.getCurrentPath = () => handlers.getCurrentPath();
    api.onSelectionChange = (callback) => handlers.onSelectionChange(callback);
  }
  if (has("clipboard.write")) {
    api.copyToClipboard = (text) => handlers.copyToClipboard(text);
  }

  return api;
}
