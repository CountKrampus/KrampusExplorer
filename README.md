# Krampus Explorer

A modern, lightweight, fast, extensible file explorer for Windows, built with a plugin-first
architecture. The core application handles only filesystem interaction, window management,
search, preview, settings, and plugin loading — everything else is a plugin.

See [Plan.md](Plan.md) for the full vision, architecture, and roadmap.

## Features

- **Tabbed browsing** with back/forward/up navigation and a sidebar of drives and favorites.
- **File operations**: rename, delete (to Recycle Bin), new folder/file, copy, move, drag &
  drop, with a conflict dialog (replace / keep both / cancel) when a destination name collides,
  and a progress indicator for large transfers.
- **Search**: indexed, filterable by name, type, size range, and modified date, with search
  history and saved searches.
- **Preview**: images, text/code (with syntax-agnostic rendering), Markdown, PDF, audio, and
  video, shown alongside the file list.
- **Settings**: light/dark/system theme, custom accent color, configurable startup folder (home,
  last-opened, or a custom path), icon size, and per-plugin enable/disable toggles.
- **Plugins**: a permissioned JS plugin SDK — sidebar panels, toolbar buttons, context menu
  items, custom file-type previews, and more. See [docs/plugins.md](docs/plugins.md).

## Included example plugins

`examples/plugins/` has nine working plugins demonstrating the SDK:

| Plugin | What it does |
|---|---|
| [archive-manager](examples/plugins/archive-manager) | Zip/unzip files and folders from the sidebar |
| [database-browser](examples/plugins/database-browser) | Browse SQLite files or a MongoDB server, with a mode toggle |
| [git-integration](examples/plugins/git-integration) | Shows `git status`/`git log` for the folder you're browsing |
| [mtg-collection-manager](examples/plugins/mtg-collection-manager) | Tracks a Magic: The Gathering card collection via the Scryfall API |
| [terminal](examples/plugins/terminal) | Opens a detached, tabbed terminal window with a real interactive shell |
| [duplicate-finder](examples/plugins/duplicate-finder) | Finds duplicate files by content hash, grouped with wasted-space totals |
| [disk-usage-visualizer](examples/plugins/disk-usage-visualizer) | Recursive size breakdown of a folder's immediate children |
| [checksum-verifier](examples/plugins/checksum-verifier) | Computes MD5/SHA-1/SHA-256 and checks against a pasted checksum |
| [batch-rename](examples/plugins/batch-rename) | Find/Replace renaming for a folder's contents, with live preview |

Install one via Settings → Plugins → "Browse Marketplace" (no restart needed), or copy a
plugin's folder into your plugins directory (`%APPDATA%\Krampus Explorer\plugins\`) manually.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Open the command palette |
| `Click` | Select a single item |
| `Ctrl+Click` | Toggle one item in/out of the selection |
| `Shift+Click` | Select a contiguous range from the last-clicked item |
| `Ctrl+A` | Select every item in the current folder |
| `Escape` | Clear the selection (or close the open dialog) |
| `F2` | Rename the selected item (only when exactly one item is selected) |
| `Delete` | Move the selected item(s) to Recycle Bin |
| `Ctrl+C` | Copy the selected item(s) |
| `Ctrl+X` | Cut the selected item(s) |
| `Ctrl+V` | Paste — transfers every clipboard item one at a time |
| `Ctrl+drag` | Copy instead of move when dropping |
| `Arrow Up`/`Down` | Move a single selection in the file list |
| `Enter` | Open the selected folder |

## Stack

- **Core:** Rust
- **Desktop shell:** Tauri 2
- **Frontend:** React + TypeScript + Vite

## Project Structure

```
apps/desktop/       Tauri application (Rust backend + React frontend)
crates/
  core/              Reserved for application lifecycle/event bus/shared models (currently a stub — not yet needed)
  filesystem/        Directory listing, file operations
  search/            Indexing, filters, search history, saved searches
  preview/           Text preview reading (image/PDF/audio/video go through the asset protocol)
  plugins/           Plugin loading, permissions, archive/database/git/exec capabilities
  settings/          Config, themes, user preferences
examples/plugins/    Example plugins demonstrating the SDK (see table above)
assets/              App icon source art and stashed plugin-idea icons
docs/                Project documentation (plugin SDK reference, performance notes)
```

## Running from source

**Prerequisites:**

- [Rust](https://www.rust-lang.org/tools/install) (stable, MSVC toolchain on Windows)
- [Node.js](https://nodejs.org/) 20+ and npm
- Platform build dependencies for Tauri — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

```sh
cd apps/desktop
npm install
npm run tauri dev
```

## Building

```sh
cd apps/desktop
npm run tauri build
```

Produces an unsigned local MSI/NSIS installer under
`apps/desktop/src-tauri/target/release/bundle/`. Signed releases are published automatically by
CI on tag push — see [docs/releasing.md](docs/releasing.md) for the full release process and how
auto-update is wired up.

## Workspace checks

```sh
cargo check --workspace
cargo clippy --workspace --all-targets
cargo fmt --all
cargo test --workspace

cd apps/desktop
npm test
npm run build
```

## Status

Actively developed. Phases 1–7 of the [roadmap](Plan.md#roadmap) (foundation, application
shell, filesystem, search, preview, settings, and the plugin SDK) are complete; Phase 8
(polish, optimization, testing, documentation, release builds) is in progress — see
[docs/performance.md](docs/performance.md) for performance notes and
[docs/releasing.md](docs/releasing.md) for the build/release process.

## License

MIT — see [LICENSE](LICENSE).
