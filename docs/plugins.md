# Plugin SDK (v1)

Status: early. This covers what's actually implemented, not the full plugin capability list in
`Plan.md`. See "Not yet implemented" below for what's deferred.

## Installing a plugin

Plugins live in a directory scanned on every app launch:

- Windows: `%APPDATA%\Krampus Explorer\plugins\`

Each plugin is a subdirectory containing a `manifest.json` and an entry JS file. Drop a plugin
folder in, restart the app — it'll show up in Settings → Plugins (or a load error will, if
something's wrong). Or use Settings → Plugins → "Browse Marketplace" (see below) instead of
copying files manually — no restart needed either way, since plugin loading always re-scans the
directory from scratch.

See `examples/plugins/hello-sidebar/` for a working minimal example, or the following for
fuller examples covering most of the permissions below:

- `examples/plugins/archive-manager/` — zip/unzip via `fs.archive`
- `examples/plugins/mtg-collection-manager/` — pure-frontend plugin (no backend permissions
  beyond `ui.sidebar`), uses `fetch` and `localStorage` directly
- `examples/plugins/database-browser/` — SQLite and MongoDB browsing via `db.sqlite`/`db.mongo`
- `examples/plugins/git-integration/` — `git status`/`git log` via `git.read`
- `examples/plugins/run-command/` — scoped-down "run one command" via `system.exec`
- `examples/plugins/duplicate-finder/` — recursive scan + content hashing via `fs.scan`
- `examples/plugins/disk-usage-visualizer/` — recursive scan via `fs.scan`
- `examples/plugins/checksum-verifier/` — MD5/SHA-1/SHA-256 via `fs.scan`
- `examples/plugins/batch-rename/` — Find/Replace with live preview via `fs.list`/`fs.rename`

## manifest.json

```json
{
  "id": "hello-sidebar",
  "name": "Hello Sidebar",
  "version": "1.0.0",
  "author": "Someone",
  "permissions": ["ui.sidebar"],
  "entry": "frontend/index.js"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique. Used as the key for registered panels and load-error reporting. |
| `name` | yes | Display name (shown in Settings → Plugins). |
| `version` | yes | Free-form string, not currently validated as semver. |
| `author` | yes | Display string. |
| `permissions` | no (defaults to `[]`) | See Permissions below. |
| `entry` | yes | Path to the JS entry file, relative to the plugin's own directory. Must exist, or the whole manifest is skipped. |

Manifests with invalid JSON, missing required fields, or a missing `entry` file are silently
skipped — they won't crash the app or block other plugins from loading, but they also won't
appear anywhere (not even as an error) since the backend can't identify a broken plugin well
enough to report on it meaningfully. If your plugin isn't showing up, check `manifest.json` is
valid JSON with all required fields first.

## Permissions and the `api` object

A plugin's entry file runs with one variable in scope: `api`. It only contains the methods your
manifest's `permissions` array actually grants — there's no runtime permission check on each
call, because ungranted methods simply don't exist on the object.

| Permission | Grants |
|---|---|
| `ui.sidebar` | `api.registerSidebarPanel(panel)` |
| `ui.toolbar` | `api.registerToolbarButton(button)` |
| `ui.contextMenu` | `api.registerContextMenuItem(item)` |
| `preview.register` | `api.registerFileHandler(handler)` |
| `fs.readText` | `api.readTextFile(path)` |
| `nav.read` | `api.getCurrentPath()`, `api.getSelectedPath()`, `api.onSelectionChange(callback)`, `api.onFolderChange(callback)` |
| `clipboard.write` | `api.copyToClipboard(text)` |
| `fs.archive` | `api.createZipArchive(sourcePaths, destZipPath)`, `api.extractZipArchive(zipPath, destDir)` |
| `db.sqlite` | `api.listSqliteTables(dbPath)`, `api.querySqliteTable(dbPath, table, limit, offset)` |
| `db.mongo` | `api.listMongoDatabases(uri)`, `api.listMongoCollections(uri, dbName)`, `api.queryMongoCollection(uri, dbName, collection, limit)` |
| `git.read` | `api.gitStatus(repoPath)`, `api.gitLog(repoPath, limit)` |
| `system.exec` | `api.runCommand(cwd, command)` |
| `fs.scan` | `api.scanDirectory(root)`, `api.hashFiles(paths)`, `api.hashFileAll(path)` |
| `fs.list` | `api.listDirectory(path)` |
| `fs.rename` | `api.renameEntry(path, newName)` |
| `commands.register` | `api.registerCommand(command)` |

### `registerSidebarPanel`

```ts
api.registerSidebarPanel({
  id: string,           // unique within this plugin
  title: string,        // shown as the panel's heading in the sidebar
  render(container: HTMLElement): void | (() => void),
});
```

`render` receives an empty `<div>` to fill in with plain DOM APIs (`document.createElement`,
etc.) — not React or any framework. It may optionally return a cleanup function, called if the
panel is ever torn down.

CSS custom properties from the app's theme (`--bg`, `--fg`, `--fg-muted`, `--border`, `--accent`,
`--danger`) are available to style against, same as the rest of the app.

