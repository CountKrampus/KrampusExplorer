# Elevated Terminal Window — Design

## Goal

Add an "Open Terminal (Admin)" option that opens a detached terminal window running fully
elevated (Windows UAC), so every shell in that window has administrator privileges. Elevation
applies to the whole window, not individual tabs — confirmed with the user rather than assumed.

## Why this needs a different architecture than the existing terminal

The existing terminal (`crates/terminal`, `TerminalManager::spawn`) launches shells via
`portable-pty`'s `CommandBuilder`/`spawn_command`, which is built on plain Win32 `CreateProcess`.
`CreateProcess` **cannot** elevate a child process — only `ShellExecute`/`ShellExecuteEx` with the
`"runas"` verb can trigger the UAC consent prompt and produce an elevated process. Bridging a
single elevated shell into the existing non-elevated PTY plumbing would require manually driving
Windows' ConPTY APIs directly and passing handles across the UAC integrity-level boundary — a
substantial low-level undertaking for a single-shell case, and this project already decided
"whole window," not "elevated shell inside an otherwise non-elevated window."

## Architecture: self-relaunch as a second, fully elevated process

Instead of elevating one shell, the app relaunches **itself** elevated, as a second OS process
whose only job is hosting the terminal window:

1. Clicking "Open Terminal (Admin)" in the plugin's sidebar panel calls a new command,
   `open_elevated_terminal_window(cwd)`.
2. That command calls Win32 `ShellExecuteW` with `lpVerb = "runas"`, targeting the app's own
   executable (`std::env::current_exe()`), with command-line arguments
   `--elevated-terminal --cwd=<path>`. This is what actually triggers the UAC prompt — the user
   consents (or cancels) exactly like any other "Run as administrator" action on Windows.
