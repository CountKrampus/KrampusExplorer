# Phase 2: Application Shell — Design

**Status:** Approved
**Date:** 2026-07-10
**Roadmap reference:** [Plan.md](../../../Plan.md#phase-2) Phase 2 — Window, Sidebar, Explorer, Routing, Theme

## Scope

Build the application shell: window chrome, sidebar, explorer (tabs, breadcrumbs, file list),
theme system, and in-app navigation ("routing"). Unlike a minimal shell-only phase, this includes
a thin real slice of `explorer-filesystem`: real drives, real directory listing, and real
back/forward/up/refresh navigation. By the end of Phase 2 the app is a bare but functional file
browser. Phase 3 (Filesystem) then focuses on file *operations* (copy/move/delete/rename/create)
rather than listing/navigation, since navigation is already covered here.

Explicitly out of scope for Phase 2 (deferred to later phases per `Plan.md`):
- File operations: copy, move, delete, rename, new file/folder, drag & drop (Phase 3)
- Preview pane content — Phase 2 ships an empty-state placeholder only (Phase 5)
- Sidebar folder tree (expandable/lazy-loaded) — sidebar is Drives + static Favorites only for now
- View modes beyond Details (list/large icons/small icons), sort/filter/group UI
- Search (Phase 4), Settings persistence backend (Phase 6 — theme uses `localStorage` for now)

## Architecture & Data Flow

New Tauri commands added to the `explorer-filesystem` crate, exposed via `src-tauri`. OS path
semantics stay in Rust — the frontend never manipulates filesystem paths itself.

```rust
list_drives() -> Vec<DriveInfo>
// DriveInfo { name: String, path: String, mount_point: String }

list_directory(path: String) -> Result<DirectoryListing, String>
// DirectoryListing { entries: Vec<EntryInfo>, parent: Option<String> }
// EntryInfo { name: String, path: String, is_dir: bool, size: Option<u64>, modified: Option<String> }
```

- Entries are sorted directories-first, then alphabetically by name, on the Rust side.
- Errors (permission denied, path not found, path removed mid-session) return `Err(String)`
  rather than panicking; the frontend surfaces these per-tab instead of crashing.
- Frontend calls these commands via `@tauri-apps/api/core` `invoke()`.

### State (Zustand)

**`useExplorerStore`** — the "routing" layer; no router library is used since this is a desktop
app with tabs, not URL-addressed views.

```ts
type Tab = {
  id: string;
  history: string[];
  historyIndex: number;
  entries: EntryInfo[];
  loading: boolean;
  error: string | null;
};

type ExplorerState = {
  tabs: Tab[];
  activeTabId: string;
  navigateTo: (path: string) => void;   // pushes history, truncates forward history
  back: () => void;
  forward: () => void;
  up: () => void;                        // uses `parent` from last listing
  refresh: () => void;
  newTab: (path: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
};
```

Each tab's navigation state (history stack, index, loading/error) is fully independent — an error
or slow load in one tab must not affect others.

- On first launch, the app opens one tab at the user's home directory (resolved on the Rust side
  via the `dirs` crate, not hardcoded in the frontend).
- `closeTab` on the last remaining tab is a no-op — there is always at least one open tab.

**`useThemeStore`** — `{ theme: 'light' | 'dark' | 'system', accentColor: string }`, persisted to
`localStorage`. Moves to the real `explorer-settings` backend in Phase 6; `localStorage` is a
deliberate placeholder, not a design commitment.

## Window & Theme

- `tauri.conf.json`: `decorations: false` (frameless window).
- A custom `TitleBar` component provides the drag region (`data-tauri-drag-region`) and
  minimize/maximize/close buttons via `@tauri-apps/api/window`.
- Theming uses plain CSS custom properties — no CSS-in-JS or theming library. `src/styles/theme.css`
  defines `--bg`, `--fg`, `--accent`, `--border`, etc. under `[data-theme="light"]` and
  `[data-theme="dark"]` selectors. `App.tsx` sets `data-theme` on `<html>` from `useThemeStore`;
  `'system'` resolves via a `prefers-color-scheme` media-query listener and stays in sync if the OS
  theme changes while the app is open.

## Layout & Components

```
TitleBar
Toolbar (Back / Forward / Up / Refresh — wired to useExplorerStore; disabled states reflect
         history bounds and `parent === null`)
├── Sidebar
│     DriveList      — real drives from list_drives()
│     FavoritesList  — static hardcoded entries for now
├── Explorer
│     TabBar         — open tabs, new tab, close tab
│     Breadcrumbs    — derived from active tab's current path
│     FileList       — Details view (Name / Size / Modified), directories-first sort from backend
└── PreviewPane       — placeholder empty state ("Select a file to preview"); real content is Phase 5
StatusBar (item count + selection count, derived from active tab's entries/selection)
```

Component placement matches the existing empty directories from Phase 1 scaffolding:

- `components/` — `TitleBar.tsx`, `Toolbar.tsx`, `StatusBar.tsx`
- `sidebar/` — `Sidebar.tsx`, `DriveList.tsx`, `FavoritesList.tsx`
- `explorer/` — `Explorer.tsx`, `TabBar.tsx`, `Breadcrumbs.tsx`, `FileList.tsx`
- `preview/` — `PreviewPane.tsx`
- `stores/` — `useExplorerStore.ts`, `useThemeStore.ts`
- `types/` — shared TS types mirroring the Rust command payloads (`DriveInfo`, `EntryInfo`, `DirectoryListing`)

The toolbar only ships functional buttons (Back/Forward/Up/Refresh) for Phase 2 — New
Folder/New File/Delete etc. are added alongside Phase 3's file operations rather than shown
disabled ahead of time.

## Error Handling

- `list_directory` failures set the active tab's `error` field instead of throwing.
- `FileList` renders an inline error state (message + Retry button calling `refresh()`) when
  `tab.error` is set, instead of showing a stale or empty list.
- `Up` button is disabled when `parent === null` (at a drive root).
- Per-tab isolation: a bad path in one tab never affects other open tabs.

## Testing

- **Rust:** unit tests for `list_directory` / `list_drives` in `explorer-filesystem`, using the
  `tempfile` crate to create real temporary directories/files. Cover: correct entries returned,
  directories-first sort order, `parent` computed correctly (including `None` at a root), and
  error cases (nonexistent path, permission denied where the test environment allows it).
- **Frontend:** add Vitest (pairs naturally with Vite; minimal config, one new dev dependency).
  Test `useExplorerStore` navigation logic directly (no component/DOM testing yet):
  - `navigateTo` pushes history and truncates any forward history
  - `back` / `forward` move `historyIndex` without data loss, respect bounds
  - `up` navigates using the last listing's `parent`
  - multiple tabs maintain fully independent history/state
