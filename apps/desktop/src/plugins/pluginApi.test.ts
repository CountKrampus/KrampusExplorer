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
    hasIcon: false,
  };
}

function handlers(): PluginApiHandlers {
  return {
    registerSidebarPanel: vi.fn(),
    registerToolbarButton: vi.fn(),
    registerContextMenuItem: vi.fn(),
    registerFileHandler: vi.fn(),
    registerCommand: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue("file contents"),
    getCurrentPath: vi.fn().mockReturnValue("C:\\Users\\boo"),
    getSelectedPath: vi.fn().mockReturnValue("C:\\Users\\boo\\a.txt"),
    onSelectionChange: vi.fn().mockReturnValue(() => {}),
    onFolderChange: vi.fn().mockReturnValue(() => {}),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    createZipArchive: vi.fn().mockResolvedValue("out.zip"),
    extractZipArchive: vi.fn().mockResolvedValue("out-dir"),
    listSqliteTables: vi.fn().mockResolvedValue(["people"]),
    querySqliteTable: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
    listMongoDatabases: vi.fn().mockResolvedValue(["mydb"]),
    listMongoCollections: vi.fn().mockResolvedValue(["mycoll"]),
    queryMongoCollection: vi.fn().mockResolvedValue(["{}"]),
    gitStatus: vi.fn().mockResolvedValue([]),
    gitLog: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    scanDirectory: vi.fn().mockResolvedValue([]),
    hashFiles: vi.fn().mockResolvedValue([]),
    hashFileAll: vi.fn().mockResolvedValue({ md5: "", sha1: "", sha256: "" }),
    listDirectory: vi.fn().mockResolvedValue([]),
    renameEntry: vi.fn().mockResolvedValue("C:\\new-name.txt"),
    openTerminal: vi.fn().mockResolvedValue(undefined),
    openElevatedTerminal: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createPluginApi", () => {
  const ALL_PERMISSIONS = [
    "ui.sidebar",
    "ui.toolbar",
    "ui.contextMenu",
    "preview.register",
    "fs.readText",
    "nav.read",
    "clipboard.write",
    "fs.archive",
    "db.sqlite",
    "db.mongo",
    "git.read",
    "system.exec",
    "fs.scan",
    "fs.list",
    "fs.rename",
    "commands.register",
    "ui.terminal",
  ];
  const ALL_METHODS = [
    "registerSidebarPanel",
    "registerToolbarButton",
    "registerContextMenuItem",
    "registerFileHandler",
    "readTextFile",
    "getCurrentPath",
    "getSelectedPath",
    "onSelectionChange",
    "onFolderChange",
    "copyToClipboard",
    "createZipArchive",
    "extractZipArchive",
    "listSqliteTables",
    "querySqliteTable",
    "listMongoDatabases",
    "listMongoCollections",
    "queryMongoCollection",
    "gitStatus",
    "gitLog",
    "runCommand",
    "scanDirectory",
    "hashFiles",
    "hashFileAll",
    "listDirectory",
    "renameEntry",
    "registerCommand",
    "openTerminal",
    "openElevatedTerminal",
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
    ["ui.sidebar", ["registerSidebarPanel"]],
    ["ui.toolbar", ["registerToolbarButton"]],
    ["ui.contextMenu", ["registerContextMenuItem"]],
    ["preview.register", ["registerFileHandler"]],
    ["fs.readText", ["readTextFile"]],
    ["clipboard.write", ["copyToClipboard"]],
    ["fs.archive", ["createZipArchive", "extractZipArchive"]],
    ["db.sqlite", ["listSqliteTables", "querySqliteTable"]],
    ["db.mongo", ["listMongoDatabases", "listMongoCollections", "queryMongoCollection"]],
    ["git.read", ["gitStatus", "gitLog"]],
    ["system.exec", ["runCommand"]],
    ["fs.scan", ["scanDirectory", "hashFiles", "hashFileAll"]],
    ["fs.list", ["listDirectory"]],
    ["fs.rename", ["renameEntry"]],
    ["commands.register", ["registerCommand"]],
    ["ui.terminal", ["openTerminal", "openElevatedTerminal"]],
  ] as const)("granting only %s exposes only %s", (permission, methods) => {
    const api = createPluginApi(manifest([permission]), handlers());

    for (const method of methods) {
      expect(api[method]).toBeTypeOf("function");
    }
    for (const other of ALL_METHODS) {
      if (!(methods as readonly string[]).includes(other)) expect(api[other]).toBeUndefined();
    }
  });

  it("nav.read grants getCurrentPath, getSelectedPath, onSelectionChange, and onFolderChange together", () => {
    const api = createPluginApi(manifest(["nav.read"]), handlers());

    expect(api.getCurrentPath).toBeTypeOf("function");
    expect(api.getSelectedPath).toBeTypeOf("function");
    expect(api.onSelectionChange).toBeTypeOf("function");
    expect(api.onFolderChange).toBeTypeOf("function");
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

  it("forwards the plugin's id when registering a context menu item", () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.contextMenu"]), h);
    const item = { id: "item-1", label: "Do Thing", onClick: vi.fn() };

    api.registerContextMenuItem?.(item);

    expect(h.registerContextMenuItem).toHaveBeenCalledWith("test-plugin", item);
  });

  it("forwards the plugin's id when registering a file handler", () => {
    const h = handlers();
    const api = createPluginApi(manifest(["preview.register"]), h);
    const fileHandler = { id: "handler-1", extensions: ["csv"], render: vi.fn() };

    api.registerFileHandler?.(fileHandler);

    expect(h.registerFileHandler).toHaveBeenCalledWith("test-plugin", fileHandler);
  });

  it("forwards the plugin's id when registering a command", () => {
    const h = handlers();
    const api = createPluginApi(manifest(["commands.register"]), h);
    const command = { id: "cmd-1", label: "Do Something", run: vi.fn() };

    api.registerCommand?.(command);

    expect(h.registerCommand).toHaveBeenCalledWith("test-plugin", command);
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

  it("querySqliteTable forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["db.sqlite"]), h);

    await api.querySqliteTable?.("C:\\db.sqlite", "people", 10, 0);

    expect(h.querySqliteTable).toHaveBeenCalledWith("C:\\db.sqlite", "people", 10, 0);
  });

  it("queryMongoCollection forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["db.mongo"]), h);

    await api.queryMongoCollection?.("mongodb://localhost", "mydb", "mycoll", 20);

    expect(h.queryMongoCollection).toHaveBeenCalledWith("mongodb://localhost", "mydb", "mycoll", 20);
  });

  it("runCommand forwards cwd and command to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.exec"]), h);

    await api.runCommand?.("C:\\project", "git status");

    expect(h.runCommand).toHaveBeenCalledWith("C:\\project", "git status");
  });

  it("openTerminal calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.terminal"]), h);

    await api.openTerminal?.();

    expect(h.openTerminal).toHaveBeenCalledWith();
  });

  it("openElevatedTerminal calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.terminal"]), h);

    await api.openElevatedTerminal?.();

    expect(h.openElevatedTerminal).toHaveBeenCalledWith();
  });
});
