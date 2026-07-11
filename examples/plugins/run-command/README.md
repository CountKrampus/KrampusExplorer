# Run Command

Sidebar panel for running a single shell command in the folder you're currently browsing and
viewing its stdout/stderr and exit code. A deliberately scoped-down "Terminal" — one command in,
output out, no interactive shell session.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — tracks the current folder as the command's working directory.
- `system.exec` — runs the command via `cmd /C` (Windows) or `sh -c` (elsewhere) with the app's
  own OS permissions. **No sandboxing.** Only grant this permission to plugins you trust
  completely — it can do anything the app itself can do.