3. `main()` checks `std::env::args()` for `--elevated-terminal` **before** doing any of the
   normal app bootstrap. If present, it calls a new entry point,
   `krampus_explorer_lib::run_elevated_terminal(cwd)`, instead of the normal `run()`. This
   second entry point builds a **minimal, separate `tauri::Builder`** that:
   - registers only the terminal-specific commands (`terminal_spawn`, `terminal_write`,
     `terminal_resize`, `terminal_close`, `take_pending_terminal_cwd`, `is_elevated`) — not the
     other ~50 app commands (file explorer, plugins, settings, search, etc.)
   - opens the terminal window directly on startup (no plugin/button involved inside this
     process — opening the window *is* this process's entire purpose)
   - exits when that window closes (default Tauri behavior: last window closed → app exits)

Because the **entire second process** runs elevated, every shell it spawns via the existing
`TerminalManager`/`portable-pty` code is elevated too, automatically, with zero changes to that
code — the elevation boundary is crossed once, at process creation, not per-shell.

```
Main process (not elevated)                    Second process (elevated)
├─ Main window                                  └─ Terminal window only
├─ Terminal window (existing, non-elevated)         ├─ Own TerminalManager
└─ open_elevated_terminal_window command             ├─ Registers only 6 terminal commands
   └─ ShellExecuteW(..., "runas", ...) ─────────────▶ ├─ Opens window on startup
      relaunches self with --elevated-terminal        └─ Exits when window closes
```

**Tradeoffs, made explicit:**
- Shows up as a second `krampus-explorer.exe` in Task Manager.
- A fresh UAC prompt appears every time it's opened — expected, unavoidable, and exactly what
  a user wants from an "Admin" terminal (silently skipping the prompt would be a real security
  regression).
- The elevated window is fully independent of the main app process: closing one doesn't close
  the other, and they share no live state beyond the one-time `cwd` handoff via command-line
  argument.

## Visible "you are elevated" indicator

The custom `TitleBar` (the only visible window chrome, since `decorations: false`) should say
"Krampus Explorer — Terminal (Administrator)" when elevated, matching how `cmd.exe`/PowerShell
themselves flag elevated windows.

Rather than plumbing an "am I the elevated one" flag through the relaunch command line and all
the way to the frontend, `TerminalWindow.tsx` calls a new command, `is_elevated()`, on mount —
the same way it already calls `take_pending_terminal_cwd` — and asks the OS directly (Win32
`OpenProcessToken` + `GetTokenInformation` with `TokenElevation`) whether the *current process*
is elevated. This is simpler than flag-plumbing and more correct: it reflects reality regardless
of how the process ended up elevated (e.g. if a user manually right-clicks the whole app and
picks "Run as administrator," the normal terminal window would then correctly show the
"(Administrator)" label too, which flag-plumbing tied to the relaunch path wouldn't catch).

## New Rust dependency

`windows-sys` (Microsoft's official, minimal FFI-bindings-only crate — not the heavier, more
ergonomic `windows` crate) for `ShellExecuteW`, `OpenProcessToken`, and `GetTokenInformation`.
Chosen to match this project's existing preference for narrow, minimal dependencies over heavier
abstraction crates (e.g. the hand-rolled `urlencoding_encode` helper and direct `user32.dll`
P/Invoke patterns already used elsewhere in this session's work).

## Backend changes

- `crates/terminal` (or a new small module) gains `is_elevated() -> bool`, wrapping the
  Win32 token-elevation check.
- `apps/desktop/src-tauri/src/main.rs`: parses `--elevated-terminal` / `--cwd=` before calling
  into the library, dispatching to `run()` or `run_elevated_terminal(cwd)`. The argument-parsing
  logic is factored into a small pure function so it's unit-testable without an elevated process.
- `apps/desktop/src-tauri/src/lib.rs`: new `run_elevated_terminal(cwd: Option<String>)` entry
  point — a second, minimal `tauri::Builder` chain, reusing the *exact same* window-building code
  `open_terminal_window` already uses (factored into a shared helper) so the two paths can't
  drift apart.
- `apps/desktop/src-tauri/src/commands.rs`: new `open_elevated_terminal_window(cwd)` command
  (the `ShellExecuteW` relaunch) and `is_elevated()` command.
- No `capabilities/default.json` changes needed — it already grants window-control permissions
  to any window labeled `"terminal"`, which both the normal and elevated windows use.

## Frontend changes

- `TerminalWindow.tsx`: on mount, also calls `is_elevated()` and renders
  `<TitleBar title={isElevated ? "Krampus Explorer — Terminal (Administrator)" : "Krampus Explorer — Terminal"} />`.
- `types/plugin.ts` / `pluginApi.ts`: new `openElevatedTerminal?: () => Promise<void>`, gated
  behind the *existing* `ui.terminal` permission (not a new permission scope — it's the same
  "can ask the trusted core app for a terminal" capability class as `openTerminal`, just a
  second entry point into it).
- `usePluginStore.ts`: wires `openElevatedTerminal` to
  `invoke("open_elevated_terminal_window", { cwd: getCurrentFolderPath() })`.
- `examples/plugins/terminal/frontend/index.js`: a second button, "Open Terminal (Admin)",
  under the existing "Open Terminal" button.

## Security notes

Running an entire process elevated is a meaningfully bigger privilege grant than anything else
in this app, so the elevated process's attack surface is deliberately minimized: it registers
only the 6 terminal-related commands, never loads plugins, and has no access to any of the
other ~50 app commands (file explorer, settings, search, marketplace, etc.). A compromised or
malicious plugin cannot reach the elevated process at all — it only exists as a separate OS
process triggered by one specific, user-consented (via the UAC prompt itself) button click.

## Testing strategy

- The `--elevated-terminal`/`--cwd=` argument-parsing function is pure and fully unit-tested.
- `is_elevated()`'s actual Win32 call isn't meaningfully unit-testable (requires a real process
  token), but a test confirms it returns `false` (not a panic) under a normal, non-elevated
  `cargo test` run — a sane-default smoke test, not a correctness proof.
- `open_elevated_terminal_window`'s `ShellExecuteW` call is **not** automated-tested at all — it
  would trigger a real UAC prompt during CI/test runs, which is unacceptable. This is manual-only
  verification: click "Open Terminal (Admin)," confirm the UAC prompt appears, confirm the
  resulting window's title says "(Administrator)," confirm a command like `whoami /groups` (or
  checking a registry key under `HKLM` that requires elevation to write) actually reflects
  elevated privileges.

## Out of scope for this pass

- Per-tab elevation (explicitly ruled out by the user in favor of whole-window).
- Remembering/auto-elevating on subsequent opens (every open re-prompts UAC, by design).
- Non-Windows elevation (`sudo`-equivalent on macOS/Linux) — this app is Windows-only per its
  existing shell-detection design.