### `registerToolbarButton`

```ts
api.registerToolbarButton({
  id: string,        // unique within this plugin
  label: string,     // button content and aria-label — keep it short, toolbar space is limited
  onClick: () => void,
});
```

Renders in the main toolbar after a separator, alongside any other plugins' buttons.

### `registerContextMenuItem`

```ts
api.registerContextMenuItem({
  id: string,                      // unique within this plugin
  label: string,                   // shown as the menu entry's text
  onClick: (path: string) => void, // called with the right-clicked file/folder's path
});
```

Appears in the file list's right-click context menu for every file and folder, after a
separator below the built-in Copy/Cut/Rename/Delete entries, alongside any other plugins'
items.

### `registerFileHandler`

```ts
api.registerFileHandler({
  id: string,                // unique within this plugin
  extensions: string[],      // lowercase, no leading dot, e.g. ["csv", "tsv"]
  render(path: string, container: HTMLElement): void | (() => void),
});
```

When the selected file's extension matches one in `extensions`, the preview pane calls
`render(path, container)` instead of using the built-in image/text/markdown/PDF/audio/video
preview. `container` is an empty `<div>` — same plain-DOM-API contract as
`registerSidebarPanel`. If more than one plugin claims the same extension, the first
registered wins. `render` may return a cleanup function, called when the preview is torn down
or the selection changes.

### `readTextFile`

`api.readTextFile(path: string): Promise<string>` reads at most 256KB of the file (the same cap
the built-in text preview uses); longer files are truncated, not rejected.

### `nav.read` methods

- `getCurrentPath(): string | null` — snapshot of the active tab's current folder.
- `getSelectedPath(): string | null` — snapshot of the active tab's currently selected file/folder.
  The core file list supports multi-select (Ctrl+click, Shift+click, Ctrl+A), but this only ever
  reports the "primary" item — the most recently interacted-with one — not the whole selection.
  There's no plugin-facing API for the full multi-selection yet.
- `onSelectionChange(callback: (path: string | null) => void): () => void` — fires whenever the
  primary selection changes; returns an unsubscribe function.
- `onFolderChange(callback: (path: string) => void): () => void` — fires whenever the active tab
  navigates to a different folder; returns an unsubscribe function.

### `copyToClipboard`

`api.copyToClipboard(text: string): Promise<void>` writes plain text to the system clipboard.

### `fs.archive` methods

- `createZipArchive(sourcePaths: string[], destZipPath: string): Promise<string>` — zips files
  and/or folders (recursively) into a new archive; returns the final path.
- `extractZipArchive(zipPath: string, destDir: string): Promise<string>` — extracts an archive
  into `destDir` (created if missing); returns `destDir`. Entries that would escape `destDir`
  (a "zip slip" attempt) are skipped.

### `db.sqlite` methods

- `listSqliteTables(dbPath: string): Promise<string[]>`
- `querySqliteTable(dbPath: string, table: string, limit: number, offset: number): Promise<{ columns: string[]; rows: (string | null)[][] }>`
  — all values are stringified for display.

### `db.mongo` methods

- `listMongoDatabases(uri: string): Promise<string[]>`
- `listMongoCollections(uri: string, dbName: string): Promise<string[]>`
- `queryMongoCollection(uri: string, dbName: string, collection: string, limit: number): Promise<string[]>`
  — documents as pretty-printable JSON strings. There's no live MongoDB server in this project's
  test environment, so this path is tested only for malformed-URI and unreachable-server cases;
  connect/query behavior against a real server is unverified by automated tests.

### `git.read` methods

- `gitStatus(repoPath: string): Promise<{ path: string; status: string }[]>` — parsed
  `git status --porcelain` output.
- `gitLog(repoPath: string, limit: number): Promise<{ hash: string; message: string; author: string; date: string }[]>`

Both require a `git` executable on `PATH` and fail if `repoPath` isn't inside a git working tree.

### `system.exec` methods

- `runCommand(cwd: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>`
  — runs `command` through the OS shell (`cmd /C` on Windows, `sh -c` elsewhere) in `cwd`, with
  the app's own OS permissions. **No sandboxing, no confirmation prompt.** Only grant this
  permission to plugins you trust completely.

### `fs.scan` methods

- `scanDirectory(root: string): Promise<{ path: string; size: number }[]>` — recursively lists
  every file (not directory) under `root` with its size. Symlinks are not followed.
- `hashFiles(paths: string[]): Promise<{ path: string; hash: string }[]>` — hashes each path with
  BLAKE3, streaming file contents rather than reading fully into memory. A single unreadable path
  fails the whole batch.
