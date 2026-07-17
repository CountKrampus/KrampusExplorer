# Terminal Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Run Command" example plugin (single command, wait for exit, dump output)
with a real interactive terminal: a detached, tabbed window with PTY-backed shells, full
ANSI/color/cursor support via xterm.js, and live keystroke I/O.

**Architecture:** The terminal itself (xterm.js UI, tabs, PTY session lifecycle) is a
first-class core-app feature — a second Tauri window loading the same `index.html` with
`?window=terminal`, not sandboxed plugin code. The renamed `terminal` plugin (was
`run-command`) is a thin trigger: its sidebar panel has an "Open Terminal" button calling
`api.openTerminal()`, gated by a new `ui.terminal` permission.

**Tech stack:** Rust `portable-pty` crate (cross-platform PTY, wezterm project) in a new
`crates/terminal` crate; `@xterm/xterm` + `@xterm/addon-fit` on the frontend; output streamed
via `tauri::ipc::Channel` (this codebase's existing pattern for `copy_entry_with_progress`),
not a global event bus.

Full design rationale: `docs/superpowers/specs/2026-07-16-terminal-plugin-design.md`.

---

### Task 1: `crates/terminal` — default shell detection

**Files:**
- Create: `crates/terminal/Cargo.toml`
- Create: `crates/terminal/src/lib.rs`
- Create: `crates/terminal/src/shell.rs`

- [ ] **Step 1: Create the crate manifest**

`crates/terminal/Cargo.toml`:

```toml
[package]
name = "explorer-terminal"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "explorer_terminal"
path = "src/lib.rs"

[dependencies]
portable-pty = "0.8"
```

- [ ] **Step 2: Write the failing tests for shell candidate selection**

`crates/terminal/src/shell.rs`:

```rust
/// Shells to try, in priority order — the first one that spawns successfully is used by
/// `TerminalManager::spawn`. Windows has no OS-level "default shell" concept, so this prefers
/// PowerShell (present on every Windows 10+ machine) and falls back to whatever `%COMSPEC%`
/// points at (normally cmd.exe). Unix reads `$SHELL`, falling back to `/bin/sh`.
pub fn shell_candidates() -> Vec<String> {
    shell_candidates_from_env(std::env::var("SHELL").ok(), std::env::var("COMSPEC").ok())
}

fn shell_candidates_from_env(shell_var: Option<String>, comspec_var: Option<String>) -> Vec<String> {
    #[cfg(windows)]
    {
        let _ = shell_var;
        vec!["powershell.exe".to_string(), comspec_var.unwrap_or_else(|| "cmd.exe".to_string())]
    }
    #[cfg(not(windows))]
    {
        let _ = comspec_var;
        vec![shell_var.unwrap_or_else(|| "/bin/sh".to_string())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn windows_prefers_powershell_then_comspec() {
        let candidates = shell_candidates_from_env(None, Some("C:\\Windows\\cmd.exe".to_string()));
        assert_eq!(candidates, vec!["powershell.exe", "C:\\Windows\\cmd.exe"]);
    }

    #[test]
    #[cfg(windows)]
    fn windows_falls_back_to_cmd_exe_when_comspec_unset() {
        let candidates = shell_candidates_from_env(None, None);
        assert_eq!(candidates, vec!["powershell.exe", "cmd.exe"]);
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_uses_shell_env_var() {
        let candidates = shell_candidates_from_env(Some("/bin/zsh".to_string()), None);
        assert_eq!(candidates, vec!["/bin/zsh"]);
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_falls_back_to_bin_sh() {
        let candidates = shell_candidates_from_env(None, None);
        assert_eq!(candidates, vec!["/bin/sh"]);
    }
}
```

`crates/terminal/src/lib.rs`:

```rust
//! Detached-window terminal: PTY session lifecycle, shell auto-detection.

mod shell;

pub use shell::shell_candidates;
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test -p explorer-terminal`
Expected: 2 tests pass (Windows tests on this machine; the `#[cfg(not(windows))]` tests are
compiled out, not skipped-and-failing).

- [ ] **Step 3: Add the crate to the workspace**

In `Cargo.toml` (root), add `"crates/terminal"` to `members`:

```toml
members = [
    "crates/core",
    "crates/filesystem",
    "crates/search",
    "crates/preview",
    "crates/plugins",
    "crates/settings",
    "crates/terminal",
    "apps/desktop/src-tauri",
]
```

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml crates/terminal
git commit -m "Add explorer-terminal crate with default-shell auto-detection"
```

---

### Task 2: `crates/terminal` — PTY session manager

**Files:**
- Create: `crates/terminal/src/manager.rs`
- Modify: `crates/terminal/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

`crates/terminal/src/manager.rs`:

```rust
use crate::shell::shell_candidates;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

/// Owns every active PTY session for the terminal window. Managed as Tauri app state — one
/// instance for the whole app, shared across every `terminal_*` command.
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
    next_id: AtomicU64,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self { sessions: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1) }
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts a new PTY running the first working shell from `shell_candidates()`, in `cwd` if
    /// given (else the shell's own default, typically the user's home directory). `on_output` is
    /// called from a dedicated reader thread with each chunk of output as it arrives — for the
    /// lifetime of the session, independent of this function having already returned.
    pub fn spawn(
        &self,
        cwd: Option<&str>,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not open a PTY: {e}"))?;

        let mut last_error = "no shell candidates".to_string();
        let mut spawned = None;
        for shell in shell_candidates() {
            let mut cmd = CommandBuilder::new(&shell);
            if let Some(cwd) = cwd {
                cmd.cwd(cwd);
            }
            match pair.slave.spawn_command(cmd) {
                Ok(child) => {
                    spawned = Some(child);
                    break;
                }
                Err(e) => last_error = format!("Could not start '{shell}': {e}"),
            }
        }
        let child = spawned.ok_or(last_error)?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Could not read from PTY: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Could not write to PTY: {e}"))?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst).to_string();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                }
            }
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), Session { master: pair.master, writer, child });

        Ok(id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("No terminal session '{session_id}'"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Could not write to terminal: {e}"))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("No terminal session '{session_id}'"))?;
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not resize terminal: {e}"))
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let mut session = sessions
            .remove(session_id)
            .ok_or_else(|| format!("No terminal session '{session_id}'"))?;
        session.child.kill().map_err(|e| format!("Could not stop terminal: {e}"))
    }

    /// Kills every active session. Called when the terminal window closes, so no shell process
    /// survives after the window that owned it is gone.
    pub fn close_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

    fn collect_output() -> (impl Fn(Vec<u8>) + Send + 'static, Arc<StdMutex<Vec<u8>>>) {
        let buf = Arc::new(StdMutex::new(Vec::new()));
        let buf2 = buf.clone();
        (move |chunk: Vec<u8>| buf2.lock().unwrap().extend(chunk), buf)
    }

    #[test]
    fn spawn_returns_a_session_id() {
        let manager = TerminalManager::new();
        let (on_output, _buf) = collect_output();

        let id = manager.spawn(None, on_output).unwrap();

        assert!(!id.is_empty());
        manager.close(&id).unwrap();
    }

    #[test]
    fn write_sends_input_and_output_streams_back() {
        let manager = TerminalManager::new();
        let (on_output, buf) = collect_output();
        let id = manager.spawn(None, on_output).unwrap();

        #[cfg(windows)]
        let command = "echo hello-terminal-test\r\n";
        #[cfg(not(windows))]
        let command = "echo hello-terminal-test\n";
        manager.write(&id, command).unwrap();

        let mut seen = String::new();
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(100));
            seen = String::from_utf8_lossy(&buf.lock().unwrap()).to_string();
            if seen.contains("hello-terminal-test") {
                break;
            }
        }
        assert!(seen.contains("hello-terminal-test"), "got: {seen}");

        manager.close(&id).unwrap();
    }

    #[test]
    fn close_stops_the_session_and_a_second_close_errors() {
        let manager = TerminalManager::new();
        let (on_output, _buf) = collect_output();
        let id = manager.spawn(None, on_output).unwrap();

        manager.close(&id).unwrap();

        assert!(manager.close(&id).is_err());
    }

    #[test]
    fn write_to_an_unknown_session_errors() {
        let manager = TerminalManager::new();

        assert!(manager.write("does-not-exist", "hi").is_err());
    }

    #[test]
    fn resize_to_an_unknown_session_errors() {
        let manager = TerminalManager::new();

        assert!(manager.resize("does-not-exist", 80, 24).is_err());
    }

    #[test]
    fn resize_an_active_session_succeeds() {
        let manager = TerminalManager::new();
        let (on_output, _buf) = collect_output();
        let id = manager.spawn(None, on_output).unwrap();

        assert!(manager.resize(&id, 120, 40).is_ok());

        manager.close(&id).unwrap();
    }

    #[test]
    fn close_all_stops_every_session() {
        let manager = TerminalManager::new();
        let (on_output_a, _) = collect_output();
        let (on_output_b, _) = collect_output();
        let id_a = manager.spawn(None, on_output_a).unwrap();
        let id_b = manager.spawn(None, on_output_b).unwrap();

        manager.close_all();

        assert!(manager.close(&id_a).is_err());
        assert!(manager.close(&id_b).is_err());
    }
}
```

- [ ] **Step 2: Wire it into the crate root**

`crates/terminal/src/lib.rs`:

```rust
//! Detached-window terminal: PTY session lifecycle, shell auto-detection.

mod manager;
mod shell;

pub use manager::TerminalManager;
pub use shell::shell_candidates;
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p explorer-terminal`
Expected: all 8 tests pass (the two `shell` tests plus these 6). The output-streaming test
polls for up to 5 seconds before failing, so a slow CI runner won't flake, but it also
shouldn't normally take anywhere near that long.

- [ ] **Step 4: Commit**

```bash
git add crates/terminal
git commit -m "Add TerminalManager: spawn/write/resize/close PTY sessions"
```

---

### Task 3: Wire the terminal crate into the Tauri app

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
explorer-terminal = { path = "../../../crates/terminal" }
```

- [ ] **Step 2: Add the Tauri commands**

In `apps/desktop/src-tauri/src/commands.rs`, add to the top imports:

```rust
use explorer_terminal::TerminalManager;
use tauri::Manager;
```

(The existing `use tauri::ipc::Channel;` import already covers `Channel`.)

Append at the end of the file:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub data: String,
}

#[tauri::command]
pub fn terminal_spawn(
    manager: tauri::State<TerminalManager>,
    cwd: Option<String>,
    on_output: Channel<TerminalChunk>,
) -> Result<String, String> {
    manager.spawn(cwd.as_deref(), move |bytes| {
        let _ = on_output.send(TerminalChunk { data: String::from_utf8_lossy(&bytes).to_string() });
    })
}

#[tauri::command]
pub fn terminal_write(
    manager: tauri::State<TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&session_id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    manager: tauri::State<TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(
    manager: tauri::State<TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    manager.close(&session_id)
}

/// Creates the detached terminal window if it doesn't exist yet, else focuses the existing one.
/// `cwd` (the folder open in the explorer when the plugin's "Open Terminal" button was clicked)
/// is passed through the window URL so the terminal's first tab opens there.
#[tauri::command]
pub fn open_terminal_window(app: tauri::AppHandle, cwd: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("terminal") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut url = "index.html?window=terminal".to_string();
    if let Some(cwd) = cwd {
        url.push_str("&cwd=");
        url.push_str(&urlencoding_encode(&cwd));
    }

    let window = tauri::WebviewWindowBuilder::new(&app, "terminal", tauri::WebviewUrl::App(url.into()))
        .title("Krampus Explorer — Terminal")
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(manager) = app_handle.try_state::<TerminalManager>() {
                manager.close_all();
            }
        }
    });

    Ok(())
}

/// Minimal percent-encoding for the one thing a folder path needs escaped in a URL query
/// string: no external crate pulled in just for this.
fn urlencoding_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
```

- [ ] **Step 3: Register the manager and the new commands**

In `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod commands;

use explorer_terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .manage(TerminalManager::new())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Allow the terminal window to use window controls**

The custom `TitleBar` (minimize/maximize/close/drag) needs its window label covered by a
capability. In `apps/desktop/src-tauri/capabilities/default.json`, change `"windows"`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main", "terminal"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "clipboard-manager:allow-write-text",
    "updater:default",
    "process:default"
  ]
}
```

- [ ] **Step 5: Verify it builds**

Run: `cargo build --workspace`
Expected: builds cleanly (warnings, if any, are pre-existing — don't fix unrelated ones here).

- [ ] **Step 6: Run the full Rust test suite**

Run: `cargo test --workspace`
Expected: every existing test still passes, plus the 8 new `explorer-terminal` tests.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "Wire terminal PTY commands and the detached terminal window into the app"
```

---

### Task 4: Frontend — xterm.js dependency and window routing

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/windowRouting.ts`
- Create: `apps/desktop/src/windowRouting.test.ts`
- Modify: `apps/desktop/src/main.tsx`

- [ ] **Step 1: Add the xterm.js dependency**

In `apps/desktop/package.json`, add to `"dependencies"`:

```json
"@xterm/addon-fit": "^0.10.0",
"@xterm/xterm": "^5.5.0",
```

Run: `cd apps/desktop && npm install`
Expected: `package-lock.json` updates to include the two new packages; no errors.

- [ ] **Step 2: Write the failing test for window routing**

`apps/desktop/src/windowRouting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTerminalWindow } from "./windowRouting";

describe("isTerminalWindow", () => {
  it("is true when the window query param is 'terminal'", () => {
    expect(isTerminalWindow("?window=terminal")).toBe(true);
  });

  it("is false with no query string", () => {
    expect(isTerminalWindow("")).toBe(false);
  });

  it("is false for an unrelated window param", () => {
    expect(isTerminalWindow("?window=settings")).toBe(false);
  });

  it("is true alongside other query params", () => {
    expect(isTerminalWindow("?cwd=C%3A%5Cfoo&window=terminal")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/desktop && npm test -- --run windowRouting`
Expected: FAIL — `windowRouting.ts` doesn't exist yet.

- [ ] **Step 4: Implement it**

`apps/desktop/src/windowRouting.ts`:

```ts
/** True when this webview was opened as the detached terminal window (`?window=terminal`),
 * false for the main explorer window. Read once at startup in `main.tsx` to pick which React
 * root to render — each Tauri window loads the same `index.html`/`main.tsx` bundle. */
export function isTerminalWindow(search: string): boolean {
  return new URLSearchParams(search).get("window") === "terminal";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/desktop && npm test -- --run windowRouting`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire it into main.tsx**

`apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TerminalWindow from "./terminal/TerminalWindow";
import { isTerminalWindow } from "./windowRouting";

const Root = isTerminalWindow(window.location.search) ? TerminalWindow : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
```

This references `./terminal/TerminalWindow`, created in Task 6 — `npx tsc --noEmit` will fail
until then, which is expected and resolved by the end of this plan, not this step.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/src/windowRouting.ts apps/desktop/src/windowRouting.test.ts apps/desktop/src/main.tsx
git commit -m "Add xterm.js dependency and terminal-window routing in main.tsx"
```

---

### Task 5: Frontend — tab state and TitleBar title prop

**Files:**
- Create: `apps/desktop/src/terminal/tabs.ts`
- Create: `apps/desktop/src/terminal/tabs.test.ts`
- Modify: `apps/desktop/src/components/TitleBar.tsx`

- [ ] **Step 1: Write the failing tests for tab state**

`apps/desktop/src/terminal/tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addTab, initialTabs, removeTab } from "./tabs";

describe("initialTabs", () => {
  it("starts with exactly one tab", () => {
    expect(initialTabs().tabs).toHaveLength(1);
  });
});

describe("addTab", () => {
  it("appends a new tab with a key distinct from existing ones", () => {
    const state = addTab(initialTabs());

    expect(state.tabs).toHaveLength(2);
    expect(new Set(state.tabs).size).toBe(2);
  });

  it("keeps generating distinct keys across repeated calls", () => {
    const state = addTab(addTab(addTab(initialTabs())));

    expect(new Set(state.tabs).size).toBe(4);
  });
});

describe("removeTab", () => {
  it("removes the given tab's key", () => {
    const withTwo = addTab(initialTabs());
    const [firstKey] = withTwo.tabs;

    const result = removeTab(withTwo, firstKey);

    expect(result.tabs).not.toContain(firstKey);
    expect(result.tabs).toHaveLength(1);
  });

  it("can remove every tab, leaving an empty list", () => {
    const state = initialTabs();

    const result = removeTab(state, state.tabs[0]);

    expect(result.tabs).toHaveLength(0);
  });

  it("removing a key that isn't present is a no-op", () => {
    const state = initialTabs();

    const result = removeTab(state, "not-a-real-key");

    expect(result.tabs).toEqual(state.tabs);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run terminal/tabs`
Expected: FAIL — `tabs.ts` doesn't exist yet.

- [ ] **Step 3: Implement it**

`apps/desktop/src/terminal/tabs.ts`:

```ts
export interface TerminalTabState {
  tabs: string[];
  nextKey: number;
}

/** One tab to start, matching the "single window, multiple tabs" design — the terminal window
 * always opens with a shell ready to use, not an empty tab strip. */
export function initialTabs(): TerminalTabState {
  return { tabs: ["tab-1"], nextKey: 2 };
}

export function addTab(state: TerminalTabState): TerminalTabState {
  const key = `tab-${state.nextKey}`;
  return { tabs: [...state.tabs, key], nextKey: state.nextKey + 1 };
}

export function removeTab(state: TerminalTabState, key: string): TerminalTabState {
  return { ...state, tabs: state.tabs.filter((existing) => existing !== key) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run terminal/tabs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add a title prop to TitleBar**

`apps/desktop/src/components/TitleBar.tsx`:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

// Module-scope singleton: each Tauri window (main explorer, detached terminal) gets its own
// isolated JS module instance, so this correctly resolves to whichever window this code is
// actually running in — not always the main window.
const appWindow = getCurrentWindow();

interface TitleBarProps {
  title?: string;
}

function TitleBar({ title = "Krampus Explorer" }: TitleBarProps) {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar__title">{title}</span>
      <div className="title-bar__controls">
        <button
          className="title-bar__button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => appWindow.minimize().catch(() => {})}
        >
          &#x2013;
        </button>
        <button
          className="title-bar__button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => appWindow.toggleMaximize().catch(() => {})}
        >
          &#x25A1;
        </button>
        <button
          className="title-bar__button title-bar__button--close"
          aria-label="Close"
          title="Close"
          onClick={() => appWindow.close().catch(() => {})}
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/terminal/tabs.ts apps/desktop/src/terminal/tabs.test.ts apps/desktop/src/components/TitleBar.tsx
git commit -m "Add terminal tab-list state helpers and a TitleBar title prop"
```

---

### Task 6: Frontend — the TerminalWindow itself

**Files:**
- Create: `apps/desktop/src/terminal/TerminalWindow.tsx`
- Create: `apps/desktop/src/terminal/TerminalWindow.css`

Not unit tested — mounting xterm.js and driving a live PTY session isn't something a headless
test can meaningfully exercise (no automated GUI testing in this project either way); the pure
logic it depends on (`tabs.ts`, `windowRouting.ts`) already has coverage. Verified manually in
Task 8.

- [ ] **Step 1: Write the component**

`apps/desktop/src/terminal/TerminalWindow.tsx`:

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

interface TerminalChunk {
  data: string;
}

interface TerminalTabProps {
  cwd: string | null;
}

function TerminalTabView({ cwd }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({ convertEol: true, fontSize: 13 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    let sessionId: string | null = null;
    let cancelled = false;

    const onOutput = new Channel<TerminalChunk>();
    onOutput.onmessage = (chunk) => term.write(chunk.data);

    invoke<string>("terminal_spawn", { cwd, onOutput })
      .then((id) => {
        if (cancelled) {
          void invoke("terminal_close", { sessionId: id });
          return;
        }
        sessionId = id;
        void invoke("terminal_resize", { sessionId: id, cols: term.cols, rows: term.rows });
      })
      .catch((error: unknown) => {
        term.write(`\r\n\x1b[31mCould not start a shell: ${String(error)}\x1b[0m\r\n`);
      });

    const dataDisposable = term.onData((data) => {
      if (sessionId) void invoke("terminal_write", { sessionId, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionId) {
        void invoke("terminal_resize", { sessionId, cols: term.cols, rows: term.rows });
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (sessionId) void invoke("terminal_close", { sessionId });
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="terminal-tab" ref={containerRef} />;
}

function TerminalWindow() {
  const resolvedTheme = useResolvedTheme();
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const [tabState, setTabState] = useState<TerminalTabState>(initialTabs);
  const [activeTab, setActiveTab] = useState(tabState.tabs[0]);
  const initialCwdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get("cwd"),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleAddTab = useCallback(() => {
    setTabState((state) => {
      const next = addTab(state);
      setActiveTab(next.tabs[next.tabs.length - 1]);
      return next;
    });
  }, []);

  const handleCloseTab = useCallback((key: string) => {
    setTabState((state) => {
      const next = removeTab(state, key);
      if (next.tabs.length === 0) {
        void getCurrentWindow().close();
        return next;
      }
      setActiveTab((current) => (current === key ? next.tabs[next.tabs.length - 1] : current));
      return next;
    });
  }, []);

  return (
    <div className="terminal-window">
      <TitleBar title="Krampus Explorer — Terminal" />
      <div className="terminal-window__tabs">
        {tabState.tabs.map((key, index) => (
          <div
            key={key}
            className={`terminal-window__tab ${key === activeTab ? "terminal-window__tab--active" : ""}`}
          >
            <button type="button" onClick={() => setActiveTab(key)}>
              Shell {index + 1}
            </button>
            <button
              type="button"
              className="terminal-window__tab-close"
              aria-label="Close tab"
              onClick={() => handleCloseTab(key)}
            >
              &#x2715;
            </button>
          </div>
        ))}
        <button type="button" className="terminal-window__new-tab" aria-label="New tab" onClick={handleAddTab}>
          +
        </button>
      </div>
      <div className="terminal-window__body">
        {tabState.tabs.map((key) => (
          // Hidden via CSS rather than unmounted when not the active tab — matches
          // PluginPanel's pattern in ../sidebar/PluginPanel.tsx: a real PTY session is running
          // underneath, and unmounting would kill it just for switching tabs.
          <div
            key={key}
            className="terminal-window__pane"
            style={key === activeTab ? undefined : { display: "none" }}
          >
            <TerminalTabView cwd={key === tabState.tabs[0] ? initialCwdRef.current : null} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TerminalWindow;
```

- [ ] **Step 2: Add styles**

`apps/desktop/src/terminal/TerminalWindow.css`:

```css
.terminal-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.terminal-window__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.terminal-window__tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: transparent;
  font-size: 12px;
}

.terminal-window__tab--active {
  background: var(--bg);
  border-color: var(--border);
}

.terminal-window__tab button {
  background: transparent;
  border: none;
  color: var(--fg);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}

.terminal-window__tab-close {
  color: var(--fg-muted);
}

.terminal-window__new-tab {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 8px;
}

.terminal-window__body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.terminal-window__pane {
  position: absolute;
  inset: 0;
}

.terminal-tab {
  height: 100%;
  padding: 4px;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors (this resolves the `main.tsx` import from Task 4).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/terminal/TerminalWindow.tsx apps/desktop/src/terminal/TerminalWindow.css
git commit -m "Add the TerminalWindow component: xterm.js tabs over the PTY commands"
```

---

### Task 7: Plugin API — `ui.terminal` permission

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`, add `"ui.terminal"` to `ALL_PERMISSIONS`,
`"openTerminal"` to `ALL_METHODS`, `openTerminal: vi.fn().mockResolvedValue(undefined),` to the
`handlers()` mock, and a new row to the `it.each` permission table:

```ts
["ui.terminal", ["openTerminal"]],
```

Also add a dedicated forwarding test alongside the other single-purpose ones (e.g. near the
`runCommand` test):

```ts
  it("openTerminal calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["ui.terminal"]), h);

    await api.openTerminal?.();

    expect(h.openTerminal).toHaveBeenCalledWith();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL — `openTerminal` doesn't exist on `PluginApiHandlers`/`createPluginApi` yet.

- [ ] **Step 3: Add the type**

In `apps/desktop/src/types/plugin.ts`, add to `PluginApi`:

```ts
  /** Present only if the plugin's manifest declares the "ui.terminal" permission. Opens the
   * detached terminal window (creating it if it doesn't exist yet, else focusing it) — a real
   * interactive shell with tabs, running as core-app functionality rather than sandboxed plugin
   * code. */
  openTerminal?: () => Promise<void>;
```

- [ ] **Step 4: Wire it into createPluginApi**

In `apps/desktop/src/plugins/pluginApi.ts`, add to `PluginApiHandlers`:

```ts
  openTerminal: () => Promise<void>;
```

And in `createPluginApi`, alongside the other `if (has(...))` blocks:

```ts
  if (has("ui.terminal")) {
    api.openTerminal = () => handlers.openTerminal();
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: PASS.

- [ ] **Step 6: Wire the real handler**

In `apps/desktop/src/stores/usePluginStore.ts`, add to the `createPluginApi(manifest, { ... })`
handlers object (near `runCommand`):

```ts
          openTerminal: () => invoke<void>("open_terminal_window", { cwd: getCurrentFolderPath() }),
```

- [ ] **Step 7: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; every test file passes.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/types/plugin.ts apps/desktop/src/plugins/pluginApi.ts apps/desktop/src/plugins/pluginApi.test.ts apps/desktop/src/stores/usePluginStore.ts
git commit -m "Add the ui.terminal permission and api.openTerminal()"
```

---

### Task 8: Rename the plugin `run-command` → `terminal`

**Files:**
- Rename: `examples/plugins/run-command/` → `examples/plugins/terminal/`
- Modify: `examples/plugins/terminal/manifest.json`
- Modify: `examples/plugins/terminal/frontend/index.js`
- Modify: `examples/plugins/terminal/README.md`
- Modify: `examples/plugins/terminal/icon.png`
- Modify: `marketplace.json`
- Modify: `README.md` (repo root)

- [ ] **Step 1: Rename the directory, preserving history**

```bash
git mv examples/plugins/run-command examples/plugins/terminal
```

- [ ] **Step 2: Update the manifest**

`examples/plugins/terminal/manifest.json`:

```json
{
  "id": "terminal",
  "name": "Terminal",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "nav.read", "ui.terminal"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 3: Rewrite the entry script**

`examples/plugins/terminal/frontend/index.js`:

```js
// Entry point for the "Terminal" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange:
// "nav.read", openTerminal: "ui.terminal").
//
// The actual terminal — PTY sessions, xterm.js rendering, tabs — lives in the core app's own
// detached window, not in this sandboxed plugin. Opening a whole new OS window with raw shell
// access is a bigger capability than the plugin sandbox grants anything else; this plugin is
// just the trigger button. See docs/plugins.md's "Terminal window" section.

api.registerSidebarPanel({
  id: "terminal",
  title: "Terminal",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const cwdLabel = document.createElement("p");
    cwdLabel.style.margin = "0";
    cwdLabel.style.fontFamily = "monospace";
    cwdLabel.style.fontSize = "11px";
    cwdLabel.style.color = "var(--fg-muted)";
    cwdLabel.style.wordBreak = "break-all";

    let cwd = api.getCurrentPath?.() ?? "";
    cwdLabel.textContent = cwd || "(no folder open)";

    const unsubscribe = api.onFolderChange?.((path) => {
      cwd = path;
      cwdLabel.textContent = path;
    });

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Terminal";
    openBtn.style.cursor = "pointer";
    openBtn.addEventListener("click", () => {
      api.openTerminal();
    });

    container.appendChild(cwdLabel);
    container.appendChild(openBtn);

    return () => {
      unsubscribe?.();
    };
  },
});
```

- [ ] **Step 4: Rewrite the README**

`examples/plugins/terminal/README.md`:

```md
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
```

- [ ] **Step 5: Replace the icon**

```bash
cp assets/plugin-icons/essential/terminal.png examples/plugins/terminal/icon.png
```

- [ ] **Step 6: Update the marketplace listing**

In `marketplace.json`, replace the `run-command` entry (find it by `"id": "run-command"`) with:

```json
  {
    "id": "terminal",
    "name": "Terminal",
    "description": "Opens a detached, tabbed terminal window with a real interactive shell."
  },
```

- [ ] **Step 7: Update the root README's plugin table**

In `README.md` (repo root), find the line:

```md
| [run-command](examples/plugins/run-command) | Runs a single shell command in the current folder and shows its output |
```

Replace it with:

```md
| [terminal](examples/plugins/terminal) | Opens a detached, tabbed terminal window with a real interactive shell |
```

- [ ] **Step 8: Commit**

```bash
git add examples/plugins/terminal marketplace.json README.md
git commit -m "Rename the run-command plugin to terminal"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/plugins.md`

- [ ] **Step 1: Update the example plugin list**

Replace this line (around line 26):

```md
- `examples/plugins/run-command/` — scoped-down "run one command" via `system.exec`
```

with:

```md
- `examples/plugins/terminal/` — opens a detached interactive terminal window via `ui.terminal`
```

- [ ] **Step 2: Add the permission table row**

In the permission table, add a row after `system.exec`:

```md
| `ui.terminal` | `api.openTerminal()` |
```

- [ ] **Step 3: Add a method doc section**

After the existing `### system.exec methods` section, add:

```md
### `ui.terminal` methods

- `openTerminal(): Promise<void>` — opens the detached terminal window (creating it if it
  doesn't exist yet, else focusing the existing one). See "Terminal window" below for what that
  window actually is.
```

- [ ] **Step 4: Add a "Terminal window" explanatory section**

After the existing `## Plugin marketplace` section (before `## How entry files execute — and
why this matters`), add:

```md
## Terminal window

`api.openTerminal()` (see `ui.terminal` above) opens a second, detached Tauri window — a real
interactive terminal with tabs, built on `portable-pty` (Rust) and `xterm.js` (frontend), not
sandboxed plugin code. This is a deliberate architectural choice: today, every other plugin
capability renders into a `<div>` inside the main window's own JS context via
`new Function(...)`. Giving a plugin the ability to open its own detached OS window with raw PTY
access would be a materially bigger addition to the trust model than anything else in this SDK —
so instead, the terminal itself is core-app functionality (same tier as Settings or the file
explorer), and a plugin's only access to it is the one narrow, gated method,
`api.openTerminal()`.

Practically, this means:

- Only one terminal window exists at a time; calling `openTerminal()` again just focuses it.
- The window supports multiple tabs, each an independent shell session. Closing the last tab
  closes the window; closing the window kills every session in it.
- The shell launched is auto-detected: PowerShell (falling back to `cmd.exe`) on Windows,
  `$SHELL` (falling back to `/bin/sh`) elsewhere.
- There's no sandboxing once the window is open — it's a real shell with the app's own OS
  permissions, the same trust level `system.exec` always had (see `examples/plugins/terminal/`,
  which is what "Open Terminal" actually is).
```

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md
git commit -m "Document the ui.terminal permission and the detached terminal window"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full Rust check**

Run:
```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
Expected: `fmt` makes no changes (or only whitespace from generated code — review before
committing anything it touches); `clippy` is clean; every test passes.

- [ ] **Step 2: Full frontend check**

Run:
```bash
cd apps/desktop
npx tsc --noEmit
npm test -- --run
npm run build
```
Expected: no type errors, every test passes, build succeeds.

- [ ] **Step 3: Manual dev-mode verification**

This project doesn't run automated GUI tests; verify the actual terminal experience by hand in
dev mode (`npm run tauri dev` from `apps/desktop`, or the project's usual dev-mode launch step):

- Settings → Plugins shows "Terminal" (not "Run Command"), with the terminal icon.
- Browse to a folder, open the Terminal plugin panel, click "Open Terminal" — a new window
  opens with a working shell prompt, already in that folder.
- Type a command (e.g. `dir` / `ls`) and confirm it runs and prints output live.
- Run an interactive full-screen program (e.g. `vim` or `notepad` from the shell) and confirm it
  renders correctly — this is the real test that PTY + ANSI handling actually works, not just
  plain text I/O.
- Click "+" to open a second tab; confirm it's an independent shell (e.g. `cd` in one tab doesn't
  affect the other).
- Resize the terminal window and confirm the shell reflows (e.g. run `vim` and check it redraws
  at the new size).
- Close one tab; confirm the window stays open with the remaining tab(s) still working.
- Close the last tab (or the window directly); confirm the app doesn't leave an orphaned shell
  process running (check Task Manager for a lingering `powershell.exe`/`cmd.exe` after closing).
- Click "Open Terminal" again while the window is already open; confirm it focuses the existing
  window instead of opening a second one.

- [ ] **Step 4: Report any manual-verification failures back before considering this plan done**

If any manual check above fails, that's a real bug to fix (with its own test where the failure
is in testable logic, e.g. `tabs.ts`) — not something to note and move past.
