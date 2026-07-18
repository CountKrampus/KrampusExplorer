# Clear Unnecessary Files Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clear Unnecessary Files plugin that finds and clears well-known, user-writable
junk locations (temp folder, browser caches, thumbnail cache, dev tool caches), sending
everything to the Recycle Bin behind a confirmation dialog.

**Architecture:** Two new generic backend primitives (`get_known_folder` to resolve fixed system
locations, `delete_entries` to bulk-send multiple paths to the Recycle Bin in one IPC call) behind
two plugin permissions (`system.paths`, extended `fs.trash`). All category-specific knowledge
(which paths make up "Chrome Cache", etc.) lives entirely in the new example plugin's JS, matching
this codebase's existing plugin architecture.

**Tech Stack:** Rust (`dirs` and `trash` crates, both already dependencies), React, TypeScript.

Full design: `docs/superpowers/specs/2026-07-18-clear-unnecessary-files-plugin-design.md`.

---

### Task 1: Backend — `get_known_folder`

**Files:**
- Create: `crates/filesystem/src/known_folders.rs`
- Modify: `crates/filesystem/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/filesystem/src/known_folders.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownFolder {
    Temp,
    LocalAppData,
    RoamingAppData,
    Home,
}

impl KnownFolder {
    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "temp" => Ok(KnownFolder::Temp),
            "local_app_data" => Ok(KnownFolder::LocalAppData),
            "roaming_app_data" => Ok(KnownFolder::RoamingAppData),
            "home" => Ok(KnownFolder::Home),
            other => Err(format!(
                "Unknown folder identifier '{other}' -- expected one of: temp, local_app_data, roaming_app_data, home"
            )),
        }
    }
}

/// Resolves one of a small fixed set of known system locations. This is the actual security
/// boundary for `get_known_folder`: a plugin can only ever ask for one of the four `KnownFolder`
/// variants (enforced by `KnownFolder::parse` rejecting anything else), never an arbitrary
/// environment variable name -- so this can't be used to read something sensitive like an
/// API-key env var. Returns `None` (rather than an error) when a folder can't be resolved on
/// this system, so callers can treat "unavailable" as a normal, non-fatal outcome.
pub fn get_known_folder(folder: KnownFolder) -> Option<String> {
    match folder {
        KnownFolder::Temp => Some(std::env::temp_dir().to_string_lossy().to_string()),
        KnownFolder::LocalAppData => dirs::data_local_dir().map(|p| p.to_string_lossy().to_string()),
        KnownFolder::RoamingAppData => dirs::data_dir().map(|p| p.to_string_lossy().to_string()),
        KnownFolder::Home => dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_all_four_known_identifiers() {
        assert_eq!(KnownFolder::parse("temp"), Ok(KnownFolder::Temp));
        assert_eq!(KnownFolder::parse("local_app_data"), Ok(KnownFolder::LocalAppData));
        assert_eq!(KnownFolder::parse("roaming_app_data"), Ok(KnownFolder::RoamingAppData));
        assert_eq!(KnownFolder::parse("home"), Ok(KnownFolder::Home));
    }

    #[test]
    fn parse_rejects_an_arbitrary_env_var_name() {
        assert!(KnownFolder::parse("PATH").is_err());
        assert!(KnownFolder::parse("SOME_API_KEY").is_err());
    }

    #[test]
    fn temp_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::Temp);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn home_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::Home);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn local_app_data_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::LocalAppData);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn roaming_app_data_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::RoamingAppData);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Run the tests to verify they pass**

This module's logic is simple enough to write correctly first try (it's a direct translation of
the design doc's pseudocode), but still follow the verify step:

Run: `cargo test -p explorer-filesystem known_folders`
Expected: PASS, 6 tests.

- [ ] **Step 3: Re-export from `lib.rs`**

In `crates/filesystem/src/lib.rs`, change:

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
pub use trash_bin::{
    empty_trash, list_trash_items, purge_trash_item, restore_trash_item, TrashedItem,
};
```

to:

```rust
mod drives;
mod home;
mod known_folders;
mod listing;
mod operations;
mod trash_bin;

pub use drives::{list_drives, DriveInfo};
pub use home::default_start_path;
pub use known_folders::{get_known_folder, KnownFolder};
pub use listing::{list_directory, DirectoryListing, EntryInfo};
pub use operations::{
    copy_entry, copy_entry_reporting, create_file, create_folder, delete_entry, move_entry,
    move_entry_reporting, rename_entry,
};
pub use trash_bin::{
    empty_trash, list_trash_items, purge_trash_item, restore_trash_item, TrashedItem,
};
```

