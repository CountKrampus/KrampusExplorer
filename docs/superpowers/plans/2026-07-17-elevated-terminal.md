# Elevated Terminal Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Open Terminal (Admin)" — a detached terminal window that runs fully elevated
(Windows UAC), applying to the whole window rather than individual tabs.

**Architecture:** The app relaunches itself as a second, independent, fully-elevated OS process
dedicated solely to hosting the terminal window (triggered via Win32 `ShellExecuteW` with the
`"runas"` verb). Because the entire second process is elevated, the existing PTY code
(`TerminalManager`, unmodified) spawns elevated shells automatically — no per-shell elevation
bridging needed. The window shows "(Administrator)" in its title by asking the OS directly
whether the current process is elevated, rather than tracking how it got that way.

**Tech stack:** `windows-sys` (new dependency, Windows-only, in `crates/terminal`) for
`ShellExecuteW` and the process-token elevation check.

Full design rationale: `docs/superpowers/specs/2026-07-17-elevated-terminal-design.md`.

---

### Task 1: `crates/terminal` — elevation module

**Files:**
- Create: `crates/terminal/src/elevation.rs`
- Modify: `crates/terminal/Cargo.toml`
- Modify: `crates/terminal/src/lib.rs`

- [ ] **Step 1: Add the `windows-sys` dependency, Windows-only**

In `crates/terminal/Cargo.toml`, add a new section after `[dependencies]`:

```toml
[dependencies]
portable-pty = "0.8"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_Foundation",
    "Win32_Security",
    "Win32_System_Threading",
    "Win32_UI_Shell",
] }
```

- [ ] **Step 2: Write the elevation module with tests**

`crates/terminal/src/elevation.rs`:

```rust
//! Windows UAC elevation: checking the current process's elevation status, and relaunching the
//! app elevated for the "Open Terminal (Admin)" flow. See the design spec
//! (docs/superpowers/specs/2026-07-17-elevated-terminal-design.md) for why this relaunches the
//! whole app as a second process rather than elevating a single shell in place: portable-pty's
//! CreateProcess-based spawning can't cross the UAC elevation boundary on its own.

#[cfg(windows)]
mod windows_impl {
    use std::ffi::c_void;

    /// True if the current process is running elevated (as Administrator). Used by the
    /// terminal window to show "(Administrator)" in its title, regardless of how it ended up
    /// elevated -- this asks the OS directly rather than tracking the relaunch path.
    pub fn is_elevated() -> bool {
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token = 0isize;
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }

            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut size = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut TOKEN_ELEVATION as *mut c_void,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut size,
            );

            windows_sys::Win32::Foundation::CloseHandle(token);

            ok != 0 && elevation.TokenIsElevated != 0
        }
    }

    /// Relaunches the current executable elevated (triggering the Windows UAC consent prompt),
    /// passing `--elevated-terminal` and, if given, `--cwd=<path>` on its command line. The
    /// relaunched process is a separate, independent OS process from this one.
    pub fn relaunch_elevated_terminal(cwd: Option<&str>) -> Result<(), String> {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;

        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not find own executable: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();

        let mut params = "--elevated-terminal".to_string();
        if let Some(cwd) = cwd {
            params.push_str(&format!(" --cwd=\"{cwd}\""));
        }

        let exe_wide = to_wide(&exe_str);
        let params_wide = to_wide(&params);
        let verb_wide = to_wide("runas");

        // SW_SHOWNORMAL = 1. HWND 0 = no owner window.
        let result = unsafe {
            ShellExecuteW(
                0,
                verb_wide.as_ptr(),
                exe_wide.as_ptr(),
                params_wide.as_ptr(),
                std::ptr::null(),
                1,
            )
        };

        // Per the Win32 ShellExecute docs, a return value greater than 32 indicates success;
        // values 0-32 are error codes (including what's returned if the UAC prompt is declined).
        if (result as isize) <= 32 {
            return Err("Elevation was cancelled or could not start".to_string());
        }

        Ok(())
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn to_wide_null_terminates() {
            assert_eq!(to_wide("hi"), vec![b'h' as u16, b'i' as u16, 0]);
        }

        #[test]
        fn to_wide_handles_empty_string() {
            assert_eq!(to_wide(""), vec![0]);
        }

        #[test]
        fn is_elevated_is_false_under_a_normal_test_run() {
            // cargo test doesn't run elevated, so this should reliably be false. A sane-default
            // smoke test (proves the Win32 call doesn't panic/misbehave), not a full correctness
            // proof of elevation detection under every OS scenario -- that needs the manual
            // verification in Task 6.
            assert!(!is_elevated());
        }
    }
}

#[cfg(not(windows))]
mod stub {
    pub fn is_elevated() -> bool {
        false
    }

    pub fn relaunch_elevated_terminal(_cwd: Option<&str>) -> Result<(), String> {
        Err("Elevated relaunch is only supported on Windows".to_string())
    }
}

#[cfg(windows)]
pub use windows_impl::{is_elevated, relaunch_elevated_terminal};
#[cfg(not(windows))]
pub use stub::{is_elevated, relaunch_elevated_terminal};
```

