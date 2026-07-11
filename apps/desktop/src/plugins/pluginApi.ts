import type {
  CommandOutput,
  GitCommit,
  GitFileStatus,
  PluginApi,
  PluginContextMenuItem,
  PluginFileHandler,
  PluginManifest,
  PluginSidebarPanel,
  PluginToolbarButton,
  SqliteTable,
} from "../types/plugin";

export interface PluginApiHandlers {
  registerSidebarPanel: (pluginId: string, panel: PluginSidebarPanel) => void;
  registerToolbarButton: (pluginId: string, button: PluginToolbarButton) => void;
  registerContextMenuItem: (pluginId: string, item: PluginContextMenuItem) => void;
  registerFileHandler: (pluginId: string, handler: PluginFileHandler) => void;
  readTextFile: (path: string) => Promise<string>;
  getCurrentPath: () => string | null;
  getSelectedPath: () => string | null;
  onSelectionChange: (callback: (path: string | null) => void) => () => void;
  onFolderChange: (callback: (path: string) => void) => () => void;
  copyToClipboard: (text: string) => Promise<void>;
  createZipArchive: (sourcePaths: string[], destZipPath: string) => Promise<string>;
  extractZipArchive: (zipPath: string, destDir: string) => Promise<string>;
  listSqliteTables: (dbPath: string) => Promise<string[]>;
  querySqliteTable: (
    dbPath: string,
    table: string,
    limit: number,
    offset: number,
  ) => Promise<SqliteTable>;
  listMongoDatabases: (uri: string) => Promise<string[]>;
  listMongoCollections: (uri: string, dbName: string) => Promise<string[]>;
  queryMongoCollection: (
    uri: string,
    dbName: string,
    collection: string,
    limit: number,
  ) => Promise<string[]>;
  gitStatus: (repoPath: string) => Promise<GitFileStatus[]>;
  gitLog: (repoPath: string, limit: number) => Promise<GitCommit[]>;
  runCommand: (cwd: string, command: string) => Promise<CommandOutput>;
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
  if (has("ui.contextMenu")) {
    api.registerContextMenuItem = (item) => handlers.registerContextMenuItem(manifest.id, item);
  }
  if (has("preview.register")) {
    api.registerFileHandler = (handler) => handlers.registerFileHandler(manifest.id, handler);
  }
  if (has("fs.readText")) {
    api.readTextFile = (path) => handlers.readTextFile(path);
  }
  if (has("nav.read")) {
    api.getCurrentPath = () => handlers.getCurrentPath();
    api.getSelectedPath = () => handlers.getSelectedPath();
    api.onSelectionChange = (callback) => handlers.onSelectionChange(callback);
    api.onFolderChange = (callback) => handlers.onFolderChange(callback);
  }
  if (has("clipboard.write")) {
    api.copyToClipboard = (text) => handlers.copyToClipboard(text);
  }
  if (has("fs.archive")) {
    api.createZipArchive = (sourcePaths, destZipPath) =>
      handlers.createZipArchive(sourcePaths, destZipPath);
    api.extractZipArchive = (zipPath, destDir) => handlers.extractZipArchive(zipPath, destDir);
  }
  if (has("db.sqlite")) {
    api.listSqliteTables = (dbPath) => handlers.listSqliteTables(dbPath);
    api.querySqliteTable = (dbPath, table, limit, offset) =>
      handlers.querySqliteTable(dbPath, table, limit, offset);
  }
  if (has("db.mongo")) {
    api.listMongoDatabases = (uri) => handlers.listMongoDatabases(uri);
    api.listMongoCollections = (uri, dbName) => handlers.listMongoCollections(uri, dbName);
    api.queryMongoCollection = (uri, dbName, collection, limit) =>
      handlers.queryMongoCollection(uri, dbName, collection, limit);
  }
  if (has("git.read")) {
    api.gitStatus = (repoPath) => handlers.gitStatus(repoPath);
    api.gitLog = (repoPath, limit) => handlers.gitLog(repoPath, limit);
  }
  if (has("system.exec")) {
    api.runCommand = (cwd, command) => handlers.runCommand(cwd, command);
  }

  return api;
}
