use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FormatOutcome {
    Formatted,
    Cancelled,
    NoFormat,
}

/// Converts a drive letter like "D:" or "d" to the zero-based index `SHFormatDrive` expects
/// (A=0, B=1, C=2, D=3, ...).
pub fn drive_letter_to_index(drive: &str) -> Result<u32, String> {
    let letter = drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase();
    let mut chars = letter.chars();
    let ch = chars.next().ok_or_else(|| format!("Invalid drive '{drive}'"))?;
    if chars.next().is_some() || !ch.is_ascii_alphabetic() {
        return Err(format!("Invalid drive '{drive}'"));
    }
    Ok(ch as u32 - 'A' as u32)
}

/// The system/boot drive, as Windows itself identifies it -- `None` if the `SystemDrive`
/// environment variable isn't set (shouldn't happen on a real Windows install, but handled
/// gracefully rather than assumed).
pub fn get_system_drive() -> Option<String> {
    std::env::var("SystemDrive").ok()
}

fn normalize_drive(drive: &str) -> String {
    drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase()
}

/// True if `drive` is the system/boot drive. This is the authoritative, backend-side check --
/// `format_drive` below refuses to proceed if this is true, independent of whatever the
/// frontend's own dropdown filtering already did.
pub fn is_system_drive(drive: &str) -> bool {
    match get_system_drive() {
        Some(system_drive) => normalize_drive(&system_drive) == normalize_drive(drive),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letter_to_index_converts_common_letters() {
        assert_eq!(drive_letter_to_index("A:"), Ok(0));
        assert_eq!(drive_letter_to_index("D:"), Ok(3));
        assert_eq!(drive_letter_to_index("Z:"), Ok(25));
    }

    #[test]
    fn drive_letter_to_index_is_case_insensitive() {
        assert_eq!(drive_letter_to_index("d:"), Ok(3));
    }

    #[test]
    fn drive_letter_to_index_handles_a_trailing_backslash() {
        assert_eq!(drive_letter_to_index("D:\\"), Ok(3));
    }

    #[test]
    fn drive_letter_to_index_rejects_multi_character_input() {
        assert!(drive_letter_to_index("DE:").is_err());
    }

    #[test]
    fn drive_letter_to_index_rejects_empty_input() {
        assert!(drive_letter_to_index("").is_err());
    }

    #[test]
    fn drive_letter_to_index_rejects_a_non_letter() {
        assert!(drive_letter_to_index("1:").is_err());
    }

    #[test]
    fn is_system_drive_matches_the_real_system_drive() {
        let system_drive = get_system_drive().expect("SystemDrive should be set on Windows");
        assert!(is_system_drive(&system_drive));
    }

    #[test]
    fn is_system_drive_rejects_a_different_drive() {
        let system_drive = get_system_drive().unwrap_or_default().to_uppercase();
        let other = if system_drive.starts_with('C') { "D:" } else { "C:" };
        assert!(!is_system_drive(other));
    }
}
