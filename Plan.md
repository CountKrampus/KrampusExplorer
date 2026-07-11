# Krampus Explorer

## Master Development Plan

**Version:** 0.1.0
**Status:** Planning
**Primary Language:** Rust
**Desktop Framework:** Tauri 2
**Frontend:** React + TypeScript + Vite
**License:** MIT (recommended)

---

# Vision

Krampus Explorer aims to be a modern, lightweight, fast, extensible file explorer.

The application is intentionally designed around a **plugin-first architecture**. The core application is responsible only for filesystem interaction, window management, search, settings, and plugin loading.

Everything else is optional.

The long-term goal is to create a professional desktop application that remains lightweight while allowing users to customize functionality through plugins.

---

# Core Philosophy

## The Core Exists Only To Manage Files

The core application should never contain feature-specific tools.

Instead, the core should expose services that plugins can consume.

Examples:

* Filesystem API
* Search API
* Thumbnail API
* Window API
* Theme API
* Settings API
* Notifications
* Context Menus
* Toolbar Registration
* Sidebar Registration
* Command Palette Registration

Every advanced feature should be implemented as a plugin.

---

# Design Goals

* Fast startup
* Low memory usage
* Cross-platform
* Native performance
* Clean UI
* Keyboard friendly
* Highly customizable
* Modular architecture
* Stable plugin API
* Open source

---

# MVP Goals

The MVP should be suitable for daily use.

## Navigation

* Drive selector
* Folder tree
* Breadcrumb navigation
* Address bar
* Back
* Forward
* Up directory
* Refresh
* Tabs
* Recent folders
* Favorites

---

## File Operations

* Open
* Copy
* Move
* Rename
* Delete
* Permanent Delete
* Duplicate
* New Folder
* New File
* Drag & Drop
* Progress Dialog
* Conflict Resolution

---

## Viewing

* Details View
* List View
* Large Icons
* Small Icons
* Sort
* Group
* Filter
* Hidden Files Toggle

---

## Search

* Filename Search
* Recursive Search
* Filter by Type
* Filter by Date
* Filter by Size
* Search History
* Saved Searches

---

## Preview

Supported previews:

* Images
* Plain Text
* Markdown
* PDF
* Audio Metadata
* Video Metadata

---

## Settings

* Theme
* Accent Color
* Startup Folder
* Keyboard Shortcuts
* Plugin Management
* Icon Size
* Language Support

---

# Not Included In MVP

These features belong in plugins.

* Terminal
* Code Editor
* Git
* FTP
* SFTP
* SSH
* AI Assistant
* Archive Manager
* Image Editor
* Media Player
* Hex Editor
* Database Browser
* Docker Tools
* MTG Collection Manager
* Server Manager

---

# Architecture

```
Application
│
├── Core
│
├── Filesystem
│
├── Search
│
├── Settings
│
├── Theme Manager
│
├── Window Manager
│
├── Event Bus
│
├── Plugin Manager
│
└── UI
```

---

# Plugin Architecture

Each plugin contains:

```
plugin/
│
├── manifest.json
├── icon.png
├── frontend/
├── backend/
└── README.md
```

---

# Plugin Manifest

Example

```json
{
  "id": "image-viewer",
  "name": "Image Viewer",
  "version": "1.0.0",
  "author": "Developer",
  "permissions": [
    "filesystem.read"
  ]
}
```

---

# Plugin Capabilities

Plugins may register:

* Sidebar Panels
* Toolbar Buttons
* Context Menu Items
* File Type Handlers
* Commands
* Settings Pages
* Background Services
* Notifications

Plugins should never modify core functionality directly.

---

# Project Structure

```
krampus-explorer/

apps/
    desktop/

crates/
    core/
    filesystem/
    search/
    preview/
    plugins/
    settings/

plugins/

docs/

assets/

scripts/

.github/
```

---

# Rust Crates

## core

Responsible for:

* Application lifecycle
* Event bus
* Shared models
* Logging

---

## filesystem

Responsible for:

* Directory listing
* Copy
* Move
* Delete
* Rename
* Metadata
* File watching

---

## search

Responsible for:

* Indexing
* Search filters
* Search history

---

## preview

Responsible for:

* Preview generation
* Thumbnail cache

---

## plugins

Responsible for:

* Plugin loading
* Permissions
* Lifecycle
* API

---

## settings

Responsible for:

* Config
* Themes
* User preferences

---

# Frontend Structure

```
src/

components/

pages/

sidebar/

explorer/

tabs/

preview/

settings/

hooks/

stores/

types/
```

---

# UI Layout

```
+------------------------------------------------------------+

Toolbar

-------------------------------------------------------------

Sidebar

Folder Tree

Favorites

Drives

-------------------------------------------------------------

Explorer

Tabs

Breadcrumbs

File List

-------------------------------------------------------------

Preview Pane

-------------------------------------------------------------

Status Bar

+------------------------------------------------------------+
```

---

# Performance Goals

Startup

< 1 second

Directory loading

< 100ms

Search responsiveness

Instant where indexed

Memory

< 250 MB idle

---

# Coding Standards

Rust

* rustfmt
* clippy
* documented public APIs
* no unsafe unless required

Frontend

* TypeScript strict mode
* ESLint
* Prettier

---

# Roadmap

## Phase 1

Project Foundation

* Repository
* Build system
* CI
* Documentation

---

## Phase 2

Application Shell

* Window
* Sidebar
* Explorer
* Routing
* Theme

---

## Phase 3

Filesystem

* Listing
* Navigation
* File operations

---

## Phase 4

Search

* Index
* Filters
* Search UI

---

## Phase 5

Preview

* Images
* Text
* PDFs
* Metadata

---

## Phase 6

Settings

* Themes
* Shortcuts
* Preferences

---

## Phase 7

Plugin SDK

* Loader
* Manifest
* API
* Permissions
* Examples

---

## Phase 8

Version 1.0

* Polish
* Optimization
* Testing
* Documentation
* Release builds

---

# Guiding Principles

1. The core never knows what plugins exist.
2. Plugins communicate only through public APIs.
3. Everything should be asynchronous where possible.
4. Performance is more important than visual effects.
5. Simplicity beats unnecessary complexity.
6. Every major subsystem must be documented.
7. Public APIs must remain stable once released.
8. New features should be plugins unless they are essential to browsing and managing files.

---

# Long-Term Vision

Krampus Explorer should become a modular desktop platform centered around fast, reliable file management. Users should be able to install only the capabilities they need, keeping the core application lightweight while enabling an ecosystem of optional extensions ranging from media tools and cloud storage to custom workflows and domain-specific plugins.
