# Phase 2: Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the application shell — frameless window with custom title bar, light/dark theme system, sidebar (real drives + static favorites), tabbed explorer with breadcrumbs and a Details-view file list backed by real filesystem data, a placeholder preview pane, and a status bar — with real drive listing, real directory listing, and real back/forward/up/refresh navigation wired through new `explorer-filesystem` Tauri commands.

**Architecture:** New Rust functions in `crates/filesystem` (list_drives, list_directory, default_start_path) are exposed as Tauri commands and called from the frontend via `@tauri-apps/api/core` `invoke()`. Two Zustand stores hold UI state: `useExplorerStore` (tabs, per-tab navigation history, entries, loading/error) acts as the in-app "router" with no router library; `useThemeStore` holds theme/accent, persisted to `localStorage`. A `useTabFetcher` hook bridges the store (pure state, no I/O) to the backend (invoke calls), keeping the store itself unit-testable without mocking Tauri.

**Tech Stack:** Rust (explorer-filesystem crate, tauri commands), React + TypeScript, Zustand, Vitest, plain CSS with custom properties for theming.

**Spec:** [docs/superpowers/specs/2026-07-10-phase-2-application-shell-design.md](../specs/2026-07-10-phase-2-application-shell-design.md)

---

## Task 1: Rust filesystem — drives, directory listing, default start path

**Files:**
- Modify: `crates/filesystem/Cargo.toml`
- Modify: `crates/filesystem/src/lib.rs`
- Create: `crates/filesystem/src/drives.rs`
- Create: `crates/filesystem/src/listing.rs`
- Create: `crates/filesystem/src/home.rs`

- [ ] **Step 1: Add dependencies**

Replace the contents of `crates/filesystem/Cargo.toml`:

```toml
[package]
name = "explorer-filesystem"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "explorer_filesystem"
path = "src/lib.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
dirs = "5"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write `drives.rs` with its test**

Create `crates/filesystem/src/drives.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub mount_point: String,
}

#[cfg(windows)]
pub fn list_drives() -> Vec<DriveInfo> {
    (b'A'..=b'Z')
        .filter_map(|letter| {
            let letter = letter as char;
            let root = format!("{letter}:\\");
            std::fs::metadata(&root).ok().map(|_| DriveInfo {
                name: format!("{letter}:"),
                path: root.clone(),
                mount_point: root,
            })
        })
        .collect()
}

#[cfg(not(windows))]
pub fn list_drives() -> Vec<DriveInfo> {
    vec![DriveInfo {
        name: "Root".to_string(),
        path: "/".to_string(),
        mount_point: "/".to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_drives_returns_existing_paths() {
        let drives = list_drives();
        assert!(!drives.is_empty(), "expected at least one drive");
        for drive in &drives {
            assert!(
                std::path::Path::new(&drive.path).exists(),
                "drive path {} should exist",
                drive.path
            );
        }
    }
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cargo test -p explorer-filesystem drives:: -- --nocapture`
Expected: `test drives::tests::list_drives_returns_existing_paths ... ok`

(This test is verification-first rather than TDD-first — `list_drives` has no meaningful "fail first" state since it reads real OS drives; the test locks in the existing-path invariant.)

- [ ] **Step 4: Write `listing.rs` with its tests**

Create `crates/filesystem/src/listing.rs`:

```rust
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    /// Unix epoch seconds as a string, or `None` if the OS didn't report a modified time.
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub entries: Vec<EntryInfo>,
    pub parent: Option<String>,
}

pub fn list_directory(path: &str) -> Result<DirectoryListing, String> {
    let dir = Path::new(path);
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("Could not read '{path}': {e}"))?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Could not read entry in '{path}': {e}"))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Could not read metadata: {e}"))?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());

        entries.push(EntryInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: if metadata.is_dir() {
                None
            } else {
                Some(metadata.len())
            },
            modified,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    let parent = dir.parent().map(|p| p.to_string_lossy().to_string());

    Ok(DirectoryListing { entries, parent })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn list_directory_returns_sorted_entries_with_parent() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("b_folder")).unwrap();
        fs::write(dir.path().join("a_file.txt"), b"hello").unwrap();
        fs::create_dir(dir.path().join("a_folder")).unwrap();

        let listing = list_directory(dir.path().to_str().unwrap()).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "b_folder", "a_file.txt"]);
        assert!(listing.entries[0].is_dir);
        assert!(listing.entries[2].size.is_some());
        assert_eq!(
            listing.parent,
            dir.path().parent().map(|p| p.to_string_lossy().to_string())
        );
    }

    #[test]
    fn list_directory_returns_err_for_missing_path() {
        let result = list_directory("this-path-should-not-exist-12345");
        assert!(result.is_err());
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p explorer-filesystem listing:: -- --nocapture`
Expected: both `listing::tests::*` tests pass.

- [ ] **Step 6: Write `home.rs`**

Create `crates/filesystem/src/home.rs`:

```rust
pub fn default_start_path() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_start_path_returns_non_empty_path() {
        let path = default_start_path();
        assert!(!path.is_empty());
    }
}
```

- [ ] **Step 7: Wire up `lib.rs`**

Replace the contents of `crates/filesystem/src/lib.rs`:

```rust
//! Directory listing, copy, move, delete, rename, metadata, and file watching.