- [ ] **Step 3: Wire it into the crate root**

`crates/terminal/src/lib.rs`:

```rust
//! Detached-window terminal: PTY session lifecycle, shell auto-detection.

mod elevation;
mod manager;
mod shell;

pub use elevation::{is_elevated, relaunch_elevated_terminal};
pub use manager::TerminalManager;
pub use shell::shell_candidates;
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p explorer-terminal`
Expected: all existing tests still pass, plus 3 new ones (`to_wide_null_terminates`,
`to_wide_handles_empty_string`, `is_elevated_is_false_under_a_normal_test_run`).

- [ ] **Step 5: Run clippy**

Run: `cargo clippy -p explorer-terminal --all-targets -- -D warnings`
Expected: clean. (The `unsafe` blocks around raw Win32 FFI calls are expected and correct here
— this is exactly the kind of narrow, well-contained FFI use this project already has elsewhere,
e.g. the `user32.dll` P/Invoke patterns used in this session's manual testing.)

- [ ] **Step 6: Commit**

```bash
git add crates/terminal
git commit -m "Add is_elevated() and relaunch_elevated_terminal() to explorer-terminal"
```

---

### Task 2: Wire elevation into the Tauri app

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Extract the shared window-building helper and add the two new commands**

In `apps/desktop/src-tauri/src/commands.rs`, replace the window-building portion of
`open_terminal_window` with a call to a new shared helper, and add `is_elevated` and
`open_elevated_terminal_window`. Find this existing code:

```rust
    *pending_cwd.0.lock().unwrap() = cwd;

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "terminal",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Krampus Explorer — Terminal")
    .inner_size(900.0, 600.0)
    .min_inner_size(400.0, 300.0)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;
```

Replace it with:

```rust
    *pending_cwd.0.lock().unwrap() = cwd;

    let window = build_terminal_webview_window(&app)?;
```

Then add the helper function and the two new commands right after `open_terminal_window`'s
closing brace (after the existing `Ok(())` / `}` that ends that function):

```rust
/// Builds the detached terminal window itself -- shared between `open_terminal_window` (the
/// normal, non-elevated path) and `run_elevated_terminal` in lib.rs (the elevated relaunch's
/// entire purpose), so the two can't drift apart.
pub fn build_terminal_webview_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    tauri::WebviewWindowBuilder::new(app, "terminal", tauri::WebviewUrl::App("index.html".into()))
        .title("Krampus Explorer — Terminal")
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())
}

/// True if this process is running elevated (Administrator). Called by the terminal window on
/// mount to decide whether to show "(Administrator)" in its title.
#[tauri::command]
pub fn is_elevated() -> bool {
    explorer_terminal::is_elevated()
}

/// Relaunches the app elevated (triggering the Windows UAC prompt), dedicated to opening a
/// fully-elevated terminal window. See `explorer_terminal::relaunch_elevated_terminal` and the
/// design spec for why this is a separate process rather than an elevated shell inside the
/// existing (non-elevated) terminal window.
#[tauri::command]
pub fn open_elevated_terminal_window(cwd: Option<String>) -> Result<(), String> {
    explorer_terminal::relaunch_elevated_terminal(cwd.as_deref())
}
```

- [ ] **Step 2: Add the new `run_elevated_terminal` entry point**

In `apps/desktop/src-tauri/src/lib.rs`, add a new public function alongside the existing `run()`:

```rust
mod commands;

use commands::PendingTerminalCwd;
use explorer_terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .manage(TerminalManager::new())
        .manage(PendingTerminalCwd(std::sync::Mutex::new(None)))
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_drives,
            commands::get_directory_listing,
            commands::get_default_start_path,
            commands::rename_entry,
            commands::delete_entry,
            commands::create_folder,
            commands::create_file,
            commands::copy_entry,
            commands::move_entry,
            commands::copy_entry_with_progress,
            commands::move_entry_with_progress,
            commands::search_files,
            commands::get_search_history,
            commands::clear_search_history,
            commands::save_search,
            commands::list_saved_searches,
            commands::delete_saved_search,
            commands::read_text_preview,
            commands::get_settings,
            commands::save_settings,
            commands::list_plugins,
            commands::read_plugin_entry,
            commands::install_plugin,
            commands::create_zip_archive,
            commands::extract_zip_archive,
            commands::scan_directory,
            commands::hash_files,
            commands::hash_file_all,
            commands::list_sqlite_tables,
            commands::query_sqlite_table,
            commands::list_mongo_databases,
            commands::list_mongo_collections,
            commands::query_mongo_collection,
            commands::git_status,
            commands::git_log,
            commands::run_command,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::open_terminal_window,
            commands::take_pending_terminal_cwd,
            commands::is_elevated,
            commands::open_elevated_terminal_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Entry point for the elevated-terminal relaunch (see `explorer_terminal::relaunch_elevated_terminal`
/// and `main.rs`'s `--elevated-terminal` flag). A minimal, separate Tauri app instance whose only
/// job is opening one fully-elevated terminal window -- it registers only the terminal-related
/// commands, never loads plugins, and has no access to any of the other app commands (file
/// explorer, settings, search, etc.), deliberately minimizing what's exposed while running with
/// admin privileges. Exits when its one window closes (Tauri's default last-window-closed
/// behavior).
pub fn run_elevated_terminal(cwd: Option<String>) {
    tauri::Builder::default()
        .manage(TerminalManager::new())
        .manage(PendingTerminalCwd(std::sync::Mutex::new(cwd)))
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = commands::build_terminal_webview_window(&handle) {
                eprintln!("Could not open elevated terminal window: {e}");
                std::process::exit(1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::take_pending_terminal_cwd,
            commands::is_elevated,
        ])
        .run(tauri::generate_context!())
        .expect("error while running elevated terminal process");
}
```

- [ ] **Step 3: Add command-line parsing to `main.rs`**

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match parse_elevated_terminal_args(&args) {
        Some(cwd) => krampus_explorer_lib::run_elevated_terminal(cwd),
        None => krampus_explorer_lib::run(),
    }
}

