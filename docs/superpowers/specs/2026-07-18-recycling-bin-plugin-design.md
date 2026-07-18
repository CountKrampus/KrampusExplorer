# Recycling Bin Plugin — Design

## Goal

Let a plugin browse, restore, permanently delete, and empty the Windows Recycle Bin from within
Krampus Explorer. First of five requested plugins (Recycling Bin, Clear Unnecessary Files,
Recover Lost Data, Drive Format, Secure Wipe), sequenced safest-to-riskiest — this one is the
safest: everything it does is already reversible-by-design except two explicitly-confirmed
actions (permanent delete, empty bin), and it builds entirely on infrastructure the app already
has (the `trash` crate, already a dependency used by regular delete-to-recycle-bin).

## Backend: `crates/filesystem/src/trash_bin.rs`

A new module wrapping the `trash` crate's `os_limited` submodule (list/restore/purge trashed
items) — the exact API surface (struct field names, whether an extra Cargo feature flag is
needed) gets confirmed against the real, currently-installed crate version during
implementation, the same way this session has handled every other new-dependency integration
(e.g. discovering `@types/react-window` was needed only after actually building against it).

Four new Tauri commands, thin wrappers matching the existing `delete_entry` command's style:

- `list_trash_items() -> Result<Vec<TrashItem>, String>` — name, original parent folder, size (if
  available), and deletion timestamp for everything currently in the bin.
- `restore_trash_item(id: String) -> Result<(), String>` — puts one item back at its original
  location.
- `purge_trash_item(id: String) -> Result<(), String>` — permanently deletes one item from the
  bin.
- `empty_trash() -> Result<(), String>` — permanently deletes everything in the bin.

`id` is whatever opaque identifier the `trash` crate's own `TrashItem` type uses internally
(platform-specific on Windows, not a plain path) — serialized as a string over IPC, not
interpreted or parsed on the frontend, just round-tripped back into `restore_trash_item`/
`purge_trash_item` verbatim.

## New plugin permission: `fs.trash`

Grants `api.listTrashItems()`, `api.restoreTrashItem(id)`, `api.purgeTrashItem(id)`,
`api.emptyTrash()` — added to the `fs.*` permission family alongside `fs.scan`/`fs.list`/
`fs.rename`/`fs.archive`, same naming convention.

## New primitive: `api.confirm()`, gated behind a new `ui.confirm` permission

Plugin entry files are sandboxed plain-DOM JS (`new Function`, no React), so they can't literally
render the core app's existing `ConfirmDialog` React component directly. Instead, this adds a
generic, reusable confirmation primitive any plugin can request:

```ts
api.confirm(message: string): Promise<boolean>
```

Implemented the same way `useToastStore`/`showToast` already works — one global store, one
component instance rendered once at the app root:

- `apps/desktop/src/stores/useConfirmStore.ts` (new) — holds at most one pending confirmation
  request (`{ message: string } | null`) and a `requestConfirm(message): Promise<boolean>` action
  that stores the request and returns a `Promise` whose resolver is stashed until the user
  responds.
- A single `<ConfirmDialog>` instance (the existing, unmodified component) is mounted once at the
  app root (in `App.tsx`), reading from `useConfirmStore` — when a plugin calls `api.confirm()`,
  this is the dialog that actually appears, so it's pixel-identical to every other confirmation
  in the app.
- `pluginApi.ts` gains `confirm: (message: string) => Promise<boolean>` gated behind `ui.confirm`,
  wired in `usePluginStore.ts` to call `useConfirmStore.getState().requestConfirm(message)`.

`ui.confirm` is a separate permission from `fs.trash` because it's not filesystem-specific — any
future plugin needing a yes/no prompt before a destructive action (this design doc's later
Drive Format and Secure Wipe plugins will both want it) can request it independently.

**Out of scope:** refactoring `FileList.tsx`'s existing local `ConfirmDialog` usage (for regular
delete-to-recycle-bin) onto the new shared store. It already works as a self-contained local
`useState` + conditional render; there's no need to touch working code to serve this feature.

## Frontend: `examples/plugins/recycling-bin/`

A new example plugin, structured like the existing ones (`manifest.json` declaring
`ui.sidebar`, `fs.trash`, `ui.confirm`; `frontend/index.js`; `icon.png`; `README.md`).

Sidebar panel:

- A "Refresh" button (bin contents aren't watched live, matching every other plugin's
  on-demand-scan pattern — no filesystem watcher exists anywhere in this codebase).
- A list of trashed items: name, original location, size, deletion date.
- Per-item **Restore** and **Delete Forever** buttons. Delete Forever calls `api.confirm()` first
  (`"Permanently delete '<name>'? This cannot be undone."`), then `purgeTrashItem` only if
  confirmed.
- An **Empty Recycle Bin** button (disabled when the bin is already empty), calling `api.confirm()`
  first (`"Permanently delete all N items in the Recycle Bin? This cannot be undone."`), then
  `emptyTrash` only if confirmed.
- After any restore/purge/empty action, the list refreshes automatically (re-calls
  `listTrashItems()`).

## Testing

- Rust: **no automated tests for the trash-interaction functions themselves.** The existing
  `delete_entry` (`crates/filesystem/src/operations.rs`), which already wraps `trash::delete`,
  has zero automated tests — deliberately, since exercising it for real deletes actual files into
  the user's real Windows Recycle Bin on every `cargo test` run, and the `trash` crate has no
  fake/injectable trash directory to redirect that into. The four new functions
  (`list_trash_items`/`restore_trash_item`/`purge_trash_item`/`empty_trash`) follow the same
  precedent for the same reason — verified by hand instead (see the plugin's own manual
  verification below). Any pure, non-trash-touching logic extracted from these functions (e.g. a
  standalone `find_by_id` helper, if one is written as a separate function) can still get a real
  unit test if it doesn't require calling into the `trash` crate itself.
- `useConfirmStore`: unit tests for the request/resolve state machine (pure store logic, no DOM).
  `useToastStore` (the closest existing analog — also a global store backing a single rendered
  component) has no test file, but its behavior is a trivial timer side effect; `useConfirmStore`
  has real logic worth covering (a pending-request field plus a promise resolved by a later
  action), closer in shape to the three stores that *do* have tests
  (`usePluginStore.test.ts`/`useExplorerStore.test.ts`/`useSettingsStore.test.ts`) — follow their
  pattern, not `useToastStore`'s absence of one.
- The plugin's own `frontend/index.js`: no automated tests, per this codebase's established
  convention for example plugin entry files (verified by hand instead).

## Out of scope for this pass

- Any change to the regular delete-to-recycle-bin flow (`delete_entry`, `FileList.tsx`) beyond
  what's needed for the new commands to coexist alongside it.
- Filtering/searching within the Recycle Bin listing.
- Restoring multiple items at once (one at a time, matching the per-row button model).
