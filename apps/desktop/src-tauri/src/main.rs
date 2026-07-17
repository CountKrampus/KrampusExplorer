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
