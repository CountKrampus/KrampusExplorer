# Terminal

Sidebar panel with two buttons that open a detached terminal window — a real interactive shell
(PowerShell/cmd on Windows, `$SHELL` elsewhere) with tabs, full ANSI color/cursor support, and
live keystroke input. The first tab opens in the folder you're currently browsing; tabs opened
afterward from the terminal window's own "+" button start in your home directory.

- **Open Terminal** — opens the normal, non-elevated terminal window.
- **Open Terminal (Admin)** — opens a separate, fully elevated (Administrator) terminal window.
  This triggers a Windows UAC prompt every time it's opened. The elevated window is its own OS
  process, entirely disconnected from the main app once it's up — it isn't a privileged channel
  back into the app or the plugin sandbox. Elevation applies to the whole window, not individual
  tabs: every tab in an elevated window runs elevated, and there's no way to open a mixed window
  with some elevated tabs and some not.

The terminal itself is core-app functionality, not sandboxed plugin code — see
`docs/plugins.md`'s "Terminal window" section for why. This plugin is just the trigger.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — tracks the current folder, to open the first terminal tab there.
- `ui.terminal` — opens the detached terminal window, for both buttons. There's no separate
  permission scope for the elevated variant; a plugin that can open a terminal at all can prompt
  for an elevated one too. **No sandboxing beyond that window boundary** — once open, it's a real
  shell with the app's own OS permissions (or, for the Admin button, full Administrator
  permissions), same trust level `system.exec` always had.
