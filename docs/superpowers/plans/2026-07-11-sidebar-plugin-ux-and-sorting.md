# Sidebar/Plugin UX, Performance, and File Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the plugin-loading performance problem, declutter the sidebar when many plugins are
enabled, let the Archive Manager plugin compress folders from the right-click menu, make the
sidebar resizable, and add real sort options to the file list.

**Architecture:** No new subsystems — this extends `usePluginStore`, `useSettingsStore`,
`FileList`/`Sidebar`, and one example plugin. Each of the 5 items below is independently
shippable; there's no dependency between them except that Task 1 (perf) and Task 2 (collapsing)
both touch `usePluginStore`/`Sidebar.tsx`, so do them in order.

**Tech Stack:** Same as the rest of the app — React/TypeScript/Zustand frontend, Rust/Tauri
backend. No new dependencies needed for any of the 5 items.

---

## Diagnosis: why "a bunch of plugins" makes the app slow

Read `apps/desktop/src/stores/usePluginStore.ts` before starting Task 1. Two confirmed causes:

1. **`loadPlugins()` reloads every enabled plugin serially, from scratch, on every single
   toggle.** Toggling one plugin in Settings calls `loadPlugins()`, which resets `panels`/
   `toolbarButtons`/`contextMenuItems`/`fileHandlers` to empty and then, for every *other*
   enabled plugin, `await`s a fresh `invoke("read_plugin_entry", ...)` IPC round-trip and
   re-runs its entry script with `new Function(...)` — one at a time, not in parallel. With N
   enabled plugins, flipping one checkbox costs N sequential IPC round-trips plus N script
   re-executions, even though N-1 of those plugins didn't change.
2. **Plugins that use `nav.read`'s `onFolderChange` do real work on every navigation, and there's
   no debouncing.** `git-integration`'s `onFolderChange` handler calls both `api.gitStatus` and
   `api.gitLog`, each of which shells out to a `git` child process
   (`crates/plugins/src/git.rs`). That happens on *every* folder navigation, including into
   folders that aren't git repositories (the process still spawns, then fails). With
   git-integration enabled, browsing feels sluggish because every click-into-a-folder now waits
   on two subprocess spawns before the UI settles.

Task 1 fixes both. It does not add a plugin sandbox or process pooling — those are bigger changes
out of scope here.

---

## Task 1: Fix plugin reload performance

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`
- Modify: `examples/plugins/git-integration/frontend/index.js`
- Test: `apps/desktop/src/stores/usePluginStore.test.ts` (new file — no test currently covers this store)

- [ ] **Step 1: Write a failing test for parallel entry-fetching**

`usePluginStore` currently has no test file. Add one that mocks `invoke` and asserts
`read_plugin_entry` is called for all manifests before any of them resolves (i.e. fetches are
kicked off in parallel, not awaited one at a time in the loop body).

```typescript
// apps/desktop/src/stores/usePluginStore.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { usePluginStore } from "./usePluginStore";
import { useSettingsStore } from "./useSettingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

function manifest(id: string) {
  return {
    id,
    name: id,
    version: "1.0.0",
    author: "test",
    permissions: [],
    entry: "index.js",
    dir: `/plugins/${id}`,
    hasIcon: false,
  };
}

