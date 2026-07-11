import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createPluginApi } from "../plugins/pluginApi";
import { useExplorerStore } from "./useExplorerStore";
import type { PluginManifest, PluginSidebarPanel, PluginToolbarButton } from "../types/plugin";

export interface RegisteredSidebarPanel extends PluginSidebarPanel {
  pluginId: string;
}

export interface RegisteredToolbarButton extends PluginToolbarButton {
  pluginId: string;
}

export interface PluginLoadError {
  pluginId: string;
  message: string;
}

interface TextPreviewPayload {
  content: string;
  truncated: boolean;
}

function getActiveSelectedPath(): string | null {
  const state = useExplorerStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab?.selectedPath ?? null;
}

function getCurrentFolderPath(): string | null {
  const state = useExplorerStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab ? activeTab.history[activeTab.historyIndex] : null;
}

function onSelectionChange(callback: (path: string | null) => void): () => void {
  let last = getActiveSelectedPath();
  return useExplorerStore.subscribe(() => {
    const current = getActiveSelectedPath();
    if (current !== last) {
      last = current;
      callback(current);
    }
  });
}

interface PluginState {
  manifests: PluginManifest[];
  panels: RegisteredSidebarPanel[];
  toolbarButtons: RegisteredToolbarButton[];
  errors: PluginLoadError[];
  loaded: boolean;
  loadPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  manifests: [],
  panels: [],
  toolbarButtons: [],
  errors: [],
  loaded: false,

  loadPlugins: async () => {
    let manifests: PluginManifest[] = [];
    try {
      manifests = await invoke<PluginManifest[]>("list_plugins");
    } catch (error) {
      set({ loaded: true, errors: [{ pluginId: "*", message: String(error) }] });
      return;
    }

    const errors: PluginLoadError[] = [];

    for (const manifest of manifests) {
      try {
        const code = await invoke<string>("read_plugin_entry", {
          path: `${manifest.dir}/${manifest.entry}`,
        });
        const api = createPluginApi(manifest, {
          registerSidebarPanel: (pluginId, panel) => {
            set((state) => ({ panels: [...state.panels, { ...panel, pluginId }] }));
          },
          registerToolbarButton: (pluginId, button) => {
            set((state) => ({ toolbarButtons: [...state.toolbarButtons, { ...button, pluginId }] }));
          },
          readTextFile: async (path) => {
            const preview = await invoke<TextPreviewPayload>("read_text_preview", { path });
            return preview.content;
          },
          getCurrentPath: getCurrentFolderPath,
          onSelectionChange,
          copyToClipboard: (text) => writeText(text),
        });
        // Plugin code runs via `new Function`, not a sandboxed ES module — it executes with
        // access to the global scope (window, document, fetch, ...), not just what's in `api`.
        // Permission gating controls what the *documented* API exposes; it isn't a security
        // boundary against a plugin that goes looking for globals directly. A real sandbox
        // (e.g. a restricted Worker) is future hardening, not part of this pass.
        // eslint-disable-next-line no-new-func
        const run = new Function("api", code);
        run(api);
      } catch (error) {
        errors.push({ pluginId: manifest.id, message: String(error) });
      }
    }

    set({ manifests, errors, loaded: true });
  },
}));
