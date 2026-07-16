# Plugin ideas

Candidate plugins not covered by `Plan.md`'s "Not Included In MVP" list or the plugins already
built in `examples/plugins/`. None of these are planned or scheduled — just a backlog to pull
from.

## File organization & cleanup

- ~~**Duplicate File Finder**~~ — built, see `examples/plugins/duplicate-finder/`
- ~~**Disk Usage Visualizer**~~ — built (single-level breakdown, not a full treemap), see
  `examples/plugins/disk-usage-visualizer/`
- **Folder Size Analyzer** — quick per-folder size totals, lighter weight than the treemap
- ~~**Batch Rename**~~ — built (operates on a whole folder, no multi-select yet), see
  `examples/plugins/batch-rename/`
- **File Tagging/Labels** — cross-folder tags independent of location, searchable
- **File Notes** — attach freeform notes to a specific file or folder
- **Smart Collections** — saved dynamic filters ("all PSDs modified this week") like smart playlists
- **Downloads Auto-Organizer** — sort a watched folder by rules (type, date, source)
- **Folder Comparison** — diff two folder trees, show added/removed/changed files
- **Folder Synchronization** — two-way sync between two folders, distinct from the one-way
  Backup/Mirror Scheduler below
- **File Version History** — snapshot a file's past versions and restore/diff them

## Media & documents

- **Bulk Image Converter/Resizer** — batch webp/png/jpg conversion
- **EXIF Viewer/Editor** — photo metadata, separate from the generic preview
- **PDF Toolkit** — merge/split/rotate/compress, distinct from the read-only PDF preview
- **Font Previewer** — browse a folder of font files, live text preview per font
- **Spreadsheet/CSV Quick View** — grid view without opening Excel
- **E-book Library** — browse/organize epub/mobi with cover art
- **E-book Reader** — actually render/read epub/mobi in-app, not just organize
- **Office Document Preview** — read-only render for docx/xlsx/pptx

## 3D & CAD

- **3D Model Preview** — STL/3MF/OBJ/GLTF viewer with orbit/zoom
- **CAD/STEP Viewer** — preview STEP and other CAD interchange formats
- **PCB Viewer** — preview Gerber/PCB design files
- **STL Repair** — detect and fix non-manifold geometry, holes, inverted normals
- **G-Code Viewer** — visualize toolpaths and layer preview for sliced prints
- **Mesh Statistics** — polygon count, volume, bounding box, printability warnings
- **Filament Calculator** — estimate material usage/cost from a model or G-code file
- **Print Time Estimator** — estimate print duration from G-code
- **OpenSCAD Runner** — render `.scad` files without opening OpenSCAD
- **Slicer Launcher** — open a model directly in PrusaSlicer, Bambu Studio, or Cura
- **Model Library** — organize/tag/preview a personal 3D model collection

## Developer tools

- **Kubernetes Explorer** — browse pods/deployments/services for a configured cluster
- **GitHub Integration** — PRs, issues, and Actions status for the repo you're browsing
  (distinct from the existing git-integration plugin, which only shows local status/log)
- **GitLab Integration** — same, for GitLab-hosted repos
- **REST API Client** — Postman-style request builder, saved requests
- **GraphQL Explorer** — schema browser + query runner
- **JSON Formatter** — pretty-print/validate/diff JSON files
- **YAML Editor** — schema-aware editing for YAML config files
- **Regex Tester** — standalone pattern tester with live match highlighting
- **Regex Content Search** — grep-style search across file contents, not just names
- **Environment Variable Manager** — view/edit `.env` files and system env vars
- **PostgreSQL Browser** — table browser, distinct from the existing SQLite/MongoDB support
- **MySQL Browser** — same, for MySQL/MariaDB
- **Redis Explorer** — browse keys, inspect values, TTLs
- **Snippet Library** — save and insert reusable code snippets
- **Secret Scanner** — scan a folder for accidentally-committed credentials/keys
- ~~**Command Palette**~~ — built as a core feature (`Ctrl+K`), with a `commands.register`
  plugin permission. See `docs/plugins.md`.