describe("usePluginStore.loadPlugins", () => {
  beforeEach(() => {
    useSettingsStore.setState({ disabledPlugins: [] });
  });

  it("fetches every enabled plugin's entry code in parallel, not one at a time", async () => {
    const manifests = [manifest("a"), manifest("b"), manifest("c")];
    const resolvers: Array<() => void> = [];
    const pendingFetches: string[] = [];

    vi.mocked(invoke).mockImplementation((command: string, args?: any) => {
      if (command === "list_plugins") return Promise.resolve(manifests);
      if (command === "read_plugin_entry") {
        pendingFetches.push(args.path);
        return new Promise((resolve) => {
          resolvers.push(() => resolve("// no-op"));
        });
      }
      return Promise.resolve(undefined);
    });

    const loadPromise = usePluginStore.getState().loadPlugins();

    // Give the microtask queue a turn so any synchronously-kicked-off fetches land.
    await Promise.resolve();
    await Promise.resolve();

    expect(pendingFetches).toHaveLength(3);

    resolvers.forEach((resolve) => resolve());
    await loadPromise;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run usePluginStore.test.ts`
Expected: FAIL — only 1 fetch is pending after the microtask turn, because the current
implementation awaits each plugin's fetch-and-run before starting the next.

- [ ] **Step 3: Parallelize entry fetching, keep execution order stable**

Replace the `for...of` loop in `loadPlugins` with a two-phase approach: kick off all
`read_plugin_entry` fetches at once via `Promise.all`, then run each plugin's `new Function`
in manifest order once its code has arrived. This keeps plugin *execution* order deterministic
(so registration order in the sidebar/toolbar doesn't shuffle between runs) while removing the
serial IPC wait.

```typescript
// In apps/desktop/src/stores/usePluginStore.ts, replace the body of loadPlugins from
// "const errors: PluginLoadError[] = [];" through the closing of the for-loop with:

    const errors: PluginLoadError[] = [];
    const disabledPlugins = useSettingsStore.getState().disabledPlugins;
    const enabledManifests = manifests.filter((m) => !disabledPlugins.includes(m.id));

    const fetched = await Promise.all(
      enabledManifests.map(async (manifest) => {
        try {
          const code = await invoke<string>("read_plugin_entry", {
            path: `${manifest.dir}/${manifest.entry}`,
          });
          return { manifest, code, error: null as string | null };
        } catch (error) {
          return { manifest, code: null, error: String(error) };
        }
      }),
    );

    for (const { manifest, code, error } of fetched) {
      if (error !== null || code === null) {
        errors.push({ pluginId: manifest.id, message: error ?? "Could not read plugin entry" });
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
        });
        // eslint-disable-next-line no-new-func
        const run = new Function("api", code);
        run(api);
      } catch (error) {
        errors.push({ pluginId: manifest.id, message: String(error) });
      }
    }

    set({ manifests, errors, loaded: true });
```

Leave everything above that block (the `set({ panels: [], ... })` reset, the `list_plugins`
fetch) and the function signature unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && npx vitest run usePluginStore.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite to check nothing else broke**

Run: `cd apps/desktop && npm test -- --run`
Expected: all existing tests still pass (this change doesn't alter `createPluginApi` or any
public store shape, just the fetch scheduling inside `loadPlugins`)

- [ ] **Step 6: Debounce git-integration's per-navigation subprocess calls**

`examples/plugins/git-integration/frontend/index.js` currently calls `refresh(path)`
(which runs `gitStatus` + `gitLog`) synchronously on every `onFolderChange` firing. Add a
300ms debounce so rapidly clicking through several folders (e.g. arrow-key navigation, or
double-click chains) only triggers one pair of git calls for wherever the user lands, not one
pair per folder passed through.

Find this block:
```javascript
    const unsubscribe = api.onFolderChange?.((path) => {
      refresh(path);
    });
```

Replace with:
```javascript
    let debounceTimer = null;
    const unsubscribe = api.onFolderChange?.((path) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refresh(path), 300);
    });
```

And update the cleanup function to also clear the timer:
```javascript
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe?.();
    };
```

- [ ] **Step 7: Sync the updated git-integration plugin to the installed copy and manually confirm**

This plugin has no automated test harness (it's plain JS running via `new Function`, not part
of the Vitest suite). After editing, copy it to the live plugins directory so it can be tried:

```sh
cp -r "examples/plugins/git-integration/." "$APPDATA/Krampus Explorer/plugins/git-integration/"
```

- [ ] **Step 8: Commit**

```sh
git add apps/desktop/src/stores/usePluginStore.ts apps/desktop/src/stores/usePluginStore.test.ts examples/plugins/git-integration/frontend/index.js
git commit -m "Parallelize plugin entry loading, debounce git-integration's per-navigation git calls"
```

---

## Task 2: Collapsible plugin sidebar sections

**Problem:** every plugin sidebar panel is always expanded and always visible — with several
plugins enabled, the sidebar becomes a long scroll of sections most of which aren't relevant to
what you're doing right now.

**Design:** add a collapse/expand toggle to each plugin panel's heading (▸/▾ disclosure
triangle, same visual language as most file-explorer sidebars). Collapsed state persists per
plugin ID in settings, defaulting to **expanded** for a newly-installed plugin so it's
discoverable, but remembered across restarts once the user collapses it. Built-in sections
(Drives, Favorites) get the same treatment for consistency, since they contribute to the same
clutter problem.

**Files:**
- Modify: `crates/settings/src/lib.rs` (new `collapsed_sidebar_sections: Vec<String>` field)
- Modify: `apps/desktop/src/stores/useSettingsStore.ts`
- Modify: `apps/desktop/src/sidebar/PluginPanel.tsx`
- Modify: `apps/desktop/src/sidebar/DriveList.tsx`, `apps/desktop/src/sidebar/FavoritesList.tsx`
- New: `apps/desktop/src/sidebar/CollapsibleSection.tsx` (shared component)
- Modify: `apps/desktop/src/sidebar/Sidebar.css`

- [ ] **Step 1: Add `collapsed_sidebar_sections` to the Settings backend**

In `crates/settings/src/lib.rs`, add the field (same pattern as `disabled_plugins`):

```rust
    /// IDs of sidebar sections the user has collapsed (built-in section IDs "drives"/
    /// "favorites", or a plugin's panel ID for plugin sections).
    #[serde(default)]
    pub collapsed_sidebar_sections: Vec<String>,
