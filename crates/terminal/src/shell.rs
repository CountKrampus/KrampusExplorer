/// Shells to try, in priority order — the first one that spawns successfully is used by
/// `TerminalManager::spawn`. Windows has no OS-level "default shell" concept, so this prefers
/// PowerShell (present on every Windows 10+ machine) and falls back to whatever `%COMSPEC%`
/// points at (normally cmd.exe). Unix reads `$SHELL`, falling back to `/bin/sh`.
pub fn shell_candidates() -> Vec<String> {
    shell_candidates_from_env(std::env::var("SHELL").ok(), std::env::var("COMSPEC").ok())
}

fn shell_candidates_from_env(
    shell_var: Option<String>,
    comspec_var: Option<String>,
) -> Vec<String> {
    #[cfg(windows)]
    {
        let _ = shell_var;
        vec![
            "powershell.exe".to_string(),
            comspec_var.unwrap_or_else(|| "cmd.exe".to_string()),
        ]
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
