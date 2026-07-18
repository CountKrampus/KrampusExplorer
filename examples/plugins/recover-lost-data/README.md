# Recover Lost Data

Sidebar panel that scans a chosen drive's raw bytes for recognizable file signatures (JPEG, PNG,
PDF, ZIP, MP3) and extracts matches into a destination folder, for recovering files deleted
outside the Recycle Bin. Requires Administrator elevation (a UAC prompt appears when you click
Start Scan) since raw sector-level disk reads aren't available through normal file APIs.

This is signature-based carving, not filesystem-aware recovery: recovered files lose their
original names and folder structure (saved as `recovered_0001.jpg`, etc., in per-type
subfolders), and success depends on whether the original data has been overwritten since
deletion. The scan itself is read-only on the source drive -- there's no data-loss risk from
running it, only the time it takes and the disk space recovered files use at the destination.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.recover` — starts the elevated scan and polls its progress.
- `ui.confirm` — confirms the target drive and estimated duration before starting.
- `nav.read` — pre-fills the destination field with the current folder.
