//! Detached-window terminal: PTY session lifecycle, shell auto-detection.

mod manager;
mod shell;

pub use manager::TerminalManager;
pub use shell::shell_candidates;