mod drives;
mod home;
mod listing;

pub use drives::{list_drives, DriveInfo};
pub use home::default_start_path;
pub use listing::{list_directory, DirectoryListing, EntryInfo};
```

- [ ] **Step 8: Run the full crate test suite**

Run: `cargo test -p explorer-filesystem`
Expected: `test result: ok.` with 4 passing tests (1 in drives, 2 in listing, 1 in home).

- [ ] **Step 9: Add `cargo test` to CI**

In `.github/workflows/ci.yml`, add a test step after `cargo check` in the `rust` job:

```yaml
      - name: cargo check
        run: cargo check --workspace --all-targets

      - name: cargo test
        run: cargo test --workspace
```

- [ ] **Step 10: Commit**

```bash
git add crates/filesystem .github/workflows/ci.yml
git commit -m "Add real drive listing, directory listing, and home path to explorer-filesystem"
```

---

## Task 2: Expose filesystem functions as Tauri commands

**Files:**
- Create: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Create the commands module**

Create `apps/desktop/src-tauri/src/commands.rs`:

```rust
use explorer_filesystem::{list_directory, list_drives, DirectoryListing, DriveInfo};

#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    list_drives()
}

#[tauri::command]
pub fn get_directory_listing(path: String) -> Result<DirectoryListing, String> {
    list_directory(&path)
}

#[tauri::command]
pub fn get_default_start_path() -> String {
    explorer_filesystem::default_start_path()
}
```

- [ ] **Step 2: Register the commands**

Replace the contents of `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_drives,
            commands::get_directory_listing,
            commands::get_default_start_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add window permissions needed for the Phase 2 title bar ahead of time**

Replace the contents of `apps/desktop/src-tauri/capabilities/default.json` (this bundles the window-control permissions Task 8's title bar will need, so we only touch this file once):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging"
  ]
}
```

- [ ] **Step 4: Verify the workspace still compiles**

Run: `cargo check --workspace --all-targets`
Expected: `Finished` with no errors. (If it errors with an unknown permission identifier, that specific string is wrong for the installed Tauri version — check the version with `cargo tree -p tauri | head -1` and adjust.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/capabilities/default.json
git commit -m "Expose filesystem commands over Tauri IPC"
```

---

## Task 3: Frontend TypeScript types

**Files:**
- Create: `apps/desktop/src/types/filesystem.ts`

- [ ] **Step 1: Create the types file**

Create `apps/desktop/src/types/filesystem.ts`:

```ts
export interface DriveInfo {
  name: string;
  path: string;
  mountPoint: string;
}

export interface EntryInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: string | null;
}

export interface DirectoryListing {
  entries: EntryInfo[];
  parent: string | null;
}
```

These field names (camelCase) match the Rust structs' `#[serde(rename_all = "camelCase")]` from Task 1, so no mapping layer is needed between the IPC payload and the frontend types.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly (this file isn't imported yet, but `tsc` will still typecheck it since it's under `src/`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/types/filesystem.ts
git commit -m "Add TypeScript types mirroring filesystem IPC payloads"
```

---

## Task 4: Vitest setup

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/setupTests.smoke.test.ts`

- [ ] **Step 1: Install Vitest and Zustand**

Run: `cd apps/desktop && npm install zustand && npm install -D vitest`

- [ ] **Step 2: Add test scripts to `package.json`**

In `apps/desktop/package.json`, update the `scripts` block to:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Switch `vite.config.ts` to the Vitest-aware config helper**

In `apps/desktop/vite.config.ts`, change the import line from:

```ts
import { defineConfig } from "vite";
```

to:

```ts
import { defineConfig } from "vitest/config";
```

Leave the rest of the file (the `plugins`, `server`, `envPrefix`, `build` options) unchanged — `vitest/config` re-exports Vite's `defineConfig` with `test` option types added.

- [ ] **Step 4: Write a smoke test to confirm Vitest runs**

Create `apps/desktop/src/setupTests.smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd apps/desktop && npm test`
Expected: `1 passed` (1 test file, 1 test).

- [ ] **Step 6: Delete the smoke test**

It served only to confirm the harness works; Task 5 adds the real test file.

```bash
rm apps/desktop/src/setupTests.smoke.test.ts
```

