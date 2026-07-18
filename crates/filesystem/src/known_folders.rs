#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownFolder {
    Temp,
    LocalAppData,
    RoamingAppData,
    Home,
}

impl KnownFolder {
    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "temp" => Ok(KnownFolder::Temp),
            "local_app_data" => Ok(KnownFolder::LocalAppData),
            "roaming_app_data" => Ok(KnownFolder::RoamingAppData),
            "home" => Ok(KnownFolder::Home),
            other => Err(format!(
                "Unknown folder identifier '{other}' -- expected one of: temp, local_app_data, roaming_app_data, home"
            )),
        }
    }
}

/// Resolves one of a small fixed set of known system locations. This is the actual security
/// boundary for `get_known_folder`: a plugin can only ever ask for one of the four `KnownFolder`
/// variants (enforced by `KnownFolder::parse` rejecting anything else), never an arbitrary
/// environment variable name -- so this can't be used to read something sensitive like an
/// API-key env var. Returns `None` (rather than an error) when a folder can't be resolved on
/// this system, so callers can treat "unavailable" as a normal, non-fatal outcome.
pub fn get_known_folder(folder: KnownFolder) -> Option<String> {
    match folder {
        KnownFolder::Temp => Some(std::env::temp_dir().to_string_lossy().to_string()),
        KnownFolder::LocalAppData => {
            dirs::data_local_dir().map(|p| p.to_string_lossy().to_string())
        }
        KnownFolder::RoamingAppData => dirs::data_dir().map(|p| p.to_string_lossy().to_string()),
        KnownFolder::Home => dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_all_four_known_identifiers() {
        assert_eq!(KnownFolder::parse("temp"), Ok(KnownFolder::Temp));
        assert_eq!(
            KnownFolder::parse("local_app_data"),
            Ok(KnownFolder::LocalAppData)
        );
        assert_eq!(
            KnownFolder::parse("roaming_app_data"),
            Ok(KnownFolder::RoamingAppData)
        );
        assert_eq!(KnownFolder::parse("home"), Ok(KnownFolder::Home));
    }

    #[test]
    fn parse_rejects_an_arbitrary_env_var_name() {
        assert!(KnownFolder::parse("PATH").is_err());
        assert!(KnownFolder::parse("SOME_API_KEY").is_err());
    }

    #[test]
    fn temp_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::Temp);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn home_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::Home);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn local_app_data_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::LocalAppData);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }

    #[test]
    fn roaming_app_data_resolves_to_a_non_empty_path() {
        let path = get_known_folder(KnownFolder::RoamingAppData);
        assert!(path.is_some());
        assert!(!path.unwrap().is_empty());
    }
}
