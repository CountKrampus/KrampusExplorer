export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  permissions: string[];
  /** Path to the plugin's JS entry file, relative to `dir`. */
  entry: string;
  /** Absolute path to the plugin's own directory. */
  dir: string;
}

export interface PluginSidebarPanel {
  id: string;
  title: string;
  /** Receives an empty container to render into with plain DOM APIs. May return a cleanup
   * function, called when the panel is torn down. */
  render: (container: HTMLElement) => void | (() => void);
}

export interface PluginApi {
  /** Present only if the plugin's manifest declares the "ui.sidebar" permission. */
  registerSidebarPanel?: (panel: PluginSidebarPanel) => void;
}
