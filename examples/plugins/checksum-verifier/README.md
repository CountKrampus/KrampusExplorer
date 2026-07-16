# Checksum Verifier

Sidebar panel that computes MD5, SHA-1, and SHA-256 of a file in one pass and lets you compare
against a checksum published elsewhere (e.g. a download page) — the algorithms most sites
actually publish, unlike the BLAKE3 hash the Duplicate File Finder plugin uses internally.

## Sidebar panel

Enter (or use the pre-filled current selection) and click "Compute Hashes". Each of the three
results has its own "Copy" button. Paste a published checksum into "Compare against" to get a
live match/no-match indicator (case-insensitive, checked against all three algorithms at once).

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the path from the current selection and keeps it in sync.
- `clipboard.write` — per-hash "Copy" buttons.
- `fs.scan` — computes the hashes (`hashFileAll`).
