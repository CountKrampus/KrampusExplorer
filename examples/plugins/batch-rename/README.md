# Batch Rename

Sidebar panel that renames every entry directly inside a folder (non-recursive) using a
Find/Replace pattern, with a live preview and collision detection before anything is actually
renamed on disk.

There's no multi-select in the core file list yet, so "batch" here means "every item in the
loaded folder," not a hand-picked subset — load a folder that only contains what you want to
rename, or use Find to target a subset of names within it.

## Sidebar panel

1. Enter (or use the pre-filled current folder) and click "Load Files".
2. Enter a **Find** pattern (leave blank to just apply the counter to every name unchanged) and
   a **Replace with** value. `{n}` in Replace is a zero-padded running counter (width sized to
   the item count). Check "Use regex" to treat Find as a regular expression — `$1`, `$2`, etc. in
   Replace refer to capture groups.
3. The preview table updates live as you type. Rows in red are name collisions (two files would
   end up with the same name, or a renamed file collides with one that isn't changing) — "Apply
   Rename" stays disabled until there are none.
4. Click "Apply Rename". Renames happen one at a time; the panel reloads the folder afterward so
   the preview reflects what's actually on disk, even if some renames failed partway through.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the folder from the current path and keeps it in sync as you navigate.
- `fs.list` — non-recursive folder listing (`listDirectory`).
- `fs.rename` — applies the renames (`renameEntry`).
