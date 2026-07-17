# Terminal

Sidebar panel with a single "Open Terminal" button that opens a detached terminal window — a
real interactive shell (PowerShell/cmd on Windows, `$SHELL` elsewhere) with tabs, full ANSI
color/cursor support, and live keystroke input. The first tab opens in the folder you're
currently browsing; tabs opened afterward from the terminal window's own "+" button start in
your home directory.

The terminal itself is core-app functionality, not sandboxed plugin code — see
`docs/plugins.md`'s "Terminal window" section for why. This plugin is just the trigger.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — tracks the current folder, to open the first terminal tab there.
- `ui.terminal` — opens the detached terminal window. **No sandboxing beyond that window
  boundary** — once open, it's a real shell with the app's own OS permissions, same trust level
  `system.exec` always had.