```

Add it to `Default for Settings` as `collapsed_sidebar_sections: Vec::new(),`.

- [ ] **Step 2: Write the backward-compatibility test**

```rust
    #[test]
    fn load_settings_fills_in_missing_collapsed_sidebar_sections_without_resetting_everything_else() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r##"{"theme":"dark","accentColor":"#ff0000","startupMode":"custom","startupCustomPath":"C:\\Projects","iconSize":"large"}"##,
        )
        .unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.collapsed_sidebar_sections, Vec::<String>::new());
    }
```

Add `collapsed_sidebar_sections: vec![...]` to the existing `save_then_load_round_trips` test's
constructed `Settings` too, so the round-trip test covers the new field.

- [ ] **Step 3: Run `cargo test -p explorer-settings` to verify both pass**

- [ ] **Step 4: Add the field to the frontend `BackendSettings`/`SettingsState` types**

In `apps/desktop/src/stores/useSettingsStore.ts`, mirror the `disabledPlugins` pattern:
add `collapsedSidebarSections: string[]` to `BackendSettings`, `DEFAULTS`, `SettingsState`,
`loadSettings`, `persist`, and add a `toggleSidebarSection: (sectionId: string) => void` action
that adds/removes the ID from the array and persists (same shape as `setPluginEnabled`).

- [ ] **Step 5: Build the shared `CollapsibleSection` component**

```tsx
// apps/desktop/src/sidebar/CollapsibleSection.tsx
import type { ReactNode } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";

interface CollapsibleSectionProps {
  sectionId: string;
  title: string;
  children: ReactNode;
}

function CollapsibleSection({ sectionId, title, children }: CollapsibleSectionProps) {
  const collapsed = useSettingsStore((state) => state.collapsedSidebarSections.includes(sectionId));
  const toggle = useSettingsStore((state) => state.toggleSidebarSection);

  return (
    <div className="sidebar__section">
      <button
        type="button"
        className="sidebar__heading sidebar__heading--button"
        onClick={() => toggle(sectionId)}
        aria-expanded={!collapsed}
      >
        <span className={`sidebar__disclosure ${collapsed ? "" : "sidebar__disclosure--open"}`} aria-hidden="true">
          &#x25B8;
        </span>
        {title}
      </button>
      {!collapsed && children}
    </div>
  );
}

export default CollapsibleSection;
```

Add matching CSS to `apps/desktop/src/sidebar/Sidebar.css`:

```css
.sidebar__heading--button {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.sidebar__disclosure {
  display: inline-block;
  font-size: 9px;
  transition: transform 0.1s ease;
}

.sidebar__disclosure--open {
  transform: rotate(90deg);
}
```

- [ ] **Step 6: Wire `CollapsibleSection` into `PluginPanel`, `DriveList`, `FavoritesList`**

In each, replace the existing `<div className="sidebar__section"><div className="sidebar__heading">...` wrapper with `<CollapsibleSection sectionId={...} title={...}>...</CollapsibleSection>`,
moving the existing inner content (list / loading / error state) to be the `children`. Use
`panel.pluginId + ":" + panel.id` as `PluginPanel`'s `sectionId` (matches the existing React
`key` convention in `Sidebar.tsx`), `"drives"` for `DriveList`, `"favorites"` for
`FavoritesList`.

- [ ] **Step 7: Add a test for `CollapsibleSection`**

```typescript
// apps/desktop/src/sidebar/CollapsibleSection.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollapsibleSection from "./CollapsibleSection";
import { useSettingsStore } from "../stores/useSettingsStore";

describe("CollapsibleSection", () => {
  it("shows children by default and hides them after the heading is clicked", () => {
    useSettingsStore.setState({ collapsedSidebarSections: [] });
    render(
      <CollapsibleSection sectionId="test-section" title="Test">
        <p>content</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Test/ }));

    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });
});
```

Run: `cd apps/desktop && npx vitest run CollapsibleSection.test.tsx` — expect PASS.

- [ ] **Step 8: Run the full frontend suite and build**

Run: `cd apps/desktop && npm test -- --run && npm run build`
Expected: all pass, clean build.

- [ ] **Step 9: Commit**

```sh
git add crates/settings/src/lib.rs apps/desktop/src/stores/useSettingsStore.ts apps/desktop/src/sidebar/
git commit -m "Add collapsible sidebar sections (built-in and plugin panels), persisted per section"
```

---

## Task 3: Archive Manager folder context menu entry

**Problem:** Archive Manager only works from its sidebar panel today — you have to manually type
or paste a folder path in. Right-clicking a folder in the file list should offer a "Compress"
shortcut.

**Design:** add the `ui.contextMenu` permission to the Archive Manager plugin's manifest.
Register a context menu item that only makes sense for folders — but `PluginContextMenuItem`'s
`onClick(path)` doesn't currently tell the plugin whether `path` is a file or a folder,
so this task also needs a small API addition: pass an `isDir` flag alongside the path. On click,
compress the folder into a sibling zip named after the folder (e.g. `Documents/` →
`Documents.zip`), reusing `api.createZipArchive` and showing a native OS notification via a
transient status write to `console.log`... no — this plugin has no way to show a toast today, so
on success/failure it should use `window.alert`-equivalent behavior consistent with what the
rest of the app does. Since Phase 8 replaced `window.alert` app-wide with the toast system,
and plugins execute with full global scope access, the plugin can call `window.alert` itself —
that's acceptable for a plugin (it isn't part of the host app's own UI), but for consistency
either alert or silently no-op-and-log is fine; this plan uses `window.alert` for simplicity
since plugins aren't in scope for the toast system.

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts` (`PluginContextMenuItem.onClick` gains `isDir`)
- Modify: `apps/desktop/src/plugins/pluginApi.ts` and its test
- Modify: `apps/desktop/src/stores/usePluginStore.ts`
- Modify: `apps/desktop/src/explorer/FileList.tsx`
- Modify: `examples/plugins/archive-manager/manifest.json`
- Modify: `examples/plugins/archive-manager/frontend/index.js`