- `hashFileAll(path: string): Promise<{ md5: string; sha1: string; sha256: string }>` — computes
  MD5, SHA-1, and SHA-256 of a single file in one streaming pass. Useful for matching a checksum
  published on a download page (which won't be BLAKE3).

### `fs.list` methods

- `listDirectory(path: string): Promise<EntryInfo[]>` — non-recursive listing of `path`'s
  immediate children (same data the core file list itself uses). Each entry has `name`, `path`,
  `isDir`, `size`, `modified`, `created`.

### `fs.rename` methods

- `renameEntry(path: string, newName: string): Promise<string>` — renames the entry at `path` to
  `newName` (a bare name, not a full path) within the same folder; returns the new full path.
  Fails if `newName` already exists (unless it's just a case-only change on a case-insensitive
  filesystem).

### `registerCommand`

```ts
api.registerCommand({
  id: string,     // unique within this plugin
  label: string,  // shown in the command palette's list
  run: () => void,
});
```

Adds an entry to the command palette (`Ctrl+K`/`Cmd+K`), alongside the app's built-in commands
and any other plugins' commands. There's no arguments passed to `run` — a command is a fixed
action, not something that takes input at invocation time.

## Plugin marketplace

Settings → Plugins → "Browse Marketplace" lists every plugin in [`marketplace.json`](../marketplace.json)
(repo root) that isn't already installed, with an "Install" button per entry. This is core-app
UI, not a plugin — it isn't gated behind any permission, since the core app already has
unrestricted filesystem access.

**How it works:** the app fetches `marketplace.json` and each installed plugin's `manifest.json`
+ entry file straight from `raw.githubusercontent.com` on the `master` branch (always the latest
commit, not pinned to any release tag), then calls a new `install_plugin` Tauri command that
writes those two files into a new subdirectory of the plugins directory named after the plugin's
`id`. Existing files at that path are overwritten. After a successful install, plugin loading
re-runs immediately — no app restart needed, same as toggling a plugin on/off in the list above.

**`marketplace.json` format:**

```json
[{ "id": "archive-manager", "name": "Archive Manager", "description": "..." }]
```

`id` must match the plugin's actual folder name under `examples/plugins/` (that's how its
`manifest.json`/entry file URLs get constructed) and the `id` field inside its own
`manifest.json`.

**Trust model:** every plugin currently listed is first-party content living in this same repo,
so installing one just copies files you could otherwise get from `examples/plugins/` yourself.
There's no signature verification or sandboxing beyond what's already true of any manually
installed plugin (see "How entry files execute" below) — if `marketplace.json` or a plugin's
own directory ever pointed at a third-party or attacker-controlled source, installing from it
would run that code with the same trust as any other plugin. Don't add third-party sources to
`marketplace.json` without the same scrutiny you'd apply to installing a plugin manually.

A plugin listed here may need backend capabilities newer than whatever app version is actually
running (the same core-app-vs-plugin gap `docs/releasing.md` describes for the example plugins in
general) — the marketplace UI has no way to detect or warn about that mismatch.

## How entry files execute — and why this matters

An entry file is loaded as plain text via IPC and run through `new Function("api", code)` — it is
**not** an ES module (no `import`/`export`) and it is **not** sandboxed. Two consequences:

1. **Only plain scripts, no `import`/`export`.** If you need dependencies, bundle them into the
   single entry file yourself (e.g. with esbuild) before shipping the plugin.
2. **Permission gating is not a security boundary.** `new Function` executes with access to the
   full global scope (`window`, `document`, `fetch`, and anything else a webview exposes) — a
   plugin isn't limited to whatever's on `api` if it goes looking for globals directly.
   `permissions` controls the *documented, supported* surface; it doesn't stop malicious code.
   Only install plugins you trust. Real sandboxing (e.g. running plugin code in a restricted Web
   Worker with a message-passed API instead of directly-shared globals) is future hardening, not
   part of this pass.

This design was a deliberate choice over dynamically `import()`-ing a plugin as an ES module from
its `asset://` URL — that pattern is not a reliably documented/supported one in Tauri v2 as of
this writing (module MIME handling over a custom protocol is unsettled), whereas `new Function`
is guaranteed, standard JS behavior in any engine, including WebView2's Chromium engine.

## Enabling and disabling plugins

Settings → Plugins lists every plugin found on disk with a checkbox. Unchecking it adds the
plugin's `id` to `disabledPlugins` in `settings.json` and immediately re-runs plugin loading —
a disabled plugin's manifest still shows up (so it can be re-enabled), but its entry script
doesn't execute and nothing it would have registered (sidebar panel, toolbar button, context
menu item, file handler) appears. Because plugin entry scripts register UI as a side effect
rather than through an idempotent/declarative API, toggling reloads *all* plugins from a clean
slate rather than trying to surgically unregister just the one being turned off.

## Not yet implemented

Everything else `Plan.md`'s Plugin Capabilities list mentions is deferred — each needs a host UI
surface that doesn't exist yet:

- Settings pages (plugins can't currently contribute their own settings UI)
- Background services, notifications (no lifecycle hooks or notification system exist yet)
- A real permission-enforcement sandbox (see above)
