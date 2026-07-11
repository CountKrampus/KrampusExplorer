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

export interface PluginToolbarButton {
  id: string;
  /** Shown as the button's visible content and its aria-label. Keep it short (an emoji or a
   * couple of words) — toolbar space is limited. */
  label: string;
  onClick: () => void;
}

export interface PluginApi {
  /** Present only if the plugin's manifest declares the "ui.sidebar" permission. */
  registerSidebarPanel?: (panel: PluginSidebarPanel) => void;
  /** Present only if the plugin's manifest declares the "ui.toolbar" permission. */
  registerToolbarButton?: (button: PluginToolbarButton) => void;
  /** Present only if the plugin's manifest declares the "fs.readText" permission. Reads at
   * most 256KB of the file (same cap the built-in text preview uses); longer files are
   * truncated, not rejected. */
  readTextFile?: (path: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "nav.read" permission. Snapshot of
   * the active tab's current folder at call time — not reactive. */
  getCurrentPath?: () => string | null;
  /** Present only if the plugin's manifest declares the "nav.read" permission. Calls back
   * whenever the selected file/folder in the active tab changes; returns an unsubscribe
   * function. */
  onSelectionChange?: (callback: (path: string | null) => void) => () => void;
  /** Present only if the plugin's manifest declares the "clipboard.write" permission. */
  copyToClipboard?: (text: string) => Promise<void>;
}
