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