- [ ] **Step 4: Confirm the whole crate builds and tests pass**

Run: `cargo test -p explorer-filesystem`
Expected: builds successfully, all tests pass (including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add crates/filesystem/src/known_folders.rs crates/filesystem/src/lib.rs
git commit -m "Add get_known_folder for resolving fixed system locations"
```

---

### Task 2: Backend — `delete_entries`

**Files:**
- Modify: `crates/filesystem/src/trash_bin.rs`
- Modify: `crates/filesystem/src/lib.rs`

No automated tests for this one -- it moves real files into the real Windows Recycle Bin, same
precedent as `delete_entry`, `purge_trash_item`, and `empty_trash` (see the design doc's Testing
section). Verification is manual, in Task 8.

- [ ] **Step 1: Add `delete_entries` to `trash_bin.rs`**

In `crates/filesystem/src/trash_bin.rs`, add this function after `empty_trash`:

```rust
/// Sends every path in `paths` to the Recycle Bin in a single call, rather than one round-trip
/// per file -- important since a temp folder or browser cache can hold thousands of entries, and
/// per-file IPC calls would be both slow and (for a very large folder) a large-message-count
/// risk similar to the search/scan issues fixed earlier (see `SEARCH_RESULT_CAP`/`SCAN_FILE_CAP`
/// in `crates/search`/`crates/plugins`). A directory path in `paths` is moved to the Recycle Bin
/// as a whole (its contents don't need to be enumerated by the caller first).
pub fn delete_entries(paths: &[String]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Could not delete entries: {e}"))
}
```

- [ ] **Step 2: Confirm it compiles**

Run: `cargo build -p explorer-filesystem`
Expected: builds successfully. `delete_entries` doesn't need adding to `trash_bin.rs`'s imports --
`trash::delete_all` is called via its full path, matching how `trash::os_limited::*` functions are
imported individually at the top of the file for the *other* trash functions, but a one-off call
like this can just use the fully-qualified path without adding a new `use`.

- [ ] **Step 3: Re-export from `lib.rs`**

In `crates/filesystem/src/lib.rs`, change:

```rust
pub use trash_bin::{
    empty_trash, list_trash_items, purge_trash_item, restore_trash_item, TrashedItem,
};
```

to:

```rust
pub use trash_bin::{
    delete_entries, empty_trash, list_trash_items, purge_trash_item, restore_trash_item,
    TrashedItem,
};
```

- [ ] **Step 4: Confirm the whole crate builds**

Run: `cargo build -p explorer-filesystem`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add crates/filesystem/src/trash_bin.rs crates/filesystem/src/lib.rs
git commit -m "Add delete_entries for bulk-sending paths to the Recycle Bin"
```

---

### Task 3: Wire the two new Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `apps/desktop/src-tauri/src/commands.rs`, change the top `use explorer_filesystem::{...}` line
from:

```rust
use explorer_filesystem::{list_directory, list_drives, DirectoryListing, DriveInfo, TrashedItem};
```

to:

```rust
use explorer_filesystem::{
    list_directory, list_drives, DirectoryListing, DriveInfo, KnownFolder, TrashedItem,
};
```

Then add, right after the existing `empty_trash` command:

```rust
#[tauri::command]
pub fn empty_trash() -> Result<(), String> {
    explorer_filesystem::empty_trash()
}

#[tauri::command]
pub fn get_known_folder(folder: String) -> Result<Option<String>, String> {
    let known = KnownFolder::parse(&folder)?;
    Ok(explorer_filesystem::get_known_folder(known))
}

#[tauri::command]
pub fn delete_entries(paths: Vec<String>) -> Result<(), String> {
    explorer_filesystem::delete_entries(&paths)
}
```

- [ ] **Step 2: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `invoke_handler!` list's `commands::empty_trash,`
line and add the two new commands right after it:

```rust
            commands::empty_trash,
            commands::get_known_folder,
            commands::delete_entries,
```

- [ ] **Step 3: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for known-folder resolution and bulk delete"
```

---

### Task 4: Plugin API — `system.paths` and extended `fs.trash`

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add the new `PluginApi` methods to `types/plugin.ts`**

In `apps/desktop/src/types/plugin.ts`, add to `PluginApi`, right after `emptyTrash`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add to the `handlers()` mock, right after `emptyTrash`:

```ts
    emptyTrash: vi.fn().mockResolvedValue(undefined),
    deleteEntries: vi.fn().mockResolvedValue(undefined),
    getKnownFolder: vi.fn().mockResolvedValue("C:\\Users\\boo\\AppData\\Local\\Temp"),
```

2. Add `"system.paths"` to `ALL_PERMISSIONS` (`fs.trash` is already there from the Recycling Bin
   plugin, so it doesn't need re-adding -- only the new permission does):

```ts
    "ui.confirm",
    "fs.trash",
    "system.paths",
  ];
