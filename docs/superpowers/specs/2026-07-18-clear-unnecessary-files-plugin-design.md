# Clear Unnecessary Files Plugin — Design

## Goal

Let a plugin find and clear well-known junk locations (temp folders, browser caches, thumbnail
cache, dev tool caches) from within Krampus Explorer. Second of five requested plugins (Recycling
Bin, Clear Unnecessary Files, Recover Lost Data, Drive Format, Secure Wipe), sequenced
safest-to-riskiest — this one stays in "safe" territory: everything it touches is user-writable
(no admin/UAC needed), everything it deletes is regenerable cache/scratch data, and every delete
goes through the Recycle Bin behind a confirmation dialog, matching the Recycling Bin plugin's
established safety pattern.

## Scope

Known junk locations only (not a recursive pattern-based scan of an arbitrary folder — that's a
different, more open-ended feature and out of scope here). Four categories, chosen because
they're all user-writable without elevation and deterministically locatable:

- **Temp Files** — the user's temp folder (`%TEMP%` / `%LOCALAPPDATA%\Temp`).
- **Browser caches** — Chrome and Edge cache folders (well-known, deterministic paths under
  `%LOCALAPPDATA%`). Firefox is excluded — its cache lives under a randomly-named profile
  directory, not a fixed path, so it can't be located deterministically without extra logic;
  out of scope for v1.
- **Explorer thumbnail cache** — `%LOCALAPPDATA%\Microsoft\Windows\Explorer`, filtered to
  `thumbcache_*.db` files (not the whole folder, which also holds non-cache Explorer state).
- **Dev tool caches** — npm (`%APPDATA%\npm-cache`), Yarn (`%LOCALAPPDATA%\Yarn\Cache`), pip
  (`%LOCALAPPDATA%\pip\Cache`), and Cargo (`~/.cargo/registry/cache` and
  `~/.cargo/registry/src`) — all re-downloadable package manager caches.

## Backend: two new generic primitives

Consistent with this codebase's existing plugin architecture (`duplicate-finder` and
`disk-usage-visualizer` do all category-specific logic in plugin JS against generic backend
primitives like `scanDirectory`/`hashFiles`), the backend stays generic — it doesn't know about
"Temp Files" or "Chrome Cache" as concepts. All eight concrete paths are computed in the plugin's
own JS from two new commands:

```rust
// crates/filesystem/src/known_folders.rs (new)
pub enum KnownFolder { Temp, LocalAppData, RoamingAppData, Home }

pub fn get_known_folder(folder: KnownFolder) -> Option<String> {
    match folder {
        KnownFolder::Temp => Some(std::env::temp_dir().to_string_lossy().to_string()),
        KnownFolder::LocalAppData => dirs::data_local_dir().map(|p| p.to_string_lossy().to_string()),
        KnownFolder::RoamingAppData => dirs::data_dir().map(|p| p.to_string_lossy().to_string()),
        KnownFolder::Home => dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
    }
}
```

The Tauri command takes a `String` (`"temp"` / `"local_app_data"` / `"roaming_app_data"` /
`"home"`) and maps it to the enum, returning an error for any other value — this is the actual
security boundary: a plugin can only ever resolve one of these four fixed identifiers, never an
arbitrary environment variable name, so there's no way to use this to read something sensitive
like an API-key env var. Returns `Option<String>` (`null` over IPC) rather than erroring when a
folder can't be resolved, so the UI can show "unavailable" for that one category without failing
the whole scan.

`dirs::data_local_dir()`/`dirs::data_dir()`/`dirs::home_dir()` are the same `dirs` crate already
used by `crates/filesystem/src/home.rs`'s `default_start_path` — no new dependency.

```rust
// crates/filesystem/src/trash_bin.rs (extends the existing module from the Recycling Bin plugin)
pub fn delete_entries(paths: &[String]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Could not delete entries: {e}"))
}
```

Sends every path in one call via the `trash` crate's `delete_all` (confirmed to exist in the
same `trash` v5.2.6 already vendored for this project, alongside the `delete`/`os_limited` API
the Recycling Bin plugin already uses) instead of one round-trip per file — important since a
temp folder can hold thousands of entries, and per-file IPC calls would be both slow and (for a
very large folder) a large-message-count risk similar to the search/scan memory issues fixed
earlier this session.

