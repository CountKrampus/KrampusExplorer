#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if let Some(recovery_args) = parse_recovery_scan_args(&args) {
        krampus_explorer_lib::run_recovery_scan(
            recovery_args.drive,
            recovery_args.destination,
            recovery_args.file_types,
            recovery_args.result_file,
        );
        return;
    }

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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecoveryScanArgs {
    drive: String,
    destination: String,
    file_types: Vec<String>,
    result_file: String,
}

/// Parses `--recovery-scan` and its four required arguments out of the process's command-line
/// arguments. Returns `None` for a normal app launch, or if `--recovery-scan` is present but
/// missing any required argument (treated as "not a recovery scan launch" rather than a partial/
/// broken one -- there's no sensible way to run a scan without all four). See
/// `explorer_recovery::relaunch_recovery_scan` for what constructs this command line.
fn parse_recovery_scan_args(args: &[String]) -> Option<RecoveryScanArgs> {
    if !args.iter().any(|a| a == "--recovery-scan") {
        return None;
    }
    let drive = args
        .iter()
        .find_map(|a| a.strip_prefix("--drive=").map(String::from))?;
    let destination = args
        .iter()
        .find_map(|a| a.strip_prefix("--dest=").map(String::from))?;
    let types = args
        .iter()
        .find_map(|a| a.strip_prefix("--types=").map(String::from))?;
    let result_file = args
        .iter()
        .find_map(|a| a.strip_prefix("--result-file=").map(String::from))?;

    Some(RecoveryScanArgs {
        drive,
        destination,
        file_types: types.split(',').map(String::from).collect(),
        result_file,
    })
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

    #[test]
    fn normal_launch_is_not_recovery_scan() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }

    #[test]
    fn recovery_scan_flag_extracts_all_four_arguments() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
            "--dest=C:\\Recovered".to_string(),
            "--types=jpeg,png".to_string(),
            "--result-file=C:\\Temp\\progress.json".to_string(),
        ];
        assert_eq!(
            parse_recovery_scan_args(&args),
            Some(RecoveryScanArgs {
                drive: "D:".to_string(),
                destination: "C:\\Recovered".to_string(),
                file_types: vec!["jpeg".to_string(), "png".to_string()],
                result_file: "C:\\Temp\\progress.json".to_string(),
            })
        );
    }

    #[test]
    fn recovery_scan_flag_missing_a_required_argument_yields_none() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
        ];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }
}
