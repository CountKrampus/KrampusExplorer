# Secure Wipe

Sidebar panel that securely erases a drive with a single zero-fill pass over its raw bytes.
Requires Administrator elevation (a UAC prompt appears when you start a wipe). **Permanently and
irreversibly destroys all data on the drive.**

Unlike the Drive Format plugin, there is no native Windows dialog acting as a second safety
gate -- this plugin's own typed-drive-letter confirmation (you must type the exact drive letter,
e.g. "I", before the wipe button enables) is the real safety gate.

On SSDs, wear-leveling means an application-level overwrite like this cannot guarantee the old
data is truly unrecoverable -- for guaranteed SSD erasure, use the drive manufacturer's own
firmware-level secure-erase tool instead.

After wiping, the drive is left raw/unformatted (its filesystem structure was part of what got
overwritten). Use the Drive Format plugin afterward if you want to reuse the drive.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.format` — used only for `getSystemDrive`, to exclude it from the picker.
- `fs.wipe` — starts the elevated wipe and polls its progress.