- [ ] **Step 7: Add `npm test` to CI**

In `.github/workflows/ci.yml`, update the `frontend` job to run tests before building:

```yaml
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/vite.config.ts .github/workflows/ci.yml
git commit -m "Add Vitest and Zustand to the desktop app"
```

---

## Task 5: `useExplorerStore` (TDD)

**Files:**
- Create: `apps/desktop/src/stores/useExplorerStore.ts`
- Test: `apps/desktop/src/stores/useExplorerStore.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/desktop/src/stores/useExplorerStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "./useExplorerStore";

function resetStore() {
  useExplorerStore.setState({ tabs: [], activeTabId: "" });
}

describe("useExplorerStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("newTab creates a tab and makes it active", () => {
    useExplorerStore.getState().newTab("C:\\");
    const state = useExplorerStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].history).toEqual(["C:\\"]);
    expect(state.tabs[0].historyIndex).toBe(0);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it("navigateTo pushes history and truncates forward history", () => {
    useExplorerStore.getState().newTab("C:\\");
    const id = useExplorerStore.getState().activeTabId;
    const store = useExplorerStore.getState();

    store.navigateTo("C:\\Users");
    store.navigateTo("C:\\Users\\boo");
    store.back();
    store.navigateTo("C:\\Users\\other");

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history).toEqual(["C:\\", "C:\\Users", "C:\\Users\\other"]);
    expect(tab.historyIndex).toBe(2);
  });

  it("back and forward move the history index within bounds", () => {
    useExplorerStore.getState().newTab("C:\\");
    const store = useExplorerStore.getState();
    store.navigateTo("C:\\Users");
    store.navigateTo("C:\\Users\\boo");

    store.back();
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(1);

    store.back();
    store.back(); // already at index 0, should stay
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(0);

    store.forward();
    store.forward();
    store.forward(); // already at last index, should stay
    expect(useExplorerStore.getState().tabs[0].historyIndex).toBe(2);
  });

  it("up navigates to the tab's parent path", () => {
    useExplorerStore.getState().newTab("C:\\Users\\boo");
    const id = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().setTabResult(id, { entries: [], parent: "C:\\Users" });

    useExplorerStore.getState().up();

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history[tab.historyIndex]).toBe("C:\\Users");
  });

  it("up is a no-op when parent is null", () => {
    useExplorerStore.getState().newTab("C:\\");
    const id = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().setTabResult(id, { entries: [], parent: null });

    useExplorerStore.getState().up();

    const tab = useExplorerStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.history).toEqual(["C:\\"]);
  });

  it("keeps multiple tabs independent", () => {
    useExplorerStore.getState().newTab("C:\\");
    const firstId = useExplorerStore.getState().activeTabId;
    useExplorerStore.getState().newTab("D:\\");
    const secondId = useExplorerStore.getState().activeTabId;

    useExplorerStore.getState().navigateTo("D:\\Games");

    const state = useExplorerStore.getState();
    const first = state.tabs.find((t) => t.id === firstId)!;
    const second = state.tabs.find((t) => t.id === secondId)!;
    expect(first.history).toEqual(["C:\\"]);
    expect(second.history).toEqual(["D:\\", "D:\\Games"]);
  });

  it("closeTab removes a tab but never removes the last one", () => {
    useExplorerStore.getState().newTab("C:\\");
    const onlyId = useExplorerStore.getState().activeTabId;

    useExplorerStore.getState().closeTab(onlyId);
    expect(useExplorerStore.getState().tabs).toHaveLength(1);

    useExplorerStore.getState().newTab("D:\\");
    useExplorerStore.getState().closeTab(onlyId);
    expect(useExplorerStore.getState().tabs).toHaveLength(1);
    expect(useExplorerStore.getState().tabs[0].history).toEqual(["D:\\"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test`
