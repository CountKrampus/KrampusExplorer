import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createPluginApi } from "../plugins/pluginApi";
import { useExplorerStore } from "./useExplorerStore";
import { useSettingsStore } from "./useSettingsStore";
import type { DirectoryListing } from "../types/filesystem";
import type {
  CommandOutput,
  FileHash,
  GitCommit,
  GitFileStatus,
  MultiHash,
  PluginCommand,
  PluginContextMenuItem,
  PluginFileHandler,
  PluginManifest,
  PluginSidebarPanel,
  PluginToolbarButton,
  ScannedFile,
  SqliteTable,
} from "../types/plugin";

export interface RegisteredSidebarPanel extends PluginSidebarPanel {
  pluginId: string;
}

export interface RegisteredToolbarButton extends PluginToolbarButton {
  pluginId: string;
}

export interface RegisteredContextMenuItem extends PluginContextMenuItem {
  pluginId: string;
}

export interface RegisteredFileHandler extends PluginFileHandler {
  pluginId: string;
}

export interface RegisteredCommand extends PluginCommand {
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

function onFolderChange(callback: (path: string) => void): () => void {
  let last = getCurrentFolderPath();
  return useExplorerStore.subscribe(() => {
    const current = getCurrentFolderPath();
    if (current !== null && current !== last) {
      last = current;
      callback(current);
    }
  });
}

interface PluginState {
  manifests: PluginManifest[];
  panels: RegisteredSidebarPanel[];
  toolbarButtons: RegisteredToolbarButton[];
  contextMenuItems: RegisteredContextMenuItem[];
  fileHandlers: RegisteredFileHandler[];
  commands: RegisteredCommand[];
  errors: PluginLoadError[];
  loaded: boolean;
  loadPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  manifests: [],
  panels: [],
  toolbarButtons: [],
  contextMenuItems: [],
  fileHandlers: [],
  commands: [],
  errors: [],
  loaded: false,

  loadPlugins: async () => {
    // Reset registration state before re-scanning: plugin entry scripts register their UI as a
    // side effect (not idempotent), so re-running them — e.g. after toggling a plugin on/off —
    // must start from a clean slate rather than appending to whatever was registered before.
    set({ panels: [], toolbarButtons: [], contextMenuItems: [], fileHandlers: [], commands: [] });

    let manifests: PluginManifest[] = [];
    try {
      manifests = await invoke<PluginManifest[]>("list_plugins");
    } catch (error) {
      set({ loaded: true, errors: [{ pluginId: "*", message: String(error) }] });
      return;
    }

    const errors: PluginLoadError[] = [];
    const disabledPlugins = useSettingsStore.getState().disabledPlugins;
    const enabledManifests = manifests.filter((manifest) => !disabledPlugins.includes(manifest.id));

    // Fetch every enabled plugin's entry code in parallel — toggling one plugin shouldn't cost
    // an extra serial IPC round-trip for every *other* already-enabled plugin, which is what a
    // sequential await-per-plugin loop did here before.
    const fetched = await Promise.all(
      enabledManifests.map(async (manifest) => {
        try {
          const code = await invoke<string>("read_plugin_entry", {
            path: `${manifest.dir}/${manifest.entry}`,
          });
          return { manifest, code, error: null as string | null };
        } catch (error) {
          return { manifest, code: null as string | null, error: String(error) };
        }
      }),
    );

    for (const { manifest, code, error: fetchError } of fetched) {
      if (fetchError !== null || code === null) {
        errors.push({ pluginId: manifest.id, message: fetchError ?? "Could not read plugin entry" });
        continue;
      }

      try {
        const api = createPluginApi(manifest, {
          registerSidebarPanel: (pluginId, panel) => {
            set((state) => ({ panels: [...state.panels, { ...panel, pluginId }] }));
          },
          registerToolbarButton: (pluginId, button) => {
            set((state) => ({ toolbarButtons: [...state.toolbarButtons, { ...button, pluginId }] }));
          },
          registerContextMenuItem: (pluginId, item) => {
            set((state) => ({ contextMenuItems: [...state.contextMenuItems, { ...item, pluginId }] }));
          },
          registerFileHandler: (pluginId, handler) => {
            set((state) => ({ fileHandlers: [...state.fileHandlers, { ...handler, pluginId }] }));
          },
          registerCommand: (pluginId, command) => {
            set((state) => ({ commands: [...state.commands, { ...command, pluginId }] }));
          },
          readTextFile: async (path) => {
            const preview = await invoke<TextPreviewPayload>("read_text_preview", { path });
            return preview.content;
          },
          getCurrentPath: getCurrentFolderPath,
          getSelectedPath: getActiveSelectedPath,
          onSelectionChange,
          onFolderChange,
          copyToClipboard: (text) => writeText(text),
          createZipArchive: (sourcePaths, destZipPath) =>
            invoke<string>("create_zip_archive", { sourcePaths, destZipPath }),
          extractZipArchive: (zipPath, destDir) =>
            invoke<string>("extract_zip_archive", { zipPath, destDir }),
          listSqliteTables: (dbPath) => invoke<string[]>("list_sqlite_tables", { dbPath }),
          querySqliteTable: (dbPath, table, limit, offset) =>
            invoke<SqliteTable>("query_sqlite_table", { dbPath, table, limit, offset }),
          listMongoDatabases: (uri) => invoke<string[]>("list_mongo_databases", { uri }),
          listMongoCollections: (uri, dbName) =>
            invoke<string[]>("list_mongo_collections", { uri, dbName }),
          queryMongoCollection: (uri, dbName, collection, limit) =>
            invoke<string[]>("query_mongo_collection", { uri, dbName, collection, limit }),
          gitStatus: (repoPath) => invoke<GitFileStatus[]>("git_status", { repoPath }),
          gitLog: (repoPath, limit) => invoke<GitCommit[]>("git_log", { repoPath, limit }),
          runCommand: (cwd, command) => invoke<CommandOutput>("run_command", { command, cwd }),
          scanDirectory: (root) => invoke<ScannedFile[]>("scan_directory", { root }),
          hashFiles: (paths) => invoke<FileHash[]>("hash_files", { paths }),
          hashFileAll: (path) => invoke<MultiHash>("hash_file_all", { path }),
          listDirectory: (path) =>
            invoke<DirectoryListing>("get_directory_listing", { path }).then((r) => r.entries),
          renameEntry: (path, newName) => invoke<string>("rename_entry", { path, newName }),
          openTerminal: () => invoke<void>("open_terminal_window", { cwd: getCurrentFolderPath() }),
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