```

3. Add to `ALL_METHODS`, right after `emptyTrash`:

```ts
    "emptyTrash",
    "deleteEntries",
    "getKnownFolder",
  ] as const;
```

4. Update the `fs.trash` row in the `it.each` table to include `deleteEntries`, and add a new
   `system.paths` row:

```ts
    ["fs.trash", ["listTrashItems", "restoreTrashItem", "purgeTrashItem", "emptyTrash", "deleteEntries"]],
    ["system.paths", ["getKnownFolder"]],
```

5. Add two dedicated forwarding tests, after the existing `purgeTrashItem calls the handler with
   the id` test:

```ts
  it("deleteEntries calls the handler with the paths", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.trash"]), h);

    await api.deleteEntries?.(["C:\\a.txt", "C:\\b.txt"]);

    expect(h.deleteEntries).toHaveBeenCalledWith(["C:\\a.txt", "C:\\b.txt"]);
  });

  it("getKnownFolder calls the handler with the folder name", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.paths"]), h);

    await api.getKnownFolder?.("temp");

    expect(h.getKnownFolder).toHaveBeenCalledWith("temp");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL -- `deleteEntries`/`getKnownFolder` don't exist on `PluginApiHandlers` yet.

- [ ] **Step 4: Wire `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`, add to `PluginApiHandlers`, right after `emptyTrash`:

```ts
  emptyTrash: () => Promise<void>;
  deleteEntries: (paths: string[]) => Promise<void>;
  getKnownFolder: (folder: string) => Promise<string | null>;
```

Then change the existing `fs.trash` block and add a new `system.paths` block, right after it:

```ts
  if (has("fs.trash")) {
    api.listTrashItems = () => handlers.listTrashItems();
    api.restoreTrashItem = (id) => handlers.restoreTrashItem(id);
    api.purgeTrashItem = (id) => handlers.purgeTrashItem(id);
    api.emptyTrash = () => handlers.emptyTrash();
    api.deleteEntries = (paths) => handlers.deleteEntries(paths);
  }
  if (has("system.paths")) {
    api.getKnownFolder = (folder) => handlers.getKnownFolder(folder);
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
git commit -m "Add system.paths permission and extend fs.trash with deleteEntries"
```

---

### Task 5: Real handler wiring in `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Add the real handlers**

In `apps/desktop/src/stores/usePluginStore.ts`, find the line `emptyTrash: () =>
invoke<void>("empty_trash"),` and add right after it:

```ts
          emptyTrash: () => invoke<void>("empty_trash"),
          deleteEntries: (paths) => invoke<void>("delete_entries", { paths }),
          getKnownFolder: (folder) => invoke<string | null>("get_known_folder", { folder }),
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire real deleteEntries and getKnownFolder handlers into usePluginStore"
```

---

### Task 6: The `examples/plugins/clear-unnecessary-files/` plugin

**Files:**
- Create: `examples/plugins/clear-unnecessary-files/manifest.json`
- Create: `examples/plugins/clear-unnecessary-files/frontend/index.js`
- Create: `examples/plugins/clear-unnecessary-files/README.md`

- [ ] **Step 1: Create the manifest**

Create `examples/plugins/clear-unnecessary-files/manifest.json`:

```json
{
  "id": "clear-unnecessary-files",
  "name": "Clear Unnecessary Files",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "system.paths", "fs.list", "fs.trash", "ui.confirm"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 2: Create the entry file**

Create `examples/plugins/clear-unnecessary-files/frontend/index.js`:

```js
// Entry point for the "Clear Unnecessary Files" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getKnownFolder: "system.paths", listDirectory:
// "fs.list", deleteEntries: "fs.trash", confirm: "ui.confirm").

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Each category resolves its base path from one of the four fixed `getKnownFolder` identifiers
// plus a hardcoded suffix -- the backend stays generic (it has no idea what "Chrome Cache" is),
// all category-specific knowledge lives here, matching how duplicate-finder/disk-usage-visualizer
// keep their domain logic in JS against generic scanDirectory/hashFiles primitives.
const CATEGORIES = [
  {
    id: "temp",
    group: "System",
    name: "Temp Files",
    description: "Scratch files apps leave behind in your temp folder.",
    base: "temp",
    suffix: "",
  },
  {
    id: "chrome-cache",
    group: "Browsers",
    name: "Chrome Cache",
    description: "Google Chrome's browser cache.",
    base: "local_app_data",
    suffix: "\\Google\\Chrome\\User Data\\Default\\Cache",
  },
  {
    id: "edge-cache",
    group: "Browsers",
    name: "Edge Cache",
    description: "Microsoft Edge's browser cache.",
    base: "local_app_data",
    suffix: "\\Microsoft\\Edge\\User Data\\Default\\Cache",
  },
  {
    id: "thumbnail-cache",
    group: "System",
    name: "Explorer Thumbnail Cache",
    description: "Cached thumbnail images; Windows regenerates these as needed.",
    base: "local_app_data",
    suffix: "\\Microsoft\\Windows\\Explorer",
    filter: (name) => /^thumbcache_.*\.db$/i.test(name),
  },
  {
    id: "npm-cache",
    group: "Developer Tools",
    name: "npm Cache",
    description: "Re-downloadable npm package cache.",
    base: "roaming_app_data",
    suffix: "\\npm-cache",
  },
  {
    id: "yarn-cache",
    group: "Developer Tools",
    name: "Yarn Cache",
    description: "Re-downloadable Yarn package cache.",
    base: "local_app_data",
    suffix: "\\Yarn\\Cache",
  },
  {
    id: "pip-cache",
    group: "Developer Tools",
    name: "pip Cache",
    description: "Re-downloadable Python package cache.",
    base: "local_app_data",
    suffix: "\\pip\\Cache",
  },
  {
    id: "cargo-cache",
    group: "Developer Tools",
    name: "Cargo Registry Cache",
    description: "Re-downloadable Rust crate registry cache.",
    base: "home",
    suffix: "\\.cargo\\registry\\cache",
  },
];

api.registerSidebarPanel({
  id: "clear-unnecessary-files",
  title: "Clear Unnecessary Files",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const scanBtn = document.createElement("button");
    scanBtn.textContent = "Scan";
    scanBtn.style.padding = "5px 10px";
    scanBtn.style.fontSize = "12px";
    scanBtn.style.cursor = "pointer";

    const cleanBtn = document.createElement("button");
    cleanBtn.textContent = "Clean Selected";
    cleanBtn.style.padding = "5px 10px";
    cleanBtn.style.fontSize = "12px";
    cleanBtn.style.cursor = "pointer";
    cleanBtn.disabled = true;

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "6px";
    toolbar.appendChild(scanBtn);
    toolbar.appendChild(cleanBtn);

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
    list.style.gap = "10px";

    // Per-category scan results: { paths: string[], totalSize: number } | "not-found" | null
    // (null = not scanned yet).
    const results = new Map();
    const checkboxes = new Map();

    function updateCleanButton() {
      const anySelected = CATEGORIES.some((category) => {
        const result = results.get(category.id);
        return (
          checkboxes.get(category.id)?.checked &&
          result &&
          result !== "not-found" &&
          result.paths.length > 0
        );
      });
      cleanBtn.disabled = !anySelected;
    }

    function render() {
      list.innerHTML = "";
      checkboxes.clear();

      const groups = [...new Set(CATEGORIES.map((category) => category.group))];
      for (const group of groups) {
        const heading = document.createElement("div");
        heading.textContent = group;
        heading.style.fontWeight = "600";
        heading.style.marginTop = "4px";
        list.appendChild(heading);

        for (const category of CATEGORIES.filter((c) => c.group === group)) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.alignItems = "flex-start";
          row.style.gap = "6px";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.style.marginTop = "3px";
          const result = results.get(category.id);
          checkbox.disabled = !result || result === "not-found" || result.paths.length === 0;
          checkbox.addEventListener("change", updateCleanButton);
          checkboxes.set(category.id, checkbox);

          const label = document.createElement("div");
          const nameLine = document.createElement("div");
          nameLine.textContent = category.name;
          const descLine = document.createElement("div");
          descLine.style.color = "var(--fg-muted)";
          descLine.style.fontSize = "11px";
          descLine.textContent = category.description;
          const sizeLine = document.createElement("div");
          sizeLine.style.color = "var(--fg-muted)";
          sizeLine.style.fontSize = "11px";
          if (result === undefined) {
            sizeLine.textContent = "Not scanned";
          } else if (result === "not-found") {
            sizeLine.textContent = "Not found";
          } else {
            sizeLine.textContent = `${result.paths.length} item${result.paths.length === 1 ? "" : "s"} — ${formatSize(result.totalSize)}`;
          }

          label.appendChild(nameLine);
          label.appendChild(descLine);
          label.appendChild(sizeLine);

          row.appendChild(checkbox);
          row.appendChild(label);
          list.appendChild(row);
        }
      }

      updateCleanButton();
    }

    async function scanCategory(category) {
      const base = await api.getKnownFolder(category.base);
      if (!base) return "not-found";

      const path = base + category.suffix;
      let entries;
      try {
        entries = await api.listDirectory(path);
      } catch {
        return "not-found";
      }

      const matched = category.filter ? entries.filter((entry) => category.filter(entry.name)) : entries;
      return {
        paths: matched.map((entry) => entry.path),
        totalSize: matched.reduce((sum, entry) => sum + entry.size, 0),
      };
    }

    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      cleanBtn.disabled = true;
      setStatus("Scanning…", false);
      try {
        for (const category of CATEGORIES) {
          results.set(category.id, await scanCategory(category));
          render();
        }
        setStatus("Scan complete.", false);
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        scanBtn.disabled = false;
      }
    });

    cleanBtn.addEventListener("click", async () => {
      const selected = CATEGORIES.filter((category) => checkboxes.get(category.id)?.checked);
      const allPaths = [];
      let totalSize = 0;
      for (const category of selected) {
        const result = results.get(category.id);
        if (!result || result === "not-found") continue;
        allPaths.push(...result.paths);
        totalSize += result.totalSize;
      }
      if (allPaths.length === 0) return;

      const ok = await api.confirm(
        `Move ${allPaths.length} item${allPaths.length === 1 ? "" : "s"} (~${formatSize(totalSize)}) across ${selected.length} categor${selected.length === 1 ? "y" : "ies"} to the Recycle Bin?`,
      );
      if (!ok) return;

      cleanBtn.disabled = true;
      setStatus("Cleaning…", false);
      try {
        await api.deleteEntries(allPaths);
        setStatus("Done. Re-scanning…", false);
        for (const category of CATEGORIES) {
          results.set(category.id, await scanCategory(category));
          render();
        }
        setStatus("Scan complete.", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    render();

    container.appendChild(toolbar);
    container.appendChild(status);
    container.appendChild(list);
  },
});
```

- [ ] **Step 3: Create the README**

Create `examples/plugins/clear-unnecessary-files/README.md`:

```md
# Clear Unnecessary Files

Sidebar panel that scans well-known, user-writable junk locations (temp folder, browser caches,
Explorer thumbnail cache, dev tool caches) and lets you send selected categories to the Recycle
Bin. Every delete goes through a confirmation dialog and the Recycle Bin -- nothing is deleted
permanently by this plugin.

## Categories

- **Temp Files** — your temp folder's contents.
- **Chrome Cache** / **Edge Cache** — browser cache folders.
- **Explorer Thumbnail Cache** — cached thumbnail images (`thumbcache_*.db`).
- **npm Cache** / **Yarn Cache** / **pip Cache** / **Cargo Registry Cache** — re-downloadable
  package manager caches.

A category shows "Not found" if its location doesn't exist on this system (e.g. a dev tool that
was never installed).

