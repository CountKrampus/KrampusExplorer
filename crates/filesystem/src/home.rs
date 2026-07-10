pub fn default_start_path() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_start_path_returns_non_empty_path() {
        let path = default_start_path();
        assert!(!path.is_empty());
    }
}
