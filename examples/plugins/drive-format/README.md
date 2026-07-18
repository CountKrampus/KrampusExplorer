# Drive Format

Sidebar panel for formatting a drive. This plugin does not implement formatting itself -- it
hands off to Windows' own native Format dialog (`SHFormatDrive`), the same one you get
right-clicking a drive in File Explorer and choosing "Format...". Filesystem type, allocation
unit, volume label, and quick-vs-full-format are all chosen in that native dialog, not here.

**This is permanently destructive.** The drive picker excludes the system/boot drive, and
Windows itself independently refuses to format it too, but any other selected drive really will
have all of its data erased once you confirm both this plugin's warning and Windows' own dialog.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.format` — looks up the system drive (to exclude it) and opens the native Format dialog.
- `ui.confirm` — one explicit confirmation before the native dialog appears.
