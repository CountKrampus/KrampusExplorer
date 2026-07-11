use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Runs `command` in `cwd` through the platform shell (`cmd /C` on Windows, `sh -c` elsewhere)
/// and captures its output. Intended for a scoped-down "Run Command" plugin, not a full
/// interactive terminal.
pub fn run_command(command: &str, cwd: &str) -> Result<CommandOutput, String> {
    let output = shell_command(command)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Could not run command: {e}"))?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[cfg(windows)]
fn shell_command(command: &str) -> Command {
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", command]);
    cmd
}

#[cfg(not(windows))]
fn shell_command(command: &str) -> Command {
    let mut cmd = Command::new("sh");
    cmd.args(["-c", command]);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn captures_stdout_and_a_zero_exit_code_on_success() {
        let dir = tempdir().unwrap();

        let result = run_command("echo hello", dir.path().to_str().unwrap()).unwrap();

        assert!(result.stdout.trim().eq_ignore_ascii_case("hello"));
        assert_eq!(result.exit_code, 0);
    }

    #[test]
    fn captures_a_nonzero_exit_code_on_failure() {
        let dir = tempdir().unwrap();

        let result = run_command("exit 3", dir.path().to_str().unwrap()).unwrap();

        assert_eq!(result.exit_code, 3);
    }

    #[test]
    fn runs_in_the_given_working_directory() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), b"x").unwrap();

        #[cfg(windows)]
        let list_cmd = "dir /b";
        #[cfg(not(windows))]
        let list_cmd = "ls";

        let result = run_command(list_cmd, dir.path().to_str().unwrap()).unwrap();

        assert!(result.stdout.contains("marker.txt"));
    }
}
