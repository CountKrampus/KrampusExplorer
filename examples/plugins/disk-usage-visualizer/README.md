# Disk Usage Visualizer

Sidebar panel that recursively scans a folder and shows a single-level size breakdown — how much
space each immediate child (subfolder or loose file) uses, as a sorted, proportional bar list.
This is a lightweight breakdown, not a full nested treemap (the plugin renders with plain
DOM/CSS, no charting library) — drill into a subfolder and re-scan to go a level deeper.

## Sidebar panel

Enter (or use the pre-filled current folder) and click "Analyze". Each row shows a name, its
total size, percentage of the scanned total, and a proportional bar.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the scan root from the current folder and keeps it in sync as you
  navigate.
- `fs.scan` — recursive directory walk (`scanDirectory`).
