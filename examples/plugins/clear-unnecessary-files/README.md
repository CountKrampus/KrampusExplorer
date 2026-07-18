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