/// Parses `--elevated-terminal` and an optional `--cwd=<path>` out of the process's command-line
/// arguments. Returns `None` for a normal app launch (the common case), `Some(cwd)` if this is
/// the elevated-terminal relaunch (see `explorer_terminal::relaunch_elevated_terminal`).
fn parse_elevated_terminal_args(args: &[String]) -> Option<Option<String>> {
    if !args.iter().any(|a| a == "--elevated-terminal") {
        return None;
    }
    let cwd = args
        .iter()
        .find_map(|a| a.strip_prefix("--cwd=").map(String::from));
    Some(cwd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_launch_is_not_elevated_terminal() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_elevated_terminal_args(&args), None);
    }

    #[test]
    fn elevated_flag_alone_yields_no_cwd() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--elevated-terminal".to_string(),
        ];
        assert_eq!(parse_elevated_terminal_args(&args), Some(None));
    }

    #[test]
    fn elevated_flag_with_cwd_extracts_the_path() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--elevated-terminal".to_string(),
            "--cwd=C:\\Users\\boo".to_string(),
        ];
        assert_eq!(
            parse_elevated_terminal_args(&args),
            Some(Some("C:\\Users\\boo".to_string()))
        );
    }
}
```

- [ ] **Step 4: Build and run the full Rust test suite**

Run:
```bash
cargo build --workspace
cargo test --workspace
```
Expected: builds cleanly; every existing test still passes, plus the 3 new `main.rs` tests and
the 3 new `explorer-terminal` tests from Task 1.

- [ ] **Step 5: Run clippy**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "Add the elevated-terminal relaunch entry point and Tauri commands"
```