Expected: FAIL — `Cannot find module './useExplorerStore'` (the module doesn't exist yet).

- [ ] **Step 3: Implement the store**

Create `apps/desktop/src/stores/useExplorerStore.ts`:

```ts
import { create } from "zustand";
import type { EntryInfo } from "../types/filesystem";

export interface Tab {
  id: string;
  history: string[];
  historyIndex: number;
  parent: string | null;
  entries: EntryInfo[];
  loading: boolean;
  error: string | null;
}

type TabResult = { entries: EntryInfo[]; parent: string | null } | { error: string };

interface ExplorerState {
  tabs: Tab[];
  activeTabId: string;
  navigateTo: (path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  newTab: (path: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabResult: (id: string, result: TabResult) => void;
}

let nextTabId = 1;

function createTab(path: string): Tab {
  return {
    id: `tab-${nextTabId++}`,
    history: [path],
    historyIndex: 0,
    parent: null,
    entries: [],
    loading: true,
    error: null,
  };
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  tabs: [],
  activeTabId: "",

  navigateTo: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId) return tab;
        const history = tab.history.slice(0, tab.historyIndex + 1);
        history.push(path);
        return { ...tab, history, historyIndex: history.length - 1, loading: true, error: null };
      }),
    })),

  back: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex <= 0) return tab;
        return { ...tab, historyIndex: tab.historyIndex - 1, loading: true, error: null };
      }),
    })),

  forward: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex >= tab.history.length - 1) return tab;
        return { ...tab, historyIndex: tab.historyIndex + 1, loading: true, error: null };
      }),
    })),

  up: () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab || tab.parent === null) return;
    get().navigateTo(tab.parent);
  },

  refresh: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, loading: true, error: null } : tab,
      ),
    })),

  newTab: (path) =>
    set((state) => {
      const tab = createTab(path);
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (id) =>
    set((state) => {
      if (state.tabs.length <= 1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId = state.activeTabId === id ? tabs[tabs.length - 1].id : state.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setTabResult: (id, result) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if ("error" in result) {
          return { ...tab, loading: false, error: result.error };
        }
        return { ...tab, loading: false, error: null, entries: result.entries, parent: result.parent };
      }),
    })),
}));

export function useActiveTab(): Tab | undefined {
  return useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test`
Expected: `7 passed` in `useExplorerStore.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/useExplorerStore.ts apps/desktop/src/stores/useExplorerStore.test.ts
git commit -m "Add useExplorerStore with tested tab/navigation logic"
```

---

## Task 6: `useThemeStore` and theme resolution

**Files:**
- Create: `apps/desktop/src/stores/useThemeStore.ts`
- Create: `apps/desktop/src/hooks/useResolvedTheme.ts`

- [ ] **Step 1: Create the theme store**

Create `apps/desktop/src/stores/useThemeStore.ts`:

```ts
import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface StoredTheme {
  theme: Theme;
  accentColor: string;
}

interface ThemeState extends StoredTheme {
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
}

const STORAGE_KEY = "project-explorer:theme";
const DEFAULTS: StoredTheme = { theme: "system", accentColor: "#2b6cb0" };

function loadStoredTheme(): StoredTheme {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTheme>;
    return {
      theme: parsed.theme ?? DEFAULTS.theme,
      accentColor: parsed.accentColor ?? DEFAULTS.accentColor,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: StoredTheme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...loadStoredTheme(),

  setTheme: (theme) => {
    set({ theme });
    persist({ theme, accentColor: get().accentColor });
  },

  setAccentColor: (accentColor) => {
    set({ accentColor });
    persist({ theme: get().theme, accentColor });
  },
}));
```

- [ ] **Step 2: Create the resolved-theme hook**

Create `apps/desktop/src/hooks/useResolvedTheme.ts`:

```ts
import { useEffect, useState } from "react";
import { useThemeStore } from "../stores/useThemeStore";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useResolvedTheme(): "light" | "dark" {
  const theme = useThemeStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/stores/useThemeStore.ts apps/desktop/src/hooks/useResolvedTheme.ts
git commit -m "Add theme store and system-theme resolution hook"
```

---

## Task 7: Theme CSS and global styles

**Files:**
- Create: `apps/desktop/src/styles/theme.css`
- Create: `apps/desktop/src/styles/global.css`

- [ ] **Step 1: Create the theme variables file**

Create `apps/desktop/src/styles/theme.css`:

```css
:root[data-theme="light"] {
  --bg: #ffffff;
  --bg-secondary: #f3f4f6;
  --fg: #1a1a1a;
  --fg-muted: #6b7280;
  --border: #e2e2e2;
  --accent: #2b6cb0;
  --danger: #dc2626;
}

:root[data-theme="dark"] {
  --bg: #1e1f22;
  --bg-secondary: #2a2b2e;
  --fg: #f0f0f0;
  --fg-muted: #9ca3af;
  --border: #3a3b3e;
  --accent: #4a9eff;
  --danger: #f87171;
}
```

- [ ] **Step 2: Create the global reset/base file**

Create `apps/desktop/src/styles/global.css`:

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--fg);
}

