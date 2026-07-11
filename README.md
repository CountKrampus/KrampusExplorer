# Krampus Explorer

A modern, lightweight, fast, extensible file explorer built with a plugin-first architecture. The core application handles only filesystem interaction, window management, search, settings, and plugin loading — everything else is a plugin.

See [Plan.md](Plan.md) for the full vision, architecture, and roadmap.

## Stack

- **Core:** Rust
- **Desktop shell:** Tauri 2
- **Frontend:** React + TypeScript + Vite

## Project Structure

```
apps/desktop/       Tauri application (Rust backend + React frontend)
crates/
  core/              Application lifecycle, event bus, shared models, logging
  filesystem/        Directory listing, file operations, watching
  search/            Indexing, filters, search history
  preview/           Preview generation, thumbnail cache
  plugins/           Plugin loading, permissions, lifecycle, API
  settings/          Config, themes, user preferences
plugins/             Installed/bundled plugins
docs/                Project documentation
```

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable, MSVC toolchain on Windows)
- [Node.js](https://nodejs.org/) 20+ and npm
- Platform build dependencies for Tauri — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Development

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

## Workspace Checks

```sh
cargo check --workspace
cargo clippy --workspace --all-targets
cargo fmt --all
```

## Status

Pre-alpha. Currently in Phase 1 (Project Foundation) of the [roadmap](Plan.md#roadmap).

## License

MIT — see [LICENSE](LICENSE).