---

### Task 3: Frontend — show "(Administrator)" in the elevated window's title

**Files:**
- Modify: `apps/desktop/src/terminal/TerminalWindow.tsx`

- [ ] **Step 1: Add the elevation check and use it in the title**

In `apps/desktop/src/terminal/TerminalWindow.tsx`, first fix the import ordering left over from
an earlier edit — the `tabLabel` function is currently defined between two groups of imports.
Move all imports to the top of the file, in this order:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import TitleBar from "../components/TitleBar";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { addTab, initialTabs, removeTab, type TerminalTabState } from "./tabs";
import "@xterm/xterm/css/xterm.css";
import "../styles/theme.css";
import "../styles/global.css";
import "./TerminalWindow.css";

/** Label shown in the tab strip for a given tab's shell — falls back to a generic "Shell N"
 * label for the default/auto-detected shell, since we don't know which one that resolved to
 * without asking the backend. */
function tabLabel(shell: string | null, index: number): string {
  if (shell === "powershell.exe") return "PowerShell";
  if (shell === "cmd.exe") return "CMD";
  return `Shell ${index + 1}`;
}
```

Then, inside the `TerminalWindow` component function, add the elevation check alongside the
existing `initialCwd` fetch:

```tsx
  const [isElevated, setIsElevated] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_elevated")
      .then(setIsElevated)
      .catch(() => {
        // Default to false (not elevated) if the check itself fails for some reason -- the
        // title label is cosmetic, not a security boundary, so failing closed here just means
        // a possibly-misleading title, not a real risk.
      });
  }, []);
```

Finally, update the `TitleBar` usage:

```tsx
      <TitleBar
        title={
          isElevated
            ? "Krampus Explorer — Terminal (Administrator)"
            : "Krampus Explorer — Terminal"
        }
      />
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd apps/desktop && npm test -- --run`
Expected: every existing test still passes (no new tests in this step — `is_elevated`'s actual
Win32 behavior isn't testable from the frontend side, matching this file's established pattern
of manual-only verification for anything that needs a live PTY/OS environment).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/terminal/TerminalWindow.tsx
git commit -m "Show \"(Administrator)\" in the elevated terminal window's title"
```

---

### Task 4: Plugin API — `openElevatedTerminal`

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