Two new Tauri commands, thin wrappers matching the existing style:

- `get_known_folder(folder: String) -> Result<Option<String>, String>`
- `delete_entries(paths: Vec<String>) -> Result<(), String>`

## New plugin permissions

- **`system.paths`** (new) → `api.getKnownFolder(folder: string): Promise<string | null>`. A
  new, minimal permission — distinct from `nav.read` (which is about the active tab's navigation
  state, not fixed system locations).
- **`fs.trash`** (existing, extended) → adds `api.deleteEntries(paths: string[]): Promise<void>`.
  Fits the existing permission's meaning: `fs.trash` already covers listing/restoring/purging/
  emptying the Recycle Bin; `deleteEntries` is just the "put these paths into the bin" direction,
  alongside the existing "manage what's already in the bin" methods.

## Frontend: `examples/plugins/clear-unnecessary-files/`

A new example plugin, structured like the existing ones (`manifest.json` declaring `ui.sidebar`,
`system.paths`, `fs.trash`, `ui.confirm`, `fs.list`; `frontend/index.js`; `README.md`).

Sidebar panel:

- A **Scan** button. For each of the 8 concrete category paths (Temp Files is 1 path; Chrome
  Cache and Edge Cache are 1 path each; Explorer Thumbnail Cache is 1 path filtered by filename;
  the 4 dev tool caches are 1 path each), computes the path via `getKnownFolder` + a fixed
  suffix hardcoded in the plugin JS (e.g. `localAppData + "\\Google\\Chrome\\User Data\\Default\\Cache"`),
  then calls `listDirectory` on it to get immediate children (files and subfolders). The
  Thumbnail Cache category filters the listing to entries matching `thumbcache_*.db`. A category
  whose base path is `null` (unresolvable) or doesn't exist shows "Not found" and is excluded
  from selection.
- One row per category: checkbox, name, one-line description, and once scanned, an item count
  and total size (e.g. "1,204 items — 340 MB") computed by summing the listed entries' sizes.
  Categories are grouped under sub-headings ("System", "Browsers", "Developer Tools") for
  readability, since there are 8 rows total (Temp, Chrome, Edge, Thumbnail Cache, npm, Yarn, pip,
  Cargo).
- A **Clean Selected** button, enabled once at least one category with a nonzero item count is
  checked. Clicking it calls `api.confirm()` with a summary message ("Move 1,532 items (~412 MB)
  across 3 categories to the Recycle Bin?"), and only on confirmation calls `deleteEntries` once
  with every selected category's immediate-child paths concatenated into a single array, then
  re-runs the scan to refresh all category rows (including unselected ones, in case anything
  changed externally).

Every delete goes to the Recycle Bin — there's no "permanent delete" option in this plugin,
keeping it in the same safety tier as the Recycling Bin plugin. A user who wants a category's
files back can use the Recycling Bin plugin to restore them, same as any other deleted file.

## Testing

- `get_known_folder`: real automated tests. Unlike `delete_entries`, this function only resolves
  paths — no filesystem writes, no OS Recycle Bin interaction — so it's safe to test the same way
  `crates/filesystem/src/home.rs`'s existing `default_start_path_returns_non_empty_path` test
  does (assert each known identifier resolves to a non-empty path on the CI/dev machine, and an
  unknown identifier is rejected).
- `delete_entries`: **no automated tests**, following the same precedent as `delete_entry` and
  the Recycling Bin plugin's trash functions (`purge_trash_item`, `empty_trash`) — it moves real
  files into the real Windows Recycle Bin, and the `trash` crate has no fake/injectable trash
  directory to redirect that into. Verified by hand instead.
- The plugin's own `frontend/index.js`: no automated tests, per this codebase's established
  convention for example plugin entry files.

## Out of scope for this pass

- Pattern-based scanning of an arbitrary user-chosen folder (a different feature).
- Firefox cache (non-deterministic profile-folder path).
- System-level locations requiring elevation (Windows Update download cache, Prefetch, etc.) —
  those need the same admin/UAC flow `ui.terminal`'s `openElevatedTerminal` already established,
  and mixing an elevation prompt into this otherwise-elevation-free plugin is a bigger design
  question better deferred to its own pass if ever needed.
- A "permanent delete, skip the Recycle Bin" option for very large caches — always goes through
  the Recycle Bin for this plugin, per the approved design.