button {
  font-family: inherit;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles/theme.css apps/desktop/src/styles/global.css
git commit -m "Add theme CSS variables and global base styles"
```

(These files aren't imported anywhere yet — Task 14 wires them into `App.tsx`. Committing them now keeps Task 14 focused on assembly rather than mixing in new files.)

---

## Task 8: Frameless window and `TitleBar`

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src/components/TitleBar.tsx`
- Create: `apps/desktop/src/components/TitleBar.css`

- [ ] **Step 1: Disable OS window decorations**

In `apps/desktop/src-tauri/tauri.conf.json`, update the `windows` entry to add `"decorations": false`:

```json
    "windows": [
      {
        "title": "Project Explorer",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "decorations": false
      }
    ],
```

- [ ] **Step 2: Create the title bar component**

Create `apps/desktop/src/components/TitleBar.tsx`:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

const appWindow = getCurrentWindow();

function TitleBar() {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar__title">Project Explorer</span>
      <div className="title-bar__controls">
        <button
          className="title-bar__button"
          aria-label="Minimize"
          onClick={() => appWindow.minimize()}
        >
          &#x2013;
        </button>
        <button
          className="title-bar__button"
          aria-label="Maximize"
          onClick={() => appWindow.toggleMaximize()}
        >
          &#x25A1;
        </button>
        <button
          className="title-bar__button title-bar__button--close"
          aria-label="Close"
          onClick={() => appWindow.close()}
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
```

- [ ] **Step 3: Create the title bar styles**

Create `apps/desktop/src/components/TitleBar.css`:

```css
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.title-bar__title {
  padding-left: 12px;
  font-size: 12px;
  color: var(--fg-muted);
}

.title-bar__controls {
  display: flex;
  height: 100%;
}

.title-bar__button {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.title-bar__button:hover {
  background: var(--border);
}

.title-bar__button--close:hover {
  background: var(--danger);
  color: white;
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly. (`TitleBar` isn't rendered anywhere yet — Task 14 wires it in.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src/components/TitleBar.tsx apps/desktop/src/components/TitleBar.css
git commit -m "Add frameless window config and custom TitleBar"
```

---

## Task 9: `Toolbar`

**Files:**
- Create: `apps/desktop/src/components/Toolbar.tsx`
- Create: `apps/desktop/src/components/Toolbar.css`

- [ ] **Step 1: Create the toolbar component**

Create `apps/desktop/src/components/Toolbar.tsx`:

```tsx
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./Toolbar.css";

function Toolbar() {
  const activeTab = useActiveTab();
  const back = useExplorerStore((state) => state.back);
  const forward = useExplorerStore((state) => state.forward);
  const up = useExplorerStore((state) => state.up);
  const refresh = useExplorerStore((state) => state.refresh);

  const canGoBack = !!activeTab && activeTab.historyIndex > 0;
  const canGoForward = !!activeTab && activeTab.historyIndex < activeTab.history.length - 1;
  const canGoUp = !!activeTab && activeTab.parent !== null;

  return (
    <div className="toolbar">
      <button disabled={!canGoBack} onClick={back} aria-label="Back">
        &#x2190;
      </button>
      <button disabled={!canGoForward} onClick={forward} aria-label="Forward">
        &#x2192;
      </button>
      <button disabled={!canGoUp} onClick={up} aria-label="Up">
        &#x2191;
      </button>
      <button onClick={refresh} aria-label="Refresh">
        &#x21bb;
      </button>
      <span className="toolbar__path">{activeTab?.history[activeTab.historyIndex] ?? ""}</span>
    </div>
  );
}

export default Toolbar;
```

- [ ] **Step 2: Create the toolbar styles**

Create `apps/desktop/src/components/Toolbar.css`:

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 8px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.toolbar button {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg);
  border-radius: 4px;
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) {
  background: var(--bg-secondary);
  border-color: var(--border);
}

.toolbar button:disabled {
  color: var(--fg-muted);
  cursor: default;
  opacity: 0.5;
}

.toolbar__path {
  margin-left: 12px;
  font-size: 12px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/Toolbar.tsx apps/desktop/src/components/Toolbar.css
git commit -m "Add Toolbar wired to explorer navigation actions"
```

---

## Task 10: Sidebar (`DriveList` + `FavoritesList`)

**Files:**
- Create: `apps/desktop/src/sidebar/DriveList.tsx`
- Create: `apps/desktop/src/sidebar/FavoritesList.tsx`
- Create: `apps/desktop/src/sidebar/Sidebar.tsx`
- Create: `apps/desktop/src/sidebar/Sidebar.css`

- [ ] **Step 1: Create `DriveList`**

Create `apps/desktop/src/sidebar/DriveList.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/filesystem";
import { useExplorerStore } from "../stores/useExplorerStore";

function DriveList() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  useEffect(() => {
    invoke<DriveInfo[]>("get_drives")
      .then(setDrives)
      .catch(() => setDrives([]));
  }, []);

  return (
    <div className="sidebar__section">
      <div className="sidebar__heading">Drives</div>
      <ul className="sidebar__list">
        {drives.map((drive) => (
          <li key={drive.path}>
            <button className="sidebar__item" onClick={() => navigateTo(drive.path)}>
              {drive.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DriveList;
```

- [ ] **Step 2: Create `FavoritesList`**

Create `apps/desktop/src/sidebar/FavoritesList.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";

function FavoritesList() {
  const [homePath, setHomePath] = useState<string | null>(null);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  useEffect(() => {
    invoke<string>("get_default_start_path")
      .then(setHomePath)
      .catch(() => setHomePath(null));
  }, []);

  const favorites = homePath ? [{ label: "Home", path: homePath }] : [];

  return (
    <div className="sidebar__section">
      <div className="sidebar__heading">Favorites</div>
      <ul className="sidebar__list">
        {favorites.map((fav) => (
          <li key={fav.path}>
            <button className="sidebar__item" onClick={() => navigateTo(fav.path)}>
              {fav.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default FavoritesList;
```

- [ ] **Step 3: Create `Sidebar`**

Create `apps/desktop/src/sidebar/Sidebar.tsx`:

```tsx
import DriveList from "./DriveList";
import FavoritesList from "./FavoritesList";
import "./Sidebar.css";

function Sidebar() {
  return (
    <aside className="sidebar">
      <FavoritesList />
      <DriveList />
    </aside>
  );
}

export default Sidebar;
```

- [ ] **Step 4: Create the sidebar styles**

Create `apps/desktop/src/sidebar/Sidebar.css`:

```css
.sidebar {
  width: 200px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  padding: 8px 0;
}

.sidebar__section {
  margin-bottom: 12px;
}

.sidebar__heading {
  padding: 4px 12px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--fg-muted);
}

.sidebar__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sidebar__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-size: 13px;
}

.sidebar__item:hover {
  background: var(--border);
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/sidebar
git commit -m "Add Sidebar with real drives and a Home favorite"
```

---

## Task 11: `useTabFetcher` — bridges the store to Tauri IPC

**Files:**
- Create: `apps/desktop/src/hooks/useTabFetcher.ts`

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/hooks/useTabFetcher.ts`:

```ts
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import type { DirectoryListing } from "../types/filesystem";

export function useTabFetcher() {
  const tabs = useExplorerStore((state) => state.tabs);
  const setTabResult = useExplorerStore((state) => state.setTabResult);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.loading || inFlight.current.has(tab.id)) continue;
      const path = tab.history[tab.historyIndex];
      inFlight.current.add(tab.id);

      invoke<DirectoryListing>("get_directory_listing", { path })
        .then((listing) => {
          setTabResult(tab.id, { entries: listing.entries, parent: listing.parent });
        })
        .catch((error: string) => {
          setTabResult(tab.id, { error: String(error) });
        })
        .finally(() => {
          inFlight.current.delete(tab.id);
        });
    }
  }, [tabs, setTabResult]);
}
```

This is the only place `get_directory_listing` is called from — `useExplorerStore` stays pure state (as tested in Task 5), and this hook is exercised via the manual verification pass in Task 15 rather than a unit test, per the spec's testing scope.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly. (Not called anywhere yet — Task 14 wires it into `App.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useTabFetcher.ts
git commit -m "Add useTabFetcher to bridge explorer store state to Tauri IPC"
```

---

## Task 12: Explorer (`TabBar` + `Breadcrumbs` + `FileList`)

**Files:**
- Create: `apps/desktop/src/explorer/TabBar.tsx`
- Create: `apps/desktop/src/explorer/TabBar.css`
- Create: `apps/desktop/src/explorer/Breadcrumbs.tsx`
- Create: `apps/desktop/src/explorer/Breadcrumbs.css`
- Create: `apps/desktop/src/explorer/FileList.tsx`
- Create: `apps/desktop/src/explorer/FileList.css`
- Create: `apps/desktop/src/explorer/Explorer.tsx`
- Create: `apps/desktop/src/explorer/Explorer.css`

- [ ] **Step 1: Create `TabBar`**

Create `apps/desktop/src/explorer/TabBar.tsx`:

```tsx
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./TabBar.css";

function tabLabel(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function TabBar() {
  const tabs = useExplorerStore((state) => state.tabs);
  const activeTabId = useExplorerStore((state) => state.activeTabId);
  const activeTab = useActiveTab();
  const setActiveTab = useExplorerStore((state) => state.setActiveTab);
  const closeTab = useExplorerStore((state) => state.closeTab);
  const newTab = useExplorerStore((state) => state.newTab);

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-bar__tab ${tab.id === activeTabId ? "tab-bar__tab--active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-bar__label">{tabLabel(tab.history[tab.historyIndex])}</span>
          {tabs.length > 1 && (
            <button
              className="tab-bar__close"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              &#x2715;
            </button>
          )}
        </div>
      ))}
      <button
        className="tab-bar__new"
        aria-label="New tab"
        onClick={() => newTab(activeTab ? activeTab.history[activeTab.historyIndex] : "")}
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
```

- [ ] **Step 2: Create `TabBar.css`**

Create `apps/desktop/src/explorer/TabBar.css`:

```css
.tab-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.tab-bar__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 10px;
  border-right: 1px solid var(--border);
  cursor: pointer;
  color: var(--fg-muted);
  font-size: 12px;
  white-space: nowrap;
}