No new permission scope — `openElevatedTerminal` is gated behind the *existing* `ui.terminal`
permission, alongside `openTerminal` (same capability class: "can ask the trusted core app for a
terminal window").

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add `"openElevatedTerminal"` to `ALL_METHODS`.
2. Add `openElevatedTerminal: vi.fn().mockResolvedValue(undefined),` to the `handlers()` mock.
3. Change the existing `it.each` row from `["ui.terminal", ["openTerminal"]]` to
   `["ui.terminal", ["openTerminal", "openElevatedTerminal"]]`.
4. Add a dedicated forwarding test right after the existing `openTerminal` one:

```ts
  it("openElevatedTerminal calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.terminal"]), h);

    await api.openElevatedTerminal?.();

    expect(h.openElevatedTerminal).toHaveBeenCalledWith();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL — `openElevatedTerminal` doesn't exist yet.

- [ ] **Step 3: Add the type**

In `apps/desktop/src/types/plugin.ts`, add to `PluginApi` right after `openTerminal`:

```ts
  /** Present only if the plugin's manifest declares the "ui.terminal" permission. Opens a
   * SEPARATE, fully elevated (Administrator) terminal window — triggers the Windows UAC
   * prompt. Elevation applies to the whole window, not individual tabs; the resulting window
   * is an independent OS process from the main app, not connected to it once open. */
  openElevatedTerminal?: () => Promise<void>;
```

- [ ] **Step 4: Wire it into createPluginApi**

In `apps/desktop/src/plugins/pluginApi.ts`, add to `PluginApiHandlers` right after
`openTerminal: () => Promise<void>;`:

```ts
  openElevatedTerminal: () => Promise<void>;
```

And update the existing `ui.terminal` block:

```ts
  if (has("ui.terminal")) {
    api.openTerminal = () => handlers.openTerminal();
    api.openElevatedTerminal = () => handlers.openElevatedTerminal();
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: PASS.

- [ ] **Step 6: Wire the real handler**

In `apps/desktop/src/stores/usePluginStore.ts`, add right after the existing `openTerminal`
handler:

```ts
          openElevatedTerminal: () =>
            invoke<void>("open_elevated_terminal_window", { cwd: getCurrentFolderPath() }),
```

- [ ] **Step 7: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; every test passes.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/types/plugin.ts apps/desktop/src/plugins/pluginApi.ts apps/desktop/src/plugins/pluginApi.test.ts apps/desktop/src/stores/usePluginStore.ts
git commit -m "Add api.openElevatedTerminal() under the existing ui.terminal permission"
```

---

### Task 5: Plugin UI — "Open Terminal (Admin)" button

**Files:**
- Modify: `examples/plugins/terminal/frontend/index.js`
- Modify: `examples/plugins/terminal/README.md`

- [ ] **Step 1: Add the second button**

In `examples/plugins/terminal/frontend/index.js`, find:

```js
    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Terminal";
    openBtn.style.cursor = "pointer";
    openBtn.addEventListener("click", () => {
      api.openTerminal();
    });

    container.appendChild(cwdLabel);
    container.appendChild(openBtn);
```

Replace with:

```js
    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Terminal";
    openBtn.style.cursor = "pointer";
    openBtn.addEventListener("click", () => {
      api.openTerminal();
    });

    const openAdminBtn = document.createElement("button");
    openAdminBtn.textContent = "Open Terminal (Admin)";
    openAdminBtn.style.cursor = "pointer";
    openAdminBtn.addEventListener("click", () => {
      api.openElevatedTerminal();
    });

    container.appendChild(cwdLabel);
    container.appendChild(openBtn);
    container.appendChild(openAdminBtn);
```

- [ ] **Step 2: Update the README**

In `examples/plugins/terminal/README.md`, replace the whole file with:

```md
# Terminal

Sidebar panel with two buttons: "Open Terminal" opens a detached terminal window — a real
interactive shell (PowerShell/cmd on Windows, `$SHELL` elsewhere) with tabs, full ANSI
color/cursor support, and live keystroke input. "Open Terminal (Admin)" opens a *separate*,
fully elevated (Administrator) terminal window instead — triggering the Windows UAC prompt.
Elevation applies to the whole window, not individual tabs, and the elevated window is an
independent OS process from the main app once open.

The first tab of a normal (non-elevated) terminal opens in the folder you're currently
browsing; tabs opened afterward, from either window's own "+ PS" / "+ CMD" buttons, start in
your home directory. The elevated window's first tab also opens in the folder you were
browsing when you clicked "Open Terminal (Admin)".

The terminal itself is core-app functionality, not sandboxed plugin code — see
`docs/plugins.md`'s "Terminal window" section for why. This plugin is just the trigger.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — tracks the current folder, to open the first terminal tab there.
- `ui.terminal` — opens the detached terminal window(s). **No sandboxing beyond that window
  boundary** — once open, it's a real shell with the app's own OS permissions (or, for the
  Admin variant, full Administrator permissions), same trust level `system.exec` always had.
```

- [ ] **Step 3: Commit**

```bash
git add examples/plugins/terminal
git commit -m "Add an \"Open Terminal (Admin)\" button to the terminal plugin"
```

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `docs/plugins.md`

- [ ] **Step 1: Update the `ui.terminal` methods section**

In `docs/plugins.md`, find:

```md
### `ui.terminal` methods

- `openTerminal(): Promise<void>` — opens the detached terminal window (creating it if it
  doesn't exist yet, else focusing the existing one). See "Terminal window" below for what that
  window actually is.
```

Replace with:

```md
### `ui.terminal` methods

- `openTerminal(): Promise<void>` — opens the detached terminal window (creating it if it
  doesn't exist yet, else focusing the existing one). See "Terminal window" below for what that
  window actually is.
- `openElevatedTerminal(): Promise<void>` — opens a *separate*, fully elevated (Administrator)
  terminal window, triggering the Windows UAC consent prompt. Elevation applies to the whole
  window, not individual tabs. See "Terminal window" below for how this is implemented.
```

- [ ] **Step 2: Update the "Terminal window" section**

In `docs/plugins.md`'s `## Terminal window` section, find the bullet list near the end (the one
starting with "Only one terminal window exists at a time...") and add a new bullet after the
existing four:

```md
- `openElevatedTerminal()` opens a fully elevated (Administrator) terminal window instead —
  triggering the Windows UAC prompt. This is architecturally a *separate OS process*: elevating
  a single shell within the existing non-elevated terminal window isn't possible with
  `portable-pty`'s `CreateProcess`-based spawning (only `ShellExecute` with the `"runas"` verb
  can elevate, and only for a whole new process), so `openElevatedTerminal()` instead relaunches
  the app itself elevated, dedicated to just that one window. That process registers only the
  terminal-related commands and never loads plugins, minimizing what's exposed while running
  with admin privileges.
```

- [ ] **Step 3: Full workspace verification**

Run:
```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
Expected: `fmt` makes no unexpected changes; `clippy` clean; every test passes.

```bash
cd apps/desktop
npx tsc --noEmit
npm test -- --run
npm run build
```
Expected: no type errors, every test passes, build succeeds.

- [ ] **Step 4: Manual verification**

This is the one part of this feature that cannot be automated-tested at all — `ShellExecuteW`
with `"runas"` triggers a real UAC prompt, which would be both unacceptable in CI and
impossible to script meaningfully. Verify by hand in dev mode:

- Click "Open Terminal (Admin)" — confirm the Windows UAC consent prompt actually appears.
- Accept it — confirm a *new*, separate terminal window opens (check Task Manager: there should
  now be two `krampus-explorer.exe` processes).
- Confirm that window's title reads "Krampus Explorer — Terminal (Administrator)".
- In that window, run a command that requires elevation to succeed (e.g. `net session` on
  PowerShell/cmd — it errors with "Access is denied" when NOT elevated, and succeeds silently
  when elevated) and confirm it actually behaves as elevated.
- Confirm the first tab opens in the folder you were browsing when you clicked the button.
- Close the elevated window — confirm its process exits (check Task Manager again) and the main
  app/window is completely unaffected.
- Click "Open Terminal (Admin)" and click "No"/"Cancel" on the UAC prompt — confirm this fails
  gracefully (no window opens, no crash) rather than silently hanging or erroring loudly.
- Confirm the *normal* (non-Admin) "Open Terminal" button still works exactly as before and its
  window's title does NOT say "(Administrator)".

- [ ] **Step 5: Report any manual-verification failures back before considering this plan done**

If any manual check above fails, that's a real bug to fix (with its own test where the failure
is in testable logic) — not something to note and move past, matching this project's established
practice for this exact feature area (see the extensive manual-debugging history for the base
terminal window feature).
