# Terminal Plugin (formerly "Run Command") — Design

## Goal

Replace the existing "Run Command" example plugin — which runs one shell command,
waits for it to exit, and dumps the captured stdout/stderr — with a real interactive
terminal: a detached window with tabbed PTY sessions, full ANSI/color/cursor support,
and live keystroke I/O. The plugin is renamed `run-command` → `terminal` throughout
(folder, manifest `id`/`name`, `marketplace.json` entry) since it's no longer a
single-command runner.

## Architecture

Today, every plugin panel renders into a `<div>` inside the main window's own JS
context (`render(container)`, executed via `new Function`). That model has no way to
open a new OS window with its own webview — doing so is a materially more powerful
capability (arbitrary new windows, raw PTY/process control) than anything the plugin
sandbox grants today.

Rather than adding a generic "a plugin can open an arbitrary detached webview and run
arbitrary code in it" primitive (a large, reusable, but much riskier addition to the
trust model), the terminal itself becomes a **first-class core-app feature** — the
same trust tier as Settings or the file explorer UI, not sandboxed plugin code. The
`terminal` plugin becomes a thin trigger: its sidebar panel has an "Open Terminal"
button that asks the core app to create/focus the terminal window. No PTY code, no
window-creation code, runs inside the plugin sandbox.

Opening the terminal while it's already open focuses the existing window rather than
creating a second one. The window supports multiple tabs, each an independent PTY
session.

```
Core app (trusted, not sandboxed)
├─ Terminal window (xterm.js UI, tab strip, PTY session lifecycle)
└─ New Tauri commands: open_terminal_window, terminal_spawn, terminal_write,
   terminal_resize, terminal_close

Plugin (sandboxed, eval'd JS) — examples/plugins/terminal/
└─ Sidebar panel
   └─ "Open Terminal" button → api.openTerminal() → asks core app to show the window
```

## Backend (Rust)

