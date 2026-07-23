import type { DriveInfo, EntryInfo } from "./filesystem";

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
  /** Whether an `icon.png` file exists in the plugin's directory. If true, its path is
   * `${dir}/icon.png`, resolvable to a displayable URL via `convertFileSrc`. */
  hasIcon: boolean;
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

export interface PluginContextMenuItem {
  id: string;
  /** Shown as the menu entry's label. */
  label: string;
  /** Called with the right-clicked file/folder's path, and whether it's a folder, when the
   * entry is clicked. */
  onClick: (path: string, isDir: boolean) => void;
}

export interface PluginFileHandler {
  id: string;
  /** Lowercase file extensions (no leading dot, e.g. `"csv"`) this handler claims. When the
   * selected file matches one, this handler's `render` is used instead of the built-in
   * image/text/markdown/PDF/audio/video preview. */
  extensions: string[];
  /** Receives the selected file's path and an empty container to render into with plain DOM
   * APIs. May return a cleanup function, called when the preview is torn down or the selection
   * changes. */
  render: (path: string, container: HTMLElement) => void | (() => void);
}

export interface PluginCommand {
  id: string;
  /** Shown in the command palette's list. */
  label: string;
  run: () => void;
}

export interface GitFileStatus {
  path: string;
  /** Raw two-character `git status --porcelain` code, e.g. " M", "??", "A ". */
  status: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SqliteTable {
  columns: string[];
  rows: (string | null)[][];
}

export interface ScannedFile {
  path: string;
  size: number;
}

export interface FileHash {
  path: string;
  hash: string;
}

export interface MultiHash {
  md5: string;
  sha1: string;
  sha256: string;
}

export interface TrashedItem {
  id: string;
  name: string;
  originalParent: string;
  /** Unix epoch seconds. */
  timeDeleted: number;
  /** `null` if the size couldn't be determined for this item. */
  sizeBytes: number | null;
}

export interface RecoveryProgress {
  status: "running" | "completed" | "failed";
  bytesScanned: number;
  totalBytes: number;
  /** Keyed by subfolder name ("jpeg", "png", "pdf", "zip", "mp3"). */
  filesFoundByType: Record<string, number>;
  /** Present only when `status` is `"failed"`. */
  error: string | null;
}

export interface WipeProgress {
  status: "running" | "completed" | "failed";
  bytesWritten: number;
  totalBytes: number;
  /** Present only when `status` is `"failed"`. */
  error: string | null;
}

export interface PartitionInfo {
  driveLetter: string | null;
  sizeBytes: number;
  offsetBytes: number;
  filesystem: string | null;
  partitionType: string;
}

export interface DiskInfo {
  number: number;
  totalBytes: number;
  isSystem: boolean;
  model: string;
  partitions: PartitionInfo[];
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
  /** Present only if the plugin's manifest declares the "nav.read" permission. Snapshot of
   * the active tab's currently selected file/folder at call time — not reactive. */
  getSelectedPath?: () => string | null;
  /** Present only if the plugin's manifest declares the "nav.read" permission. Calls back
   * whenever the selected file/folder in the active tab changes; returns an unsubscribe
   * function. */
  onSelectionChange?: (callback: (path: string | null) => void) => () => void;
  /** Present only if the plugin's manifest declares the "nav.read" permission. Calls back
   * whenever the active tab navigates to a different folder; returns an unsubscribe function. */
  onFolderChange?: (callback: (path: string) => void) => () => void;
  /** Present only if the plugin's manifest declares the "clipboard.write" permission. */
  copyToClipboard?: (text: string) => Promise<void>;
  /** Present only if the plugin's manifest declares the "ui.contextMenu" permission. Adds an
   * entry to the file list's right-click context menu, shown for every file and folder. */
  registerContextMenuItem?: (item: PluginContextMenuItem) => void;
  /** Present only if the plugin's manifest declares the "preview.register" permission. Claims
   * one or more file extensions so the preview pane uses this handler instead of the built-in
   * preview for matching files. */
  registerFileHandler?: (handler: PluginFileHandler) => void;
  /** Present only if the plugin's manifest declares the "fs.archive" permission. Zips
   * `sourcePaths` (files and/or folders) into a new archive at `destZipPath`; returns the
   * final path. */
  createZipArchive?: (sourcePaths: string[], destZipPath: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "fs.archive" permission. Extracts
   * `zipPath` into `destDir` (created if missing); returns `destDir`. */
  extractZipArchive?: (zipPath: string, destDir: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "db.sqlite" permission. Lists table
   * names in a SQLite database file. */
  listSqliteTables?: (dbPath: string) => Promise<string[]>;
  /** Present only if the plugin's manifest declares the "db.sqlite" permission. Reads up to
   * `limit` rows of `table` starting at `offset`. All values are stringified for display. */
  querySqliteTable?: (
    dbPath: string,
    table: string,
    limit: number,
    offset: number,
  ) => Promise<SqliteTable>;
  /** Present only if the plugin's manifest declares the "db.mongo" permission. Lists database
   * names visible to the given connection string. */
  listMongoDatabases?: (uri: string) => Promise<string[]>;
  /** Present only if the plugin's manifest declares the "db.mongo" permission. Lists
   * collection names within `dbName`. */
  listMongoCollections?: (uri: string, dbName: string) => Promise<string[]>;
  /** Present only if the plugin's manifest declares the "db.mongo" permission. Returns up to
   * `limit` documents from `collection` as pretty-printable JSON strings (BSON extended-JSON
   * for types like ObjectId/Date). */
  queryMongoCollection?: (
    uri: string,
    dbName: string,
    collection: string,
    limit: number,
  ) => Promise<string[]>;
  /** Present only if the plugin's manifest declares the "git.read" permission. Requires a
   * `git` executable on PATH; fails if `repoPath` isn't inside a git working tree. */
  gitStatus?: (repoPath: string) => Promise<GitFileStatus[]>;
  /** Present only if the plugin's manifest declares the "git.read" permission. */
  gitLog?: (repoPath: string, limit: number) => Promise<GitCommit[]>;
  /** Present only if the plugin's manifest declares the "system.exec" permission. Runs
   * `command` through the OS shell in `cwd` with the app's own permissions — no sandboxing,
   * no confirmation prompt. Only grant this permission to plugins you trust completely. */
  runCommand?: (cwd: string, command: string) => Promise<CommandOutput>;
  /** Present only if the plugin's manifest declares the "fs.scan" permission. Recursively lists
   * every file (not directory) under `root` with its size. Symlinks are not followed. */
  scanDirectory?: (root: string) => Promise<ScannedFile[]>;
  /** Present only if the plugin's manifest declares the "fs.scan" permission. Hashes each of
   * `paths` with BLAKE3, streaming file contents rather than reading fully into memory. A
   * single unreadable path fails the whole batch. */
  hashFiles?: (paths: string[]) => Promise<FileHash[]>;
  /** Present only if the plugin's manifest declares the "fs.scan" permission. Computes MD5,
   * SHA-1, and SHA-256 of a single file in one streaming pass — the algorithms a download
   * page's published checksum is actually likely to use, unlike `hashFiles`' BLAKE3. */
  hashFileAll?: (path: string) => Promise<MultiHash>;
  /** Present only if the plugin's manifest declares the "fs.list" permission. Non-recursive
   * listing of `path`'s immediate children — the same data the core file list itself uses. */
  listDirectory?: (path: string) => Promise<EntryInfo[]>;
  /** Present only if the plugin's manifest declares the "fs.rename" permission. Renames the
   * entry at `path` to `newName` (a bare name, not a full path) within the same folder; returns
   * the new full path. Fails if `newName` already exists (unless it's just a case-only change on
   * a case-insensitive filesystem). */
  renameEntry?: (path: string, newName: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "commands.register" permission. Adds
   * an entry to the command palette (`Ctrl+K`), alongside built-in and other plugins' commands. */
  registerCommand?: (command: PluginCommand) => void;
  /** Present only if the plugin's manifest declares the "ui.terminal" permission. Opens the
   * detached terminal window (creating it if it doesn't exist yet, else focusing it) — a real
   * interactive shell with tabs, running as core-app functionality rather than sandboxed plugin
   * code. */
  openTerminal?: () => Promise<void>;
  /** Present only if the plugin's manifest declares the "ui.terminal" permission. Opens a
   * SEPARATE, fully elevated (Administrator) terminal window — triggers the Windows UAC
   * prompt. Elevation applies to the whole window, not individual tabs; the resulting window
   * is an independent OS process from the main app, not connected to it once open. */
  openElevatedTerminal?: () => Promise<void>;
  /** Present only if the plugin's manifest declares the "ui.confirm" permission. Shows the
   * app's own confirmation dialog with `message` and Confirm/Cancel buttons; resolves to
   * whether the user confirmed. Only one confirmation can be shown at a time -- see
   * useConfirmStore's `requestConfirm`. */
  confirm?: (message: string) => Promise<boolean>;
  /** Present only if the plugin's manifest declares the "fs.trash" permission. Lists everything
   * currently in the OS Recycle Bin. */
  listTrashItems?: () => Promise<TrashedItem[]>;
  /** Present only if the plugin's manifest declares the "fs.trash" permission. Restores one
   * item (by its `id` from `listTrashItems`) to its original location. */
  restoreTrashItem?: (id: string) => Promise<void>;
  /** Present only if the plugin's manifest declares the "fs.trash" permission. Permanently
   * deletes one item from the Recycle Bin -- irreversible. */
  purgeTrashItem?: (id: string) => Promise<void>;
  /** Present only if the plugin's manifest declares the "fs.trash" permission. Permanently
   * deletes everything currently in the Recycle Bin -- irreversible. */
  emptyTrash?: () => Promise<void>;
  /** Present only if the plugin's manifest declares the "fs.trash" permission. Sends every path
   * in `paths` to the Recycle Bin in one call. A directory path is moved as a whole -- its
   * contents don't need to be listed first. */
  deleteEntries?: (paths: string[]) => Promise<void>;
  /** Present only if the plugin's manifest declares the "system.paths" permission. Resolves one
   * of a small fixed set of known system locations: "temp", "local_app_data",
   * "roaming_app_data", or "home". Resolves to `null` (not an error) if that location can't be
   * determined on this system -- any other identifier is rejected. */
  getKnownFolder?: (
    folder: "temp" | "local_app_data" | "roaming_app_data" | "home",
  ) => Promise<string | null>;
  /** Present only if the plugin's manifest declares the "system.drives" permission. Lists every
   * detected drive -- the same data the sidebar's Drives section uses. */
  listDrives?: () => Promise<DriveInfo[]>;
  /** Present only if the plugin's manifest declares the "fs.recover" permission. Starts a
   * signature-based recovery scan of `drive` (e.g. "D:"), writing recovered files into
   * `destination` under per-type subfolders. `fileTypes` is a subset of "jpeg", "png", "pdf",
   * "zip", "mp3". Triggers a Windows UAC elevation prompt -- the scan runs in a separate,
   * elevated process. Resolves to an opaque scan id to pass to `getRecoveryProgress`; does not
   * wait for the scan itself to finish. */
  startRecoveryScan?: (drive: string, destination: string, fileTypes: string[]) => Promise<string>;
  /** Present only if the plugin's manifest declares the "fs.recover" permission. Polls the
   * current state of a scan started via `startRecoveryScan`. Rejects if called before the
   * elevated process has written its first progress update -- callers should tolerate a brief
   * initial failure window rather than treating it as fatal. */
  getRecoveryProgress?: (scanId: string) => Promise<RecoveryProgress>;
  /** Present only if the plugin's manifest declares the "fs.format" permission. The system/boot
   * drive (e.g. "C:"), or `null` if it couldn't be determined. Use this to exclude it from any
   * drive picker -- the backend's own `formatDrive` independently refuses it too, but a plugin
   * should never even offer it as a selectable option. */
  getSystemDrive?: () => Promise<string | null>;
  /** Present only if the plugin's manifest declares the "fs.format" permission. Opens Windows'
   * own native Format dialog for `drive` (e.g. "D:") and resolves once it closes. Refuses (with
   * a rejected promise) if `drive` is the system drive. `"cancelled"` and `"noFormat"` are
   * normal outcomes -- the user backed out of the native dialog, or Windows itself declined --
   * not errors. */
  formatDrive?: (drive: string) => Promise<"formatted" | "cancelled" | "noFormat">;
  /** Present only if the plugin's manifest declares the "fs.wipe" permission. Starts a secure
   * wipe of `drive` (e.g. "I:") -- overwrites the entire volume with zeros. Triggers a Windows
   * UAC elevation prompt -- the wipe runs in a separate, elevated process. Refuses (rejected
   * promise) if `drive` is the system drive. Resolves to an opaque wipe id to pass to
   * `getWipeProgress`; does not wait for the wipe itself to finish. **Irreversible.** */
  startSecureWipe?: (drive: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "fs.wipe" permission. Polls the current
   * state of a wipe started via `startSecureWipe`. Rejects if called before the elevated process
   * has written its first progress update -- callers should tolerate a brief initial failure
   * window rather than treating it as fatal. */
  getWipeProgress?: (wipeId: string) => Promise<WipeProgress>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Lists
   * every physical disk and its partitions, including unallocated space (inferred client-side
   * from gaps between partition offsets -- not returned explicitly). Read-only; does not require
   * elevation. */
  listDisks?: () => Promise<DiskInfo[]>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Creates
   * a new partition in existing unallocated space on `diskNumber`, formats it with `filesystem`
   * ("NTFS" | "FAT32" | "exFAT"), and optionally assigns `driveLetter` (auto-assigned if
   * omitted). Triggers a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber`
   * is the system disk. */
  createPartition?: (
    diskNumber: number,
    offsetBytes: number,
    sizeBytes: number,
    filesystem: string,
    driveLetter?: string,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Deletes
   * the partition at `driveLetter` on `diskNumber`, returning its space to unallocated. Triggers
   * a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber` is the system
   * disk. **Permanently destroys all data on the partition.** */
  deletePartition?: (diskNumber: number, driveLetter: string) => Promise<void>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Resizes
   * the partition at `driveLetter` on `diskNumber` to `newSizeBytes` -- shrinking or extending
   * into adjacent unallocated space only (whatever Windows itself reports as the valid range).
   * Triggers a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber` is the
   * system disk. **Shrinking can destroy data if the requested size is smaller than the data
   * already on the partition.** */
  resizePartition?: (
    diskNumber: number,
    driveLetter: string,
    newSizeBytes: number,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission.
   * Reformats the partition at `driveLetter` in place with `filesystem`. Triggers a Windows UAC
   * elevation prompt. Refuses (rejected promise) if `diskNumber` is the system disk.
   * **Permanently destroys all data on the partition.** */
  formatPartition?: (
    diskNumber: number,
    driveLetter: string,
    filesystem: string,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission.
   * Reassigns the drive letter of the partition currently at `currentLetter` on `diskNumber` to
   * `newLetter`, or removes its letter entirely if `newLetter` is omitted. Triggers a Windows UAC
   * elevation prompt. Refuses (rejected promise) if `diskNumber` is the system disk. Does not
   * touch the partition's data. */
  setDriveLetter?: (
    diskNumber: number,
    currentLetter: string,
    newLetter?: string,
  ) => Promise<void>;
}
