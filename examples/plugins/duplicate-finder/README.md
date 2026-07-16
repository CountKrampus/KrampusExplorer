# Duplicate File Finder

Sidebar panel that recursively scans a folder, groups files by size, then hashes only the
same-size candidates (BLAKE3) to find true duplicates — avoiding hashing every file when most
files have a unique size and can't possibly be duplicates of anything.

## Sidebar panel

Enter (or use the pre-filled current folder) and click "Scan for Duplicates". Each duplicate
group shows how many copies exist, their shared size, and a "Copy paths" button (copies all
paths in that group, newline-separated, to the clipboard) so you can act on them — there's no
in-app delete here, since the plugin SDK doesn't currently expose a delete capability to plugins.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the scan root from the current folder and keeps it in sync as you
  navigate.
- `clipboard.write` — "Copy paths" button.
- `fs.scan` — recursive directory walk (`scanDirectory`) and content hashing (`hashFiles`).
