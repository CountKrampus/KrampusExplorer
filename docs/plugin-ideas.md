# Plugin ideas

Candidate plugins not covered by `Plan.md`'s "Not Included In MVP" list or the plugins already
built in `examples/plugins/`. None of these are planned or scheduled — just a backlog to pull
from.

## File organization & cleanup

- **Duplicate File Finder** — hash-based scan across folders, one-click cleanup
- **Disk Usage Visualizer** — treemap/sunburst of folder sizes (WinDirStat-style)
- **Batch Rename** — regex/pattern rules with a live preview before committing
- **File Tagging/Labels** — cross-folder tags independent of location, searchable
- **Downloads Auto-Organizer** — sort a watched folder by rules (type, date, source)

## Media & documents

- **Bulk Image Converter/Resizer** — batch webp/png/jpg conversion
- **EXIF Viewer/Editor** — photo metadata, separate from the generic preview
- **PDF Toolkit** — merge/split/rotate/compress, distinct from the read-only PDF preview
- **Font Previewer** — browse a folder of font files, live text preview per font
- **Spreadsheet/CSV Quick View** — grid view without opening Excel
- **E-book Library** — browse/organize epub/mobi with cover art

## Security & integrity

- **Checksum/Hash Verifier** — generate/compare MD5/SHA256, useful for downloads
- **Encrypted Vault** — password-protect a folder, transparent encrypt/decrypt

## Sharing & networking

- **Local File Server** — spin up a temp HTTP server to share a folder over LAN
- **Network Drive Manager** — mount/unmount SMB/NFS shares from the UI

## Power-user tools

- **Regex Content Search** — grep-style search across file contents, not just names
- **Command Palette** — `Ctrl+Shift+P` fuzzy launcher. The core already reserves an API for this
  (`Plan.md` lists "Command Palette Registration" as a core service), but it's never been built
  as an actual feature.
- **Symlink/Junction Manager** — create and inspect symlinks/junctions from the UI
- **Backup/Mirror Scheduler** — rsync-style one-way folder sync on a schedule