## Permissions

- `ui.sidebar` — registers the panel.
- `system.paths` — resolves fixed system locations (temp, AppData, home).
- `fs.list` — lists each category folder's contents to compute size/item count.
- `fs.trash` — sends selected files to the Recycle Bin.
- `ui.confirm` — shows the app's own confirmation dialog before any delete.
```

- [ ] **Step 4: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass. (The new plugin's `frontend/index.js` isn't covered by
this -- it's runtime-loaded example plugin code, no build step, matching every other example
plugin's lack of automated coverage.)

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/clear-unnecessary-files/
git commit -m "Add the Clear Unnecessary Files example plugin"
```

---

### Task 7: Docs and marketplace listing

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`

- [ ] **Step 1: Document the new permission and extended permission in `docs/plugins.md`**

Add a new row to the permissions table, right after the `fs.trash` row (find `| \`fs.trash\` |
\`api.listTrashItems()\`, ... |` and update it, then add the new row after):

```md
| `fs.trash` | `api.listTrashItems()`, `api.restoreTrashItem(id)`, `api.purgeTrashItem(id)`, `api.emptyTrash()`, `api.deleteEntries(paths)` |
| `ui.confirm` | `api.confirm(message)` |
| `system.paths` | `api.getKnownFolder(folder)` |
```