.tab-bar__tab--active {
  background: var(--bg);
  color: var(--fg);
}

.tab-bar__close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}

.tab-bar__new {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0 10px;
  height: 100%;
}
```

- [ ] **Step 3: Create `Breadcrumbs`**

Create `apps/desktop/src/explorer/Breadcrumbs.tsx`:

```tsx
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./Breadcrumbs.css";

interface Crumb {
  label: string;
  path: string;
}

function splitPath(path: string): Crumb[] {
  const isWindows = /^[a-zA-Z]:\\/.test(path);
  const separator = isWindows ? "\\" : "/";
  const parts = path.split(separator).filter(Boolean);

  const crumbs: Crumb[] = [];
  let current = "";

  parts.forEach((part, index) => {
    if (isWindows && index === 0) {
      current = `${part}${separator}`;
    } else {
      current = current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`;
    }
    crumbs.push({ label: part, path: current });
  });

  return crumbs;
}

function Breadcrumbs() {
  const activeTab = useActiveTab();
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  if (!activeTab) return null;
  const path = activeTab.history[activeTab.historyIndex];
  const crumbs = splitPath(path);

  return (
    <div className="breadcrumbs">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path}>
          <button className="breadcrumbs__crumb" onClick={() => navigateTo(crumb.path)}>
            {crumb.label}
          </button>
          {index < crumbs.length - 1 && <span className="breadcrumbs__separator">/</span>}
        </span>
      ))}
    </div>
  );
}

export default Breadcrumbs;
```

- [ ] **Step 4: Create `Breadcrumbs.css`**

Create `apps/desktop/src/explorer/Breadcrumbs.css`:

```css
.breadcrumbs {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  white-space: nowrap;
}

.breadcrumbs__crumb {
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  padding: 2px 4px;
}

.breadcrumbs__crumb:hover {
  text-decoration: underline;
}

.breadcrumbs__separator {
  margin: 0 2px;
  color: var(--fg-muted);
}
```

- [ ] **Step 5: Create `FileList`**

Create `apps/desktop/src/explorer/FileList.tsx`:

```tsx
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./FileList.css";

function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModified(modified: string | null): string {
  if (modified === null) return "";
  const seconds = Number(modified);
  if (Number.isNaN(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}

function FileList() {
  const activeTab = useActiveTab();
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const refresh = useExplorerStore((state) => state.refresh);

  if (!activeTab) return null;

  if (activeTab.error) {
    return (
      <div className="file-list-message file-list-message--error">
        <p>{activeTab.error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (activeTab.loading) {
    return <div className="file-list-message">Loading…</div>;
  }

  if (activeTab.entries.length === 0) {
    return <div className="file-list-message">This folder is empty.</div>;
  }

  return (
    <table className="file-list">
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Modified</th>
        </tr>
      </thead>
      <tbody>
        {activeTab.entries.map((entry) => (
          <tr
            key={entry.path}
            className="file-list__row"
            onDoubleClick={() => entry.isDir && navigateTo(entry.path)}
          >
            <td>
              {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
              {entry.name}
            </td>
            <td>{formatSize(entry.size)}</td>
            <td>{formatModified(entry.modified)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default FileList;
```

- [ ] **Step 6: Create `FileList.css`**

Create `apps/desktop/src/explorer/FileList.css`:

```css
.file-list {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.file-list th {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-weight: normal;
  position: sticky;
  top: 0;
  background: var(--bg);
}

.file-list td {
  padding: 4px 10px;
}

.file-list__row:hover {
  background: var(--bg-secondary);
}

.file-list-message {
  padding: 20px;
  color: var(--fg-muted);
  text-align: center;
}

.file-list-message--error button {
  margin-top: 8px;
}
```

- [ ] **Step 7: Create `Explorer`**

Create `apps/desktop/src/explorer/Explorer.tsx`:

```tsx
import TabBar from "./TabBar";
import Breadcrumbs from "./Breadcrumbs";
import FileList from "./FileList";
import "./Explorer.css";

function Explorer() {
  return (
    <div className="explorer">
      <TabBar />
      <Breadcrumbs />
      <div className="explorer__content">
        <FileList />
      </div>
    </div>
  );
}

export default Explorer;
```

- [ ] **Step 8: Create `Explorer.css`**

Create `apps/desktop/src/explorer/Explorer.css`:

```css
.explorer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.explorer__content {
  flex: 1;
  overflow-y: auto;
}
```

- [ ] **Step 9: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/explorer
git commit -m "Add Explorer: TabBar, Breadcrumbs, and FileList"
```

---

## Task 13: `PreviewPane` and `StatusBar`

**Files:**
- Create: `apps/desktop/src/preview/PreviewPane.tsx`
- Create: `apps/desktop/src/preview/PreviewPane.css`
- Create: `apps/desktop/src/components/StatusBar.tsx`
- Create: `apps/desktop/src/components/StatusBar.css`

- [ ] **Step 1: Create `PreviewPane`**

Create `apps/desktop/src/preview/PreviewPane.tsx`:

```tsx
import "./PreviewPane.css";

function PreviewPane() {
  return (
    <aside className="preview-pane">
      <p className="preview-pane__empty">Select a file to preview</p>
    </aside>
  );
}

export default PreviewPane;
```

- [ ] **Step 2: Create `PreviewPane.css`**

Create `apps/desktop/src/preview/PreviewPane.css`:

```css
.preview-pane {
  width: 240px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-pane__empty {
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
  padding: 12px;
}
```

- [ ] **Step 3: Create `StatusBar`**

Create `apps/desktop/src/components/StatusBar.tsx`:

```tsx
import { useActiveTab } from "../stores/useExplorerStore";
import "./StatusBar.css";

function StatusBar() {
  const activeTab = useActiveTab();
  const itemCount = activeTab?.entries.length ?? 0;

  return (
    <div className="status-bar">
      <span>
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

export default StatusBar;
```

- [ ] **Step 4: Create `StatusBar.css`**

Create `apps/desktop/src/components/StatusBar.css`:

```css
.status-bar {
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  color: var(--fg-muted);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/desktop && npm run build`
Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preview apps/desktop/src/components/StatusBar.tsx apps/desktop/src/components/StatusBar.css
git commit -m "Add PreviewPane placeholder and StatusBar"
```

---

## Task 14: Assemble `App.tsx`

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/App.css`

- [ ] **Step 1: Replace `App.tsx`**

Replace the contents of `apps/desktop/src/App.tsx`:

```tsx
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import Sidebar from "./sidebar/Sidebar";
import Explorer from "./explorer/Explorer";
import PreviewPane from "./preview/PreviewPane";
import { useExplorerStore } from "./stores/useExplorerStore";
import { useTabFetcher } from "./hooks/useTabFetcher";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import "./styles/theme.css";
import "./styles/global.css";
import "./App.css";

function App() {
  const tabs = useExplorerStore((state) => state.tabs);
  const newTab = useExplorerStore((state) => state.newTab);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (tabs.length === 0) {
      invoke<string>("get_default_start_path").then(newTab);
    }
  }, [tabs.length, newTab]);

  useTabFetcher();

  if (tabs.length === 0) {
    return <div className="app-loading">Loading…</div>;
  }

  return (
    <div className="app">
      <TitleBar />
      <Toolbar />
      <div className="app__body">
        <Sidebar />
        <Explorer />
        <PreviewPane />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Create `App.css`**

Create `apps/desktop/src/App.css`:

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--fg-muted);
}
```

- [ ] **Step 3: Verify build and tests both pass**

Run: `cd apps/desktop && npm test && npm run build`
Expected: tests pass, build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/App.css
git commit -m "Assemble application shell in App.tsx"
```

---

## Task 15: Full verification and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Rust checks**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: all three pass with no warnings or failures.

- [ ] **Step 2: Frontend checks**

Run: `cd apps/desktop && npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 3: Launch the app and drive it manually**

Run: `cd apps/desktop && npm run tauri dev`

Once the window opens, verify by hand:
- Frameless window with custom title bar; minimize, maximize, and close buttons work; dragging the title bar moves the window.
- The app opens with one tab at the real home directory, showing real files/folders.
- Clicking a folder (double-click) navigates into it; Back/Forward/Up/Refresh all work and disable correctly at history bounds and at drive roots.
- Sidebar shows real drives; clicking one navigates the active tab there. "Home" favorite navigates back to the home directory.
- Opening a new tab, navigating it independently of the first tab, and closing tabs all work; the last remaining tab cannot be closed.
- Status bar shows the correct item count for the active tab.
- Preview pane shows the "Select a file to preview" placeholder.
- Theme matches the OS light/dark setting.
- Navigating into a path that doesn't exist (e.g. delete a folder externally while its tab is open, then Refresh) shows the inline error state with a working Retry button.

- [ ] **Step 4: Close the dev server**

Stop the `npm run tauri dev` process (Ctrl+C) once manual verification is complete.

- [ ] **Step 5: Final commit (if any fixes were needed during manual verification)**

```bash
git add -A
git commit -m "Fix issues found during Phase 2 manual verification"
```

(Skip this step if manual verification found nothing to fix.)
