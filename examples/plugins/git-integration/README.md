# Git Integration

Sidebar panel that shows `git status` and recent `git log` for the folder you're currently
browsing. Updates automatically as you navigate.

If the current folder isn't inside a git working tree (or `git` isn't on PATH), the panel shows
the error message instead of status/log output.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — tracks the current folder as you navigate.
- `git.read` — runs `git status --porcelain` and `git log` in that folder. Requires a `git`
  executable on PATH.