(The `ui.confirm` row already exists between `fs.trash` and where `system.paths` is being added --
just insert the new `system.paths` row after it, and update the existing `fs.trash` row's cell to
include `api.deleteEntries(paths)`.)

Then update the `### \`fs.trash\` methods` section to add `deleteEntries`, right after the
existing `emptyTrash` bullet:

```md
- `emptyTrash(): Promise<void>` — permanently deletes everything currently in the Recycle Bin.
  Irreversible.
- `deleteEntries(paths: string[]): Promise<void>` — sends every path in `paths` to the Recycle
  Bin in one call. A directory path is moved as a whole; its contents don't need to be listed
  first.
```

Then add a new section after `### \`ui.confirm\` methods`:

```md
### `system.paths` methods

- `getKnownFolder(folder: "temp" | "local_app_data" | "roaming_app_data" | "home"): Promise<string | null>`
  — resolves one of a small fixed set of known system locations. Resolves to `null` (not an
  error) if that location can't be determined on this system. This is deliberately a closed set
  of identifiers, not a general environment-variable reader -- there's no way to use this to read
  something sensitive like an API-key env var.
```

- [ ] **Step 2: Add the new example plugin to the intro list**

In `docs/plugins.md`, find the line `- \`examples/plugins/recycling-bin/\` — browse/restore/purge
the OS Recycle Bin via \`fs.trash\`/\`ui.confirm\`` and add right after it:

