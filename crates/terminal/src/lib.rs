//! Detached-window terminal: PTY session lifecycle, shell auto-detection.

mod elevation;
mod manager;
mod shell;

pub use elevation::{is_elevated, relaunch_elevated_terminal};
pub use manager::TerminalManager;
pub use shell::shell_candidates;