**New crate:** `crates/terminal`, built on [`portable-pty`](https://docs.rs/portable-pty)
(the wezterm project's cross-platform PTY crate — unifies Windows ConPTY and Unix PTYs
behind one API).

**Session model:**

```rust
pub struct TerminalSession {
    pub id: String,
    pty_pair: portable_pty::PtyPair,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn std::io::Write + Send>,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}
```

`TerminalManager` lives in Tauri managed state. Spawning a session starts a background
thread that reads PTY output in a loop and emits it as a Tauri event
(`terminal-output`, payload `{ sessionId, data }`) to the terminal window as data
arrives — no waiting for the process to exit.

**Tauri commands** (`apps/desktop/src-tauri/src/commands.rs`):

- `open_terminal_window(app: AppHandle)` — creates the second `WebviewWindow` if none
  exists for `"terminal"`, else focuses it.
- `terminal_spawn(cwd: Option<String>) -> Result<String, String>` — starts a PTY with
  the default shell (see below), in `cwd` if given else the user's home directory.
  Returns the new session id.
- `terminal_write(session_id: String, data: String) -> Result<(), String>` — writes
  keystrokes/pasted text to the PTY.
- `terminal_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String>` —
  resizes the PTY (needed for correct wrapping and full-screen programs like `vim`).
- `terminal_close(session_id: String) -> Result<(), String>` — kills the child process
  and removes the session.

**Default shell auto-detection** (`crates/terminal/src/shell.rs`):

- Unix: reads `$SHELL`, falls back to `/bin/sh`.
- Windows: no OS-level "default shell" concept exists, so this prefers
  `powershell.exe` (present on all Windows 10+ machines), falling back to `cmd.exe`
  via `%COMSPEC%` if PowerShell isn't found on `PATH`.

**Cleanup:** the terminal window's close event kills every active PTY/child process
associated with it — no orphaned shells survive after the window closes. This mirrors
what the existing `install_plugin`/`hash_files` code already does for resource
cleanup elsewhere in the app: explicit, not relying on process-exit GC.

## Frontend

**New dependency:** `@xterm/xterm` + `@xterm/addon-fit` (the same terminal-rendering
library VS Code uses for its integrated terminal).

**Secondary window:** `open_terminal_window` creates a `WebviewWindow` pointing at the
same `index.html` with `?window=terminal` in the URL. `apps/desktop/src/main.tsx`
checks `new URLSearchParams(location.search).get("window")`; if `"terminal"`, it
renders a `TerminalWindow` root instead of the normal `<App />`.

**`TerminalWindow` component** (`apps/desktop/src/terminal/TerminalWindow.tsx`):

- A tab strip (one tab per PTY session) + a "+" button that calls `terminal_spawn`
  with no `cwd` (defaults to home directory) and adds a tab.
- Each tab mounts its own `Terminal` (xterm.js) instance in a container div. On mount:
  calls `terminal_spawn`, subscribes to `terminal-output` events filtered by that
  session's id, writes incoming data into the xterm instance, and wires xterm's
  `onData` callback to `invoke("terminal_write", { sessionId, data })`.
- `addon-fit` + a `ResizeObserver` on the container call `terminal_resize` whenever
  the pane size changes.
- Closing a tab calls `terminal_close` and removes it from the tab list; closing the
  last tab closes the window.

**Starting directory:** the *first* tab, opened via the plugin's "Open Terminal"
button, starts in whatever folder was current in the explorer at click time (passed
through `open_terminal_window` → first `terminal_spawn` call, using the plugin's
existing `nav.read` access). Tabs opened afterward via the window's own "+" button
start in the user's home directory, matching normal terminal-app behavior.

## Plugin changes (`examples/plugins/terminal/`, renamed from `run-command`)

- Directory renamed `run-command` → `terminal`.
- `manifest.json`: `id`/`name` → `"terminal"`/`"Terminal"`; permissions become
  `["ui.sidebar", "nav.read", "ui.terminal"]` (drops `system.exec`, adds the new
  `ui.terminal` scope).
- `frontend/index.js`: sidebar panel shrinks to a folder-path label + a single "Open
  Terminal" button calling `api.openTerminal()`.
- `marketplace.json`: entry `id`/`name`/`description` updated to match.
- `assets/plugin-icons/`: reuse an existing terminal-shaped icon (there's already an
  `essential/terminal.png` crop from the icon sheet) rather than sourcing a new one.

## New plugin API surface

- New permission scope: `ui.terminal`.
- New `createPluginApi()` method: `openTerminal(): Promise<void>` → `invoke("open_terminal_window")`.
  Gated behind `ui.terminal` the same way `registerSidebarPanel` is gated behind
  `ui.sidebar` — see the permission table in `docs/plugins.md`.

## Testing strategy

- **Rust:** `crates/terminal` gets unit tests for the parts that don't require a real
  PTY handshake with a UI — shell auto-detection (`shell.rs`, table-driven over
  `$SHELL`/`COMSPEC` env var presence) and session-id/lifecycle bookkeeping in
  `TerminalManager` (spawn → appears in map, close → removed from map). Actually
  reading/writing PTY bytes is exercised indirectly through `terminal_spawn` +
  `terminal_write` + `terminal_close` round-trip tests using a real `portable-pty`
  session running a short-lived echo command, matching the existing pattern in
  `crates/plugins/src/exec.rs`'s tests.
- **Frontend:** unit tests for the pure/testable seams — the tab-list reducer logic
  in `TerminalWindow` (add tab, remove tab, remove-last-tab-closes-window) and the
  `?window=terminal` routing check in `main.tsx`. Actual xterm.js rendering and PTY
  I/O aren't unit-testable and won't be covered by automated tests; manual dev-mode
  verification (open terminal, run a command, run an interactive program like `vim`,
  resize the window, open a second tab, close tabs) covers that gap, consistent with
  this project's existing "no automated GUI testing" constraint — automated tests
  cover logic, manual verification covers the actual terminal experience.

## Security notes

PTY access is at least as privileged as the `system.exec` permission it replaces
(arbitrary shell access with the app's OS permissions, no sandboxing) — this doesn't
change the app's overall trust model, since `system.exec` already existed. What
changes is *where* that trust boundary sits: previously a plugin ran commands
directly (gated by `system.exec`); now a plugin can only ask the trusted core app to
open a terminal window (gated by the new, narrower `ui.terminal`), and all PTY
handling happens in core-app code, not inside `new Function`-evaluated plugin JS.

## Out of scope for this pass

- Multiple terminal *windows* (only one terminal window, with multiple tabs, per the
  earlier decision).
- Configurable shell/theme/font settings.
- Copy/paste keybinding customization beyond xterm.js defaults.
- Remote sessions (SSH etc. — already covered by the separate SSH plugin idea in
  `assets/plugin-icons/server-mgmt/`, unrelated to this feature).