```md
- `examples/plugins/clear-unnecessary-files/` — clears known junk locations via `system.paths`/`fs.trash`
```

- [ ] **Step 3: Add to `marketplace.json`**

In `marketplace.json` (repo root), add an entry after the `recycling-bin` entry:

```json
  {
    "id": "clear-unnecessary-files",
    "name": "Clear Unnecessary Files",
    "description": "Clears known junk locations (temp files, browser caches, dev tool caches)."
  }
```

- [ ] **Step 4: Validate the JSON and typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('marketplace.json'))" && node -e "JSON.parse(require('fs').readFileSync('examples/plugins/clear-unnecessary-files/manifest.json'))"`
Expected: no output (both parse successfully).

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md marketplace.json
git commit -m "Document system.paths/deleteEntries and list the new plugin in the marketplace"
```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes (or auto-fixes formatting -- if it changes anything,
commit that separately as `git commit -m "Run cargo fmt"`), clippy is clean, all tests pass
(including the 6 new `known_folders` tests).

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 3: Manual verification (cannot be automated)**

`delete_entries` and the plugin's own JS have no automated coverage (per the design doc's Testing
section), and this whole feature deletes real files from real system locations, so verify by hand
against the running dev build. **Be careful**: unlike the Recycling Bin plugin (which only touches
already-deleted items), this plugin deletes *live* files from real system caches -- prefer testing
against categories that are safe to lose (e.g. Temp Files, or a throwaway file you place in one of
the scanned folders yourself) rather than a category holding data you actually need.

1. Install/sync the Clear Unnecessary Files plugin (via the marketplace, or copy
   `examples/plugins/clear-unnecessary-files/` into your local plugins directory and use the
   "Local Plugins (dev)" sync tool in Settings if iterating locally).
2. Open the plugin panel and click **Scan**. Confirm every category shows either an item
   count + size, or "Not found" (for any dev tool cache that doesn't exist on this machine) --
   not stuck on "Not scanned" and not an error.
3. Check one category with a nonzero item count (Temp Files is a safe, always-populated choice).
   Confirm **Clean Selected** becomes enabled only once something with items is checked.
4. Click **Clean Selected**; confirm the dialog message correctly states the item count, total
   size, and category count for what's checked. Click Cancel; confirm nothing changed (re-scan
   shows the same counts as before).
5. Click **Clean Selected** again and confirm this time. Confirm the panel re-scans automatically
   afterward and the cleaned category's count drops (ideally to 0 items, though a live temp
   folder may immediately gain new scratch files from other running processes -- a lower count is
   still a valid pass).
6. Open the Recycling Bin plugin (from the earlier plan) and confirm the files that were just
   "cleaned" actually show up there, restorable -- proving they went to the Recycle Bin rather
   than being deleted permanently.

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past.
