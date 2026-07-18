# Recycling Bin Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Recycling Bin plugin that lists, restores, permanently deletes, and empties the
Windows Recycle Bin — plus a new, reusable `api.confirm()` plugin primitive that any future
plugin (including the later Drive Format and Secure Wipe plugins) can use for destructive-action
confirmation.

**Architecture:** A new `crates/filesystem/src/trash_bin.rs` module wraps the already-a-dependency
`trash` crate's `os_limited` API. A new `useConfirmStore` + one `<ConfirmDialogHost>` mounted at
the app root exposes confirmation dialogs to plugin code (which can't render React directly). Both
get wired into the existing plugin permission system as two new permissions, `fs.trash` and
`ui.confirm`. A new example plugin, `recycling-bin`, ties it all together.

**Tech Stack:** Rust (the `trash` crate v5.2.6, already a dependency), React, TypeScript, Zustand.

Full design: `docs/superpowers/specs/2026-07-18-recycling-bin-plugin-design.md`.

---

### Task 1: Backend — `crates/filesystem/src/trash_bin.rs`

**Files:**
- Create: `crates/filesystem/src/trash_bin.rs`
- Modify: `crates/filesystem/src/lib.rs`

This task has **no automated tests** — see the design doc's Testing section: the existing
`delete_entry` (`crates/filesystem/src/operations.rs`), which already wraps `trash::delete`, has
zero automated tests because exercising it for real deletes actual files into the user's real
Windows Recycle Bin on every `cargo test` run, and the `trash` crate has no fake/injectable trash
directory. This task follows the same precedent. Verification is manual, in Task 8.

- [ ] **Step 1: Create `trash_bin.rs`**

Create `crates/filesystem/src/trash_bin.rs`:

```rust
use serde::{Deserialize, Serialize};
use trash::os_limited::{list, metadata, purge_all, restore_all};
use trash::TrashItem;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub id: String,
    pub name: String,
    pub original_parent: String,
    pub time_deleted: i64,
    pub size_bytes: Option<u64>,
}

fn to_trashed_item(item: &TrashItem) -> TrashedItem {
    let size_bytes = metadata(item).ok().and_then(|m| m.size.size());
    TrashedItem {
        id: item.id.to_string_lossy().to_string(),
        name: item.name.to_string_lossy().to_string(),
        original_parent: item.original_parent.to_string_lossy().to_string(),
        time_deleted: item.time_deleted,
        size_bytes,
    }
}

/// Lists everything currently in the OS Recycle Bin. Each item's size is fetched via a
/// per-item `metadata()` call (the `trash` crate's `list()` doesn't include it) -- a failed
/// metadata lookup just leaves that item's `size_bytes` as `None` rather than failing the whole
/// listing, matching this codebase's established "one bad entry shouldn't abort the operation"
/// pattern (see `crates/search`'s indexer and `crates/plugins`' `scan::walk`).
pub fn list_trash_items() -> Result<Vec<TrashedItem>, String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    Ok(items.iter().map(to_trashed_item).collect())
}

/// `restore_all`/`purge_all` take actual `TrashItem` values, not bare ids, so every
/// single-item operation re-lists and finds the matching item by id first. The Recycle Bin is
/// small enough in normal use (dozens to low hundreds of items, not the hundreds of thousands a
/// whole-drive scan can produce) that re-listing per call is not a performance concern.
fn find_by_id(id: &str) -> Result<TrashItem, String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    items
        .into_iter()
        .find(|item| item.id.to_string_lossy() == id)
        .ok_or_else(|| {
            format!(
                "No Recycle Bin item with id '{id}' -- it may have already been restored or permanently deleted"
            )
        })
}

pub fn restore_trash_item(id: &str) -> Result<(), String> {
    let item = find_by_id(id)?;
    restore_all(std::iter::once(item)).map_err(|e| format!("Could not restore item: {e}"))
}

pub fn purge_trash_item(id: &str) -> Result<(), String> {
    let item = find_by_id(id)?;
    purge_all(std::iter::once(item)).map_err(|e| format!("Could not permanently delete item: {e}"))
}

/// Permanently deletes everything currently in the Recycle Bin.
pub fn empty_trash() -> Result<(), String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    purge_all(items).map_err(|e| format!("Could not empty the Recycle Bin: {e}"))
}
```

- [ ] **Step 2: Re-export from `lib.rs`**

In `crates/filesystem/src/lib.rs`, change:

```rust
mod drives;
mod home;
mod listing;
mod operations;

pub use drives::{list_drives, DriveInfo};
pub use home::default_start_path;
pub use listing::{list_directory, DirectoryListing, EntryInfo};
pub use operations::{
    copy_entry, copy_entry_reporting, create_file, create_folder, delete_entry, move_entry,
    move_entry_reporting, rename_entry,
};
```

to:

```rust
mod drives;
mod home;
mod listing;
mod operations;
mod trash_bin;

pub use drives::{list_drives, DriveInfo};
pub use home::default_start_path;
pub use listing::{list_directory, DirectoryListing, EntryInfo};
pub use operations::{
    copy_entry, copy_entry_reporting, create_file, create_folder, delete_entry, move_entry,
    move_entry_reporting, rename_entry,
};
pub use trash_bin::{empty_trash, list_trash_items, purge_trash_item, restore_trash_item, TrashedItem};
```

- [ ] **Step 3: Confirm it compiles**

Run: `cargo build -p explorer-filesystem`
Expected: builds successfully (no tests to run for this crate's new code, per this task's intro).

- [ ] **Step 4: Commit**

```bash
git add crates/filesystem/src/trash_bin.rs crates/filesystem/src/lib.rs
git commit -m "Add trash_bin module wrapping the trash crate's list/restore/purge API"
```

---

### Task 2: Wire the four new Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `apps/desktop/src-tauri/src/commands.rs`, find the top-level `use explorer_filesystem::{...}`
import line and add `TrashedItem` to it. Then add, right after the existing `delete_entry`
command:

```rust
#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    explorer_filesystem::delete_entry(&path)
}

#[tauri::command]
pub fn list_trash_items() -> Result<Vec<TrashedItem>, String> {
    explorer_filesystem::list_trash_items()
}

#[tauri::command]
pub fn restore_trash_item(id: String) -> Result<(), String> {
    explorer_filesystem::restore_trash_item(&id)
}

#[tauri::command]
pub fn purge_trash_item(id: String) -> Result<(), String> {
    explorer_filesystem::purge_trash_item(&id)
}

#[tauri::command]
pub fn empty_trash() -> Result<(), String> {
    explorer_filesystem::empty_trash()
}
```

(Read the current top of `commands.rs` first to see the exact existing
`use explorer_filesystem::{...}` line before editing it — add `TrashedItem` to whatever's already
imported there, don't replace the whole line blindly.)

- [ ] **Step 2: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `invoke_handler!` list's `commands::delete_entry,`
line and add the four new commands right after it:

```rust
            commands::delete_entry,
            commands::list_trash_items,
            commands::restore_trash_item,
            commands::purge_trash_item,
            commands::empty_trash,
```

- [ ] **Step 3: Confirm the whole workspace still builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for the Recycle Bin"
```

---

### Task 3: `useConfirmStore`

**Files:**
- Create: `apps/desktop/src/stores/useConfirmStore.ts`
- Create: `apps/desktop/src/stores/useConfirmStore.test.ts`

This is genuine, testable pure store logic (a pending-request field plus a promise resolved by a
later action) — closer in shape to the stores that already have tests
(`usePluginStore.test.ts`/`useExplorerStore.test.ts`/`useSettingsStore.test.ts`) than to
`useToastStore` (a trivial timer side effect with no test file). Follow their pattern: real tests.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/stores/useConfirmStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { useConfirmStore } from "./useConfirmStore";

describe("useConfirmStore", () => {
  it("sets the message when a confirmation is requested", () => {
    void useConfirmStore.getState().requestConfirm("Delete this?");

    expect(useConfirmStore.getState().message).toBe("Delete this?");
  });

  it("resolves the returned promise to true and clears the message on confirm", async () => {
    const promise = useConfirmStore.getState().requestConfirm("Delete this?");

    useConfirmStore.getState().resolve(true);

    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().message).toBeNull();
  });

  it("resolves the returned promise to false and clears the message on cancel", async () => {
    const promise = useConfirmStore.getState().requestConfirm("Delete this?");

    useConfirmStore.getState().resolve(false);

    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().message).toBeNull();
  });

  it("auto-cancels a still-pending request when a new one is made", async () => {
    const first = useConfirmStore.getState().requestConfirm("First?");
    const second = useConfirmStore.getState().requestConfirm("Second?");

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().message).toBe("Second?");

    useConfirmStore.getState().resolve(true);
    await expect(second).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run useConfirmStore`
Expected: FAIL — `./useConfirmStore` doesn't exist yet.

- [ ] **Step 3: Implement the store**

Create `apps/desktop/src/stores/useConfirmStore.ts`:

```ts
import { create } from "zustand";

interface ConfirmState {
  /** The message currently awaiting a yes/no answer, or `null` if nothing is pending. Only one
   * confirmation can be pending at a time -- see `requestConfirm`. */
  message: string | null;
  /** Shows a confirmation with `message` and resolves to whether the user confirmed. If another
   * request is already pending when this is called, that earlier request is immediately
   * resolved to `false` (auto-cancelled) rather than left to hang forever, since the UI can only
   * ever show one confirmation at a time. */
  requestConfirm: (message: string) => Promise<boolean>;
  /** Resolves the currently pending request (if any) and clears `message`. Called by
   * `ConfirmDialogHost`'s Confirm/Cancel buttons, not meant to be called directly by plugin
   * code. */
  resolve: (result: boolean) => void;
}

let pendingResolve: ((result: boolean) => void) | null = null;

export const useConfirmStore = create<ConfirmState>((set) => ({
  message: null,

  requestConfirm: (message) => {
    pendingResolve?.(false);
    return new Promise<boolean>((resolvePromise) => {
      pendingResolve = resolvePromise;
      set({ message });
    });
  },

  resolve: (result) => {
    set({ message: null });
    pendingResolve?.(result);
    pendingResolve = null;
  },
}));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run useConfirmStore`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/stores/useConfirmStore.ts apps/desktop/src/stores/useConfirmStore.test.ts
git commit -m "Add useConfirmStore for plugin-facing confirmation dialogs"
```

---

### Task 4: `ConfirmDialogHost` and mounting it

**Files:**
- Create: `apps/desktop/src/components/ConfirmDialogHost.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Create `ConfirmDialogHost.tsx`**

Create `apps/desktop/src/components/ConfirmDialogHost.tsx`:

```tsx
import { useConfirmStore } from "../stores/useConfirmStore";
import ConfirmDialog from "./ConfirmDialog";

// A wrapper so ConfirmDialog only mounts while a confirmation is actually pending -- matches
// ConflictDialog's identical reasoning (see ConflictDialog.tsx): this makes useFocusTrap's mount
// effect (auto-focus, restore focus on unmount) fire fresh on every open, not just once ever,
// which is what happens if this logic lives here directly and merely renders `null` while closed.
function ConfirmDialogHost() {
  const message = useConfirmStore((state) => state.message);
  const resolve = useConfirmStore((state) => state.resolve);

  if (message === null) return null;

  return (
    <ConfirmDialog message={message} onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />
  );
}

export default ConfirmDialogHost;
```

- [ ] **Step 2: Mount it in `App.tsx`**

In `apps/desktop/src/App.tsx`, add the import:

```ts
import ConfirmDialogHost from "./components/ConfirmDialogHost";
```

alongside the other component imports (near `import ConflictDialog from "./components/ConflictDialog";`).
Then add `<ConfirmDialogHost />` to the render tree, right after `<ConflictDialog />`:

```tsx
      <StatusBar />
      <ConflictDialog />
      <ConfirmDialogHost />
      <TransferProgress />
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/ConfirmDialogHost.tsx apps/desktop/src/App.tsx
git commit -m "Mount ConfirmDialogHost so plugins can request confirmation dialogs"
```

---

### Task 5: Plugin API types and permission wiring

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add `TrashedItem` and the new `PluginApi` methods to `types/plugin.ts`**

In `apps/desktop/src/types/plugin.ts`, add near the other data-shape interfaces (e.g. right after
`MultiHash`):

```ts
export interface TrashedItem {
  id: string;
  name: string;
  originalParent: string;
  /** Unix epoch seconds. */
  timeDeleted: number;
  /** `null` if the size couldn't be determined for this item. */
  sizeBytes: number | null;
}
```

Then add to `PluginApi`, right after `openElevatedTerminal`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add `TrashedItem` to the type-only import from `../types/plugin`.
2. Add to the `handlers()` mock, right after `openElevatedTerminal`:

```ts
    confirm: vi.fn().mockResolvedValue(true),
    listTrashItems: vi.fn().mockResolvedValue([]),
    restoreTrashItem: vi.fn().mockResolvedValue(undefined),
    purgeTrashItem: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
```

3. Add `"ui.confirm"` and `"fs.trash"` to `ALL_PERMISSIONS`.
4. Add to `ALL_METHODS`, right after `"openElevatedTerminal"`:

```ts
    "confirm",
    "listTrashItems",
    "restoreTrashItem",
    "purgeTrashItem",
    "emptyTrash",
```

5. Add two new rows to the `it.each` table, right after the `ui.terminal` row:

```ts
    ["ui.confirm", ["confirm"]],
    ["fs.trash", ["listTrashItems", "restoreTrashItem", "purgeTrashItem", "emptyTrash"]],
```

6. Add two dedicated forwarding tests, after the existing `openElevatedTerminal calls the handler
   with no arguments` test:

```ts
  it("confirm calls the handler with the message", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.confirm"]), h);

    await api.confirm?.("Are you sure?");

    expect(h.confirm).toHaveBeenCalledWith("Are you sure?");
  });

  it("purgeTrashItem calls the handler with the id", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.trash"]), h);

    await api.purgeTrashItem?.("some-id");

    expect(h.purgeTrashItem).toHaveBeenCalledWith("some-id");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL — `confirm`/`listTrashItems`/etc. don't exist on `PluginApiHandlers` yet.

- [ ] **Step 4: Wire `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`:

1. Add `TrashedItem` to the type-only import from `../types/plugin`.
2. Add to `PluginApiHandlers`, right after `openElevatedTerminal: () => Promise<void>;`:

```ts
  confirm: (message: string) => Promise<boolean>;
  listTrashItems: () => Promise<TrashedItem[]>;
  restoreTrashItem: (id: string) => Promise<void>;
  purgeTrashItem: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
```

3. Add to `createPluginApi`, right after the `ui.terminal` block:

```ts
  if (has("ui.confirm")) {
    api.confirm = (message) => handlers.confirm(message);
  }
  if (has("fs.trash")) {
    api.listTrashItems = () => handlers.listTrashItems();
    api.restoreTrashItem = (id) => handlers.restoreTrashItem(id);
    api.purgeTrashItem = (id) => handlers.purgeTrashItem(id);
    api.emptyTrash = () => handlers.emptyTrash();
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: PASS.

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/types/plugin.ts apps/desktop/src/plugins/pluginApi.ts apps/desktop/src/plugins/pluginApi.test.ts
git commit -m "Add ui.confirm and fs.trash to the plugin permission system"
```

---

### Task 6: Real handler wiring in `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Read the current file to find the exact handler-object location**

Read `apps/desktop/src/stores/usePluginStore.ts` and find the handler object (the one that ends
with `openElevatedTerminal: () => invoke<void>("open_elevated_terminal_window", { cwd:
getCurrentFolderPath() }),`) and the top-of-file imports.

- [ ] **Step 2: Add imports**

Add to the imports at the top of `apps/desktop/src/stores/usePluginStore.ts`:

```ts
import { useConfirmStore } from "./useConfirmStore";
```

and add `TrashedItem` to whatever's already being imported as types from `../types/plugin`.

- [ ] **Step 3: Add the real handlers**

Right after the existing `openElevatedTerminal: () => invoke<void>("open_elevated_terminal_window",
{ cwd: getCurrentFolderPath() }),` line, add:

```ts
          confirm: (message) => useConfirmStore.getState().requestConfirm(message),
          listTrashItems: () => invoke<TrashedItem[]>("list_trash_items"),
          restoreTrashItem: (id) => invoke<void>("restore_trash_item", { id }),
          purgeTrashItem: (id) => invoke<void>("purge_trash_item", { id }),
          emptyTrash: () => invoke<void>("empty_trash"),
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire real confirm and Recycle Bin handlers into usePluginStore"
```

---

### Task 7: Docs, marketplace listing, and the example plugin

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`
- Create: `examples/plugins/recycling-bin/manifest.json`
- Create: `examples/plugins/recycling-bin/frontend/index.js`
- Create: `examples/plugins/recycling-bin/README.md`

- [ ] **Step 1: Document the two new permissions in `docs/plugins.md`**

Add two rows to the permissions table (find the `| Permission | Grants |` table and add these
rows, in the same position they'd sort alphabetically-ish among the existing `fs.*`/`ui.*` rows
— exact placement doesn't matter, just add them somewhere in the table):

```md
| `fs.trash` | `api.listTrashItems()`, `api.restoreTrashItem(id)`, `api.purgeTrashItem(id)`, `api.emptyTrash()` |
| `ui.confirm` | `api.confirm(message)` |
```

Then add two new `###`-level sections documenting the methods, following the existing sections'
style (see the `### ui.terminal methods` section for the pattern). Add `### fs.trash methods`:

```md
### `fs.trash` methods

- `listTrashItems(): Promise<TrashedItem[]>` — lists everything currently in the OS Recycle Bin.
  Each item has `id` (an opaque identifier, not a path — pass it back verbatim to
  `restoreTrashItem`/`purgeTrashItem`), `name`, `originalParent`, `timeDeleted` (Unix epoch
  seconds), and `sizeBytes` (`null` if it couldn't be determined).
- `restoreTrashItem(id: string): Promise<void>` — restores one item to its original location.
- `purgeTrashItem(id: string): Promise<void>` — permanently deletes one item from the Recycle
  Bin. Irreversible.
- `emptyTrash(): Promise<void>` — permanently deletes everything currently in the Recycle Bin.
  Irreversible.
```

And `### ui.confirm methods`:

```md
### `ui.confirm` methods

- `confirm(message: string): Promise<boolean>` — shows the app's own confirmation dialog
  (the same one used throughout the core app, e.g. for regular delete-to-Recycle-Bin) with
  `message` and Confirm/Cancel buttons; resolves to whether the user confirmed. Only one
  confirmation can be shown at a time — a second call while one is already pending immediately
  resolves the earlier one to `false`.
```

- [ ] **Step 2: Add to `marketplace.json`**

In `marketplace.json` (repo root), add an entry (matching the existing entries' format) for the
new plugin:

```json
  {
    "id": "recycling-bin",
    "name": "Recycling Bin",
    "description": "Browse, restore, permanently delete, or empty the Windows Recycle Bin."
  }
```

(Read the current file first to see exactly where the array's entries are and add this as one
more element, keeping valid JSON — don't guess at comma placement blindly.)

- [ ] **Step 3: Create the plugin manifest**

Create `examples/plugins/recycling-bin/manifest.json`:

```json
{
  "id": "recycling-bin",
  "name": "Recycling Bin",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "fs.trash", "ui.confirm"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 4: Create the plugin entry file**

Create `examples/plugins/recycling-bin/frontend/index.js`:

```js
// Entry point for the "Recycling Bin" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listTrashItems/restoreTrashItem/purgeTrashItem/
// emptyTrash: "fs.trash", confirm: "ui.confirm").

function formatSize(bytes) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDeleted(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleString();
}

api.registerSidebarPanel({
  id: "recycling-bin",
  title: "Recycling Bin",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "6px";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.padding = "5px 10px";
    refreshBtn.style.fontSize = "12px";
    refreshBtn.style.cursor = "pointer";

    const emptyBtn = document.createElement("button");
    emptyBtn.textContent = "Empty Recycle Bin";
    emptyBtn.style.padding = "5px 10px";
    emptyBtn.style.fontSize = "12px";
    emptyBtn.style.cursor = "pointer";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    list.style.maxHeight = "400px";
    list.style.overflowY = "auto";

    let items = [];

    function render() {
      list.innerHTML = "";
      emptyBtn.disabled = items.length === 0;
      if (items.length === 0) {
        setStatus("Recycle Bin is empty.", false);
        return;
      }
      setStatus(`${items.length} item${items.length === 1 ? "" : "s"} in the Recycle Bin`, false);

      for (const item of items) {
        const row = document.createElement("div");
        row.style.border = "1px solid var(--border)";
        row.style.borderRadius = "4px";
        row.style.padding = "6px 8px";
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";

        const nameLine = document.createElement("div");
        nameLine.style.fontWeight = "600";
        nameLine.textContent = item.name;

        const metaLine = document.createElement("div");
        metaLine.style.color = "var(--fg-muted)";
        metaLine.style.fontSize = "11px";
        metaLine.style.wordBreak = "break-all";
        const sizePart = item.sizeBytes === null ? "" : ` — ${formatSize(item.sizeBytes)}`;
        metaLine.textContent = `${item.originalParent}${sizePart} — deleted ${formatDeleted(item.timeDeleted)}`;

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "6px";

        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "Restore";
        restoreBtn.style.fontSize = "11px";
        restoreBtn.style.padding = "3px 8px";
        restoreBtn.style.cursor = "pointer";
        restoreBtn.addEventListener("click", async () => {
          try {
            await api.restoreTrashItem(item.id);
            await refresh();
          } catch (error) {
            setStatus(String(error), true);
          }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete Forever";
        deleteBtn.style.fontSize = "11px";
        deleteBtn.style.padding = "3px 8px";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.addEventListener("click", async () => {
          const ok = await api.confirm(`Permanently delete '${item.name}'? This cannot be undone.`);
          if (!ok) return;
          try {
            await api.purgeTrashItem(item.id);
            await refresh();
          } catch (error) {
            setStatus(String(error), true);
          }
        });

        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(nameLine);
        row.appendChild(metaLine);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }

    async function refresh() {
      try {
        items = await api.listTrashItems();
        render();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    refreshBtn.addEventListener("click", () => void refresh());

    emptyBtn.addEventListener("click", async () => {
      const ok = await api.confirm(
        `Permanently delete all ${items.length} item${items.length === 1 ? "" : "s"} in the Recycle Bin? This cannot be undone.`,
      );
      if (!ok) return;
      try {
        await api.emptyTrash();
        await refresh();
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(emptyBtn);

    container.appendChild(toolbar);
    container.appendChild(status);
    container.appendChild(list);

    void refresh();
  },
});
```

- [ ] **Step 5: Create the README**

Create `examples/plugins/recycling-bin/README.md`:

```md
# Recycling Bin

Sidebar panel listing everything currently in the Windows Recycle Bin, with per-item Restore and
Delete Forever buttons, and an Empty Recycle Bin button. Delete Forever and Empty Recycle Bin both
show a confirmation dialog first — both are irreversible.

## Permissions

- `ui.sidebar` — registers the panel.
- `fs.trash` — lists, restores, and permanently deletes Recycle Bin items.
- `ui.confirm` — shows the app's own confirmation dialog before an irreversible action.
```

- [ ] **Step 6: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass. (The new plugin's `frontend/index.js` isn't covered by
this — it's runtime-loaded example plugin code, no build step, matching every other example
plugin's lack of automated coverage.)

- [ ] **Step 7: Commit**

```bash
git add docs/plugins.md marketplace.json examples/plugins/recycling-bin/
git commit -m "Add the Recycling Bin example plugin"
```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes, clippy is clean, all tests pass (no new Rust tests were
added in this plan — Task 1 explicitly has none — but confirm nothing else broke).

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 3: Manual verification (cannot be automated)**

This whole feature is UI + real-OS-Recycle-Bin interaction, with no automated coverage for the
trash-touching Rust functions or the plugin's own JS. Verify by hand against the running dev
build:

1. Install/sync the Recycling Bin plugin (via the marketplace, or copy
   `examples/plugins/recycling-bin/` into your local plugins directory and use the "Local
   Plugins (dev)" sync tool in Settings if iterating locally).
2. Delete a throwaway test file via the core app's own regular delete (so it lands in the real
   Recycle Bin), then open the Recycling Bin plugin panel and confirm it appears in the list with
   a plausible name, original location, size, and deletion time.
3. Click **Restore** on that item; confirm it disappears from the Recycling Bin panel's list and
   reappears at its original location in the file explorer.
4. Delete another throwaway test file, open the Recycling Bin panel, click **Delete Forever** on
   it; confirm a confirmation dialog appears (visually identical to the core app's regular delete
   confirmation), and that clicking Cancel leaves the item in the list untouched. Click Delete
   Forever again and confirm this time — the item should disappear from the list and not be
   recoverable (check the real Windows Recycle Bin via File Explorer to confirm it's actually
   gone, not just hidden from this plugin's view).
5. With at least one item in the bin, click **Empty Recycle Bin**; confirm the same confirmation
   pattern (message mentions the item count), Cancel leaves everything intact, and confirming
   empties the list and the real Windows Recycle Bin.
6. Confirm the **Refresh** button re-fetches the list (e.g. delete a file from a different app —
   like Windows Explorer itself — while the plugin panel is open, then click Refresh and confirm
   it shows up without needing to close/reopen the panel).

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past.