## Server & remote management

- **VPS Manager** — track and connect to a list of remote servers
- **System Monitor** — CPU/RAM/disk graphs, local or over SSH
- **Log Viewer** — tail/filter/search log files, local or remote
- **Service Manager** — start/stop/inspect Windows services
- **Remote File Sync** — rsync-over-SSH style sync to a remote host
- **Cron Job Editor** — edit scheduled tasks (Windows Task Scheduler / cron)
- **Local File Server** — spin up a temp HTTP server to share a folder over LAN
- **Network Drive Manager** — mount/unmount SMB/NFS shares from the UI

## AI-assisted tools

- **Ollama Local AI** — chat against a locally-running model, no cloud dependency
- **Code Explainer** — summarize/explain a selected source file
- **File Summarizer** — summarize a document, PDF, or transcript
- **Documentation Generator** — draft README/docstrings for a selected file or folder
- **Commit Message Generator** — draft a commit message from staged changes
- **Project Planner** — turn a rough description into a task breakdown
- **Prompt Library** — save/organize reusable prompts
- **AI File Search** — semantic ("find the invoice from that plumber") rather than filename search

## Security & integrity

- ~~**Checksum/Hash Verifier**~~ — built, see `examples/plugins/checksum-verifier/`
- **Encrypted Vault** — password-protect a folder, transparent encrypt/decrypt
- **VirusTotal Lookup** — check a file's hash against VirusTotal
- **Malware Hash Database** — offline known-malware hash check, no network required
- **Digital Signature Checker** — verify Authenticode/GPG signatures on a file
- **Certificate Viewer** — inspect `.pem`/`.crt`/`.pfx` certificate details
- **Permission Analyzer** — visualize/audit Windows ACLs on a file or folder
- **File Integrity Monitor** — alert when watched files change unexpectedly
- **Password Vault** — local encrypted credential store
- **Secure Delete** — overwrite-then-delete, distinct from the Encrypted Vault
- **Folder Lock** — simple access restriction on a folder, no encryption

## Power-user tools

- **Symlink/Junction Manager** — create and inspect symlinks/junctions from the UI
- **Backup/Mirror Scheduler** — rsync-style one-way folder sync on a schedule
- **Workspace Sessions** — save/restore a set of open tabs and folders
- **Clipboard History** — browse and re-paste from recent clipboard entries
- **Keyboard Macro Recorder** — record and replay a sequence of actions

## Magic: The Gathering suite

Could become one of Krampus Explorer's signature plugin suites, alongside the existing
`mtg-collection-manager` example plugin.

- **Deck Builder** — build/edit decks against the tracked collection
- **Deck Import/Export** — common deck-list formats (Moxfield, Archidekt, plaintext)
- **Mana Curve Analyzer** — visualize a deck's curve and color balance
- **Collection Scanner** — bulk camera/OCR-based card entry
- **Proxy Generator** — printable proxy sheets for a deck list
- **Token Creator** — generate custom token cards
- **Commander Statistics** — win rate/matchup tracking for a Commander deck
- **Cube Manager** — build and maintain a cube list
- **Trade Binder** — track cards available/wanted for trade

## Productivity

- **Markdown Notes** — standalone note-taking, not tied to a specific file
- **Kanban Board** — lightweight task board
- **Calendar** — simple calendar/agenda view
- **Pomodoro Timer** — focus timer in the toolbar/sidebar
- **Project Dashboard** — at-a-glance status for a tracked project folder

## Fun & community

- **Plugin Marketplace** — discover/install plugins from within the app
- **Theme Marketplace** — share/install community themes
- **Icon Pack Manager** — swap file-type icon sets
- **Startup Dashboard** — a landing view with recent folders/favorites/stats on launch
- **Wallpaper Manager** — set desktop wallpaper directly from an image file
- **Ambient Coding Sounds** — background ambience while browsing/working
- **Achievement System** — lighthearted usage milestones
- **Krampus Theme Pack** — a branded default theme/icon set