- [ ] **Step 1: Add `isDir` to the context menu item's click payload**

In `apps/desktop/src/types/plugin.ts`, change:
```ts
export interface PluginContextMenuItem {
  id: string;
  label: string;
  onClick: (path: string) => void;
}
```
to:
```ts
export interface PluginContextMenuItem {
  id: string;
  label: string;
  onClick: (path: string, isDir: boolean) => void;
}
```

- [ ] **Step 2: Update `pluginApi.ts`'s type re-export (no logic change needed there — it just
  forwards the object) and its test's `registerContextMenuItem` mock/assertion to include the
  new signature.** In `apps/desktop/src/plugins/pluginApi.test.ts`, the existing
  `"forwards the plugin's id when registering a context menu item"` test's `item.onClick` mock
  doesn't need changes (it's just `vi.fn()`), since `createPluginApi` doesn't inspect the
  function signature — only `FileList.tsx`'s caller needs to change what it passes.

- [ ] **Step 3: Pass `isDir` when `FileList.tsx` invokes a context menu item**

`FileList.tsx`'s `ContextMenuState` currently only tracks `path`. Add `isDir: boolean`:

```typescript
interface ContextMenuState {
  path: string;
  isDir: boolean;
  x: number;
  y: number;
}
```

Update the two places that call `setMenu(...)` (the row's `onContextMenu` handler) to include
`isDir: entry.isDir`. Then update the context-menu-items render block:

```tsx
              {contextMenuItems.map((item) => (
                <button
                  key={`${item.pluginId}:${item.id}`}
                  onClick={() => {
                    const path = menu.path;
                    const isDir = menu.isDir;
                    setMenu(null);
                    item.onClick(path, isDir);
                  }}
                >
                  {item.label}
                </button>
              ))}
```

- [ ] **Step 4: Run `cd apps/desktop && npx tsc --noEmit` to confirm the type change compiles
  cleanly through `FileList.tsx` and `pluginApi.ts`**

- [ ] **Step 5: Add `ui.contextMenu` permission to Archive Manager**

In `examples/plugins/archive-manager/manifest.json`, add `"ui.contextMenu"` to the
`permissions` array (alongside the existing `ui.sidebar`, `nav.read`, `fs.archive`).

- [ ] **Step 6: Register the context menu item in Archive Manager's entry script**

In `examples/plugins/archive-manager/frontend/index.js`, after the existing
`api.registerSidebarPanel({...})` call, add:

```javascript
function basename(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

api.registerContextMenuItem?.({
  id: "compress-folder",
  label: "Compress to .zip",
  onClick: async (path, isDir) => {
    if (!isDir) {
      window.alert("Only folders can be compressed from the context menu — use the sidebar panel for individual files.");
      return;
    }
    const destZipPath = `${path}.zip`;
    try {
      await api.createZipArchive([path], destZipPath);
    } catch (error) {
      window.alert(String(error));
    }
  },
});
```

Note the `?.` — `registerContextMenuItem` is only present if the manifest declared
`ui.contextMenu`, so this stays safe even if someone copies this file into a manifest that
doesn't have the permission.

- [ ] **Step 7: Register an "Extract Here" entry for `.zip` files**

Right after the `compress-folder` registration, add a second context menu item that only makes
sense for zip files (not folders, not other file types). `PluginContextMenuItem.onClick` gets
`isDir` but not the extension — check it directly against `path` inside the handler, and just
no-op (don't show an error) for non-.zip files, since a context menu entry that's present but
silently does nothing for the wrong file type is the standard convention this app already uses
(compare: Archive Manager's own sidebar panel doesn't validate the source is actually an
archive before trying to extract it either — the backend's own error surfaces if it isn't).

```javascript
api.registerContextMenuItem?.({
  id: "extract-here",
  label: "Extract Here",
  onClick: async (path, isDir) => {
    if (isDir || !path.toLowerCase().endsWith(".zip")) return;
    const parent = path.slice(0, path.length - basename(path).length - 1);
    const destDir = `${parent}\\${basename(path).replace(/\.zip$/i, "")}`;
    try {
      await api.extractZipArchive(path, destDir);
    } catch (error) {
      window.alert(String(error));
    }
  },
});
```

This extracts `Documents.zip` into a sibling `Documents\` folder, matching Windows Explorer's
own "Extract Here" convention. `basename` is the helper already added in Step 6.

Both `compress-folder` and `extract-here` show up in the context menu for every entry (the
context menu API doesn't currently support hiding an item based on the clicked entry — see the
`onClick` early-returns above, which is the workaround). A future improvement would be a
`shouldShow(path, isDir)` predicate on `PluginContextMenuItem` so irrelevant entries don't
appear at all; out of scope for this plan since it touches the same API surface as `isDir` did
and it's cleaner to land that as one follow-up than keep expanding this task.

- [ ] **Step 8: Update the Archive Manager README**

Add a note to `examples/plugins/archive-manager/README.md`'s permissions list and two new
paragraphs describing the "Compress to .zip" and "Extract Here" context menu entries (right-click
a folder or a `.zip` file respectively), and where each puts its output.

- [ ] **Step 9: Run the frontend suite and build**

Run: `cd apps/desktop && npm test -- --run && npm run build`
Expected: PASS, clean build.

- [ ] **Step 10: Sync the plugin to the installed copy**

```sh
cp -r "examples/plugins/archive-manager/." "$APPDATA/Krampus Explorer/plugins/archive-manager/"
```

- [ ] **Step 11: Commit**

```sh
git add apps/desktop/src/types/plugin.ts apps/desktop/src/explorer/FileList.tsx examples/plugins/archive-manager/
git commit -m "Add isDir to context menu clicks; add Archive Manager's compress/extract context menu entries"
```

---

## Task 4: Resizable sidebar

**Design:** a drag handle on the sidebar's right edge, dragging sets `sidebar.width` in pixels,
clamped to a sane range (e.g. 140–480px) so it can't be dragged to nothing or to absurdly wide.
Persisted in settings so it survives restarts. Follows the same
`crates/settings` → `useSettingsStore` → component pattern as every other persisted setting in
this app.

**Files:**
- Modify: `crates/settings/src/lib.rs` (`sidebar_width: u32`)
- Modify: `apps/desktop/src/stores/useSettingsStore.ts`
- Modify: `apps/desktop/src/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/sidebar/Sidebar.css`

- [ ] **Step 1: Add `sidebar_width` to the Settings backend**

```rust
    /// Sidebar width in pixels. Clamped to [140, 480] on the frontend, not here — the backend
    /// just persists whatever it's given.
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
```

Add the default function near `default_settings_path`:
```rust
fn default_sidebar_width() -> u32 {
    200
}
```

Add `sidebar_width: default_sidebar_width(),` to `Default for Settings`.

Note this uses `#[serde(default = "...")]` rather than plain `#[serde(default)]` (which the
other new-field precedents in this file use) because `0` is a bad default for a width — you
want a sane starting value if an old settings.json is missing this field, not a collapsed
sidebar.

- [ ] **Step 2: Add the backward-compatibility test**

```rust
    #[test]
    fn load_settings_fills_in_missing_sidebar_width_with_the_default_without_resetting_everything_else() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r##"{"theme":"dark","accentColor":"#ff0000","startupMode":"custom","startupCustomPath":"C:\\Projects","iconSize":"large"}"##,
        )
        .unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.sidebar_width, 200);
    }
```

Add `sidebar_width: 260,` to the existing `save_then_load_round_trips` test's `Settings`
construction.

- [ ] **Step 3: Run `cargo test -p explorer-settings`, expect PASS**

- [ ] **Step 4: Add `sidebarWidth`/`setSidebarWidth` to the frontend settings store**

Same pattern as `iconSize`: add to `BackendSettings`, `DEFAULTS` (200), `SettingsState`,
`loadSettings`, `persist`, plus:

```typescript
  setSidebarWidth: (sidebarWidth) => {
    const clamped = Math.min(480, Math.max(140, sidebarWidth));
    set({ sidebarWidth: clamped });
    persist(get());
  },
```

Clamp again on the frontend (belt-and-suspenders with the drag handler's own clamping in Step
5) so a hand-edited settings.json with an out-of-range value can't produce a broken layout.

- [ ] **Step 5: Add the drag handle to `Sidebar.tsx`**

```tsx
import { useCallback, useRef } from "react";
import DriveList from "./DriveList";
import FavoritesList from "./FavoritesList";
import PluginPanel from "./PluginPanel";
import { usePluginStore } from "../stores/usePluginStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import "./Sidebar.css";

function Sidebar() {
  const panels = usePluginStore((state) => state.panels);
  const width = useSettingsStore((state) => state.sidebarWidth);
  const setWidth = useSettingsStore((state) => state.setSidebarWidth);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!draggingRef.current) return;
      // The handle sits at the sidebar's right edge, so the pointer's x position (relative to
      // the sidebar's left edge, i.e. the viewport since the sidebar is the leftmost element)
      // is the new width directly.
      setWidth(event.clientX);
    },
    [setWidth],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div className="sidebar-wrapper" style={{ width }}>
      <aside className="sidebar">
        <FavoritesList />
        <DriveList />
        {panels.map((panel) => (
          <PluginPanel key={`${panel.pluginId}:${panel.id}`} panel={panel} />
        ))}
      </aside>
      <div
        className="sidebar__resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </div>
  );
}

export default Sidebar;
```

- [ ] **Step 6: Update `Sidebar.css`**

The existing `.sidebar` rule has `width: 200px;` — remove that (width now comes from the inline
style on `.sidebar-wrapper`) and add:

```css
.sidebar-wrapper {
  position: relative;
  flex-shrink: 0;
  display: flex;
}

.sidebar-wrapper .sidebar {
  width: 100%;
}

.sidebar__resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.sidebar__resize-handle:hover,
.sidebar__resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}
```

Check `App.css`/`Explorer.css` for wherever `Sidebar` is composed (`App.tsx`'s `.app__body`) and
confirm the flex layout still holds now that `Sidebar` renders a wrapper div instead of the
`<aside>` directly — `flex-shrink: 0` on `.sidebar-wrapper` replaces what was previously on
`.sidebar`.

- [ ] **Step 7: Manual verification note**

Pointer-drag resizing has no meaningful jsdom-based test (jsdom doesn't lay out real pixel
geometry). Skip an automated test for the drag mechanics themselves; do add one test that
`setSidebarWidth` clamps out-of-range values:

```typescript
// apps/desktop/src/stores/useSettingsStore.test.ts (new file if it doesn't exist yet)
import { describe, expect, it } from "vitest";
import { useSettingsStore } from "./useSettingsStore";

describe("setSidebarWidth", () => {
  it("clamps to the [140, 480] range", () => {
    useSettingsStore.getState().setSidebarWidth(50);
    expect(useSettingsStore.getState().sidebarWidth).toBe(140);

    useSettingsStore.getState().setSidebarWidth(9999);
    expect(useSettingsStore.getState().sidebarWidth).toBe(480);

    useSettingsStore.getState().setSidebarWidth(300);
    expect(useSettingsStore.getState().sidebarWidth).toBe(300);
  });
});
```

(This test will invoke the real `invoke` from `@tauri-apps/api/core` via `persist()` — check
how other store tests in this codebase mock it, e.g. `pluginApi.test.ts`'s pattern, and mirror
that so this doesn't hit a real Tauri backend in the test run.)

- [ ] **Step 8: Run the full frontend suite and build**

Run: `cd apps/desktop && npm test -- --run && npm run build`

- [ ] **Step 9: Commit**

```sh
git add crates/settings/src/lib.rs apps/desktop/src/stores/useSettingsStore.ts apps/desktop/src/stores/useSettingsStore.test.ts apps/desktop/src/sidebar/Sidebar.tsx apps/desktop/src/sidebar/Sidebar.css
git commit -m "Make the sidebar resizeable via a drag handle, persisted width in settings"
```

---

## Task 5: File list sort options

**Problem:** the file list is always sorted folders-first-then-alphabetical (hardcoded in
`crates/filesystem/src/listing.rs`'s `list_directory`). No way to sort by size, type, or
modified/created date, or reverse the order.

**Design:** move sorting to the frontend (the backend keeps returning entries in its current
folders-first-alphabetical order as a stable base order; re-sorting client-side avoids a backend
round-trip every time the user changes sort order). Five sort fields: **Name**, **Size**,
**Type** (file extension, folders grouped separately — see below), **Date Modified**, **Date
Created**. Folders always sort before files regardless of the active sort field (matches current
behavior — sorting folders by "size" or "type" is meaningless since folders don't carry a size
or extension in this app).

Name/Size/Type/Modified get **clickable column headers** (click to sort by that column, click
again to reverse — the Windows Explorer list-view convention). Date Created doesn't get a 5th
column (four data columns is already close to what comfortably fits at the app's 800px
`minWidth`, and exact creation timestamps are a less frequently glanced-at value than the other
four) — instead there's one small "Sort by" `<select>` next to the table header offering all
five fields plus a direction-reverse button, which is how Created is reached. Both mechanisms
(column clicks and the dropdown) drive the same persisted `sortField`/`sortDirection` state, so
they always agree with each other.

**Files:**
- Modify: `crates/filesystem/src/listing.rs` (add `created: Option<String>` to `EntryInfo`)
- Modify: `apps/desktop/src/types/filesystem.ts` (mirror the new `created` field)
- Modify: `crates/settings/src/lib.rs` (`sort_field: String`, `sort_direction: String`)
- Modify: `apps/desktop/src/stores/useSettingsStore.ts`
- Modify: `apps/desktop/src/explorer/FileList.tsx`
- Modify: `apps/desktop/src/explorer/FileList.css`

- [ ] **Step 0: Add `created` to the backend's `EntryInfo`**

In `crates/filesystem/src/listing.rs`, add the field next to `modified`:

```rust
    /// Unix epoch seconds as a string, or `None` if the OS didn't report a creation time.
    pub created: Option<String>,
```

(right after the existing `pub modified: Option<String>,` line — same doc-comment style). In
`list_directory`'s entry-building loop, compute it the same way `modified` already is:

```rust
        let created = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());
```

and add `created,` to the `EntryInfo { ... }` struct literal (alongside the existing
`modified,`). `Metadata::created()` is reliably supported on Windows/NTFS, which is this app's
only target platform per `Plan.md` — no `#[cfg]` gate needed.

- [ ] **Step 1: Add a test that `created` is populated**

Extend the existing `list_directory_returns_sorted_entries_with_parent` test (or add a new one)
with an assertion that `listing.entries[2].created.is_some()` for the file entry (folders may or
may not report a creation time consistently across platforms, so only assert it for the file).

Run: `cargo test -p explorer-filesystem`, expect PASS.

- [ ] **Step 2: Mirror `created` in the frontend type**

Find wherever `EntryInfo`'s frontend counterpart is declared (likely
`apps/desktop/src/types/filesystem.ts`, the type `activeTab.entries: DirectoryEntry[]` holds)
and add `created: string | null;` next to the existing `modified: string | null;` field.

- [ ] **Step 3: Add `sort_field`/`sort_direction` to the Settings backend**

```rust
    /// "name" | "size" | "type" | "modified" | "created"
    #[serde(default = "default_sort_field")]
    pub sort_field: String,
    /// "asc" | "desc"
    #[serde(default = "default_sort_direction")]
    pub sort_direction: String,
```

```rust
fn default_sort_field() -> String {
    "name".to_string()
}

fn default_sort_direction() -> String {
    "asc".to_string()
}
```

Add both to `Default for Settings`.

- [ ] **Step 2: Add the backward-compatibility test**

```rust
    #[test]
    fn load_settings_fills_in_missing_sort_fields_with_defaults_without_resetting_everything_else() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r##"{"theme":"dark","accentColor":"#ff0000","startupMode":"custom","startupCustomPath":"C:\\Projects","iconSize":"large"}"##,
        )
        .unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.sort_field, "name");
        assert_eq!(settings.sort_direction, "asc");
    }
```

Add `sort_field: "size".to_string(), sort_direction: "desc".to_string(),` to the existing
round-trip test's `Settings` construction.

- [ ] **Step 3: Run `cargo test -p explorer-settings`, expect PASS**

- [ ] **Step 4: Add sort state to the frontend settings store**

Same pattern again: add `sortField: "name" | "size" | "modified"` and
`sortDirection: "asc" | "desc"` types, `DEFAULTS`, `SettingsState`, `loadSettings`, `persist`,
and:

```typescript
  setSort: (field) => {
    const { sortField, sortDirection } = get();
    if (field === sortField) {
      set({ sortDirection: sortDirection === "asc" ? "desc" : "asc" });
    } else {
      set({ sortField: field, sortDirection: "asc" });
    }
    persist(get());
  },
```

(One combined action rather than two separate setters, since "click the active column reverses
direction, click a different column resets to ascending" is a single interaction, not two
independent pieces of state a caller would set separately.)

- [ ] **Step 5: Write the sort comparator as a standalone, tested function**

Add near the top of `apps/desktop/src/explorer/FileList.tsx` (it doesn't need backend access,
so it's a pure function — easy to unit test in isolation):

```typescript
export function sortEntries(
  entries: DirectoryEntry[],
  field: "name" | "size" | "modified",
  direction: "asc" | "desc",
): DirectoryEntry[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (field === "name") {
      return sign * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    if (field === "size") {
      return sign * ((a.size ?? 0) - (b.size ?? 0));
    }
    // modified
    const aTime = a.modified ? Number(a.modified) : 0;
    const bTime = b.modified ? Number(b.modified) : 0;
    return sign * (aTime - bTime);
  });
}
```

Check `apps/desktop/src/types/filesystem.ts` (or wherever `DirectoryEntry`/`EntryInfo`'s
frontend type lives — it's the type `activeTab.entries` holds) for the exact field names and
import it rather than redefining it.

- [ ] **Step 6: Write the test for `sortEntries`**

```typescript
// apps/desktop/src/explorer/FileList.test.ts (new file)
import { describe, expect, it } from "vitest";
import { sortEntries } from "./FileList";

function entry(overrides: Partial<Parameters<typeof sortEntries>[0][number]>) {
  return {
    name: "a",
    path: "/a",
    isDir: false,
    size: null,
    modified: null,
    ...overrides,
  };
}

describe("sortEntries", () => {
  it("always puts folders before files regardless of sort field", () => {
    const entries = [entry({ name: "z_file.txt", isDir: false }), entry({ name: "a_folder", isDir: true })];

    const sorted = sortEntries(entries, "name", "asc");

    expect(sorted.map((e) => e.name)).toEqual(["a_folder", "z_file.txt"]);
  });

  it("sorts by size ascending and descending", () => {
    const entries = [
      entry({ name: "big.txt", size: 300 }),
      entry({ name: "small.txt", size: 10 }),
      entry({ name: "medium.txt", size: 100 }),
    ];

    const asc = sortEntries(entries, "size", "asc");
    expect(asc.map((e) => e.name)).toEqual(["small.txt", "medium.txt", "big.txt"]);

    const desc = sortEntries(entries, "size", "desc");
    expect(desc.map((e) => e.name)).toEqual(["big.txt", "medium.txt", "small.txt"]);
  });

  it("sorts by name case-insensitively", () => {
    const entries = [entry({ name: "banana" }), entry({ name: "Apple" }), entry({ name: "cherry" })];

    const sorted = sortEntries(entries, "name", "asc");

    expect(sorted.map((e) => e.name)).toEqual(["Apple", "banana", "cherry"]);
  });
});
```

Run: `cd apps/desktop && npx vitest run FileList.test.ts` — expect PASS. (Export `sortEntries`
from `FileList.tsx` the same way `formatSize`/`formatModified` already are.)

- [ ] **Step 7: Wire sorting into the render path and make headers clickable**

In `FileList.tsx`, read `sortField`/`sortDirection`/`setSort` from `useSettingsStore`, and
replace `activeTab.entries.map(...)` with
`sortEntries(activeTab.entries, sortField, sortDirection).map(...)`. Update the `<thead>`:

```tsx
        <thead>
          <tr>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("name")}>
                Name{sortField === "name" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("size")}>
                Size{sortField === "size" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("modified")}>
                Modified{sortField === "modified" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
          </tr>
        </thead>
```

Add to `FileList.css`:
```css
.file-list__sort-button {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 8: Run the full frontend suite and build**

Run: `cd apps/desktop && npm test -- --run && npm run build`

- [ ] **Step 9: Commit**

```sh
git add crates/settings/src/lib.rs apps/desktop/src/stores/useSettingsStore.ts apps/desktop/src/explorer/FileList.tsx apps/desktop/src/explorer/FileList.css apps/desktop/src/explorer/FileList.test.ts
git commit -m "Add sortable file list columns (name/size/modified, persisted)"
```

---

## Final check (after all 5 tasks)

- [ ] `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- [ ] `cd apps/desktop && npm test -- --run && npm run build`
- [ ] Sync every touched example plugin (`git-integration`, `archive-manager`) to
  `%APPDATA%\Krampus Explorer\plugins\` and note in the final summary that a full app restart
  is needed to pick up both the plugin changes and the new sidebar/settings behavior.
