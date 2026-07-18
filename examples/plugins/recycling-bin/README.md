# Recycling Bin

Sidebar panel listing everything currently in the Windows Recycle Bin, with per-item Restore and
Delete Forever buttons, and an Empty Recycle Bin button. Delete Forever and Empty Recycle Bin both
show a confirmation dialog first — both are irreversible.

## Permissions

- `ui.sidebar` — registers the panel.
- `fs.trash` — lists, restores, and permanently deletes Recycle Bin items.
- `ui.confirm` — shows the app's own confirmation dialog before an irreversible action.
