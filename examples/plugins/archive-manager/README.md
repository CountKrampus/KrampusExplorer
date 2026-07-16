# Archive Manager

Sidebar panel for zipping and unzipping files without leaving the app, plus two right-click
context menu entries for the common one-shot cases.

## Sidebar panel

One Source/Destination pair with a Compress/Extract mode toggle above it — switching modes
relabels the fields and the action button instead of showing two separate sections at once.

- **Compress**: pick a file or folder (pre-filled from your current selection) and a
  destination `.zip` path, then click "Create Archive".
- **Extract**: pick a `.zip` file and a destination folder, then click "Extract Archive".

## Context menu

- **Compress to .zip** — right-click a folder, zips it into a sibling `<foldername>.zip` next
  to it. Shown for every entry, but only acts on folders (files show a message pointing at the
  sidebar panel instead).
- **Extract Here** — right-click a `.zip` file, extracts it into a sibling
  `<filename>\` folder next to it (matches Windows Explorer's own "Extract Here"). Shown for
  every entry, but silently does nothing if the clicked entry isn't a `.zip` file.

## Command palette

- **Compress Selected to .zip** — zips the currently selected file/folder into a sibling
  `<name>.zip`, same as the sidebar panel's Compress mode but reachable via `Ctrl+K`.

## Permissions

- `ui.sidebar` — registers the panel.
- `ui.contextMenu` — registers the "Compress to .zip" and "Extract Here" context menu entries.
- `nav.read` — pre-fills source fields from the currently selected file/folder.
- `fs.archive` — create and extract zip archives.
- `commands.register` — registers the "Compress Selected to .zip" command.
