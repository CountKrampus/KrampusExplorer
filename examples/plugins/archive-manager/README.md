# Archive Manager

Sidebar panel for zipping and unzipping files without leaving the app.

- **Compress**: pick a file or folder (pre-filled from your current selection) and a
  destination `.zip` path, then click "Create Archive".
- **Extract**: pick a `.zip` file and a destination folder, then click "Extract Archive".

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills source fields from the currently selected file/folder.
- `fs.archive` — create and extract zip archives.
