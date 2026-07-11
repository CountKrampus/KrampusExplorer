use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    /// Raw two-character `git status --porcelain` code, e.g. " M", "??", "A ".
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Could not run git (is it installed and on PATH?): {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn git_status(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    let output = run_git(repo_path, &["status", "--porcelain"])?;
    Ok(output
        .lines()
        .filter(|line| line.len() > 3)
        .map(|line| GitFileStatus {
            status: line[..2].to_string(),
            path: line[3..].to_string(),
        })
        .collect())
}

pub fn git_log(repo_path: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    const SEP: &str = "\x1f"; // unit separator; extremely unlikely to appear in commit data
    let format = format!("--pretty=format:%H{SEP}%s{SEP}%an{SEP}%ad");
    let limit_arg = format!("-n{limit}");
    let output = run_git(repo_path, &["log", &limit_arg, &format, "--date=short"])?;

    Ok(output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split(SEP).collect();
            if parts.len() != 4 {
                return None;
            }
            Some(GitCommit {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    fn init_repo_with_commit(dir: &Path) {
        let run = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(dir)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?} failed");
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "test@example.com"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("a.txt"), b"hello").unwrap();
        run(&["add", "a.txt"]);
        run(&["commit", "-q", "-m", "initial commit"]);
    }

    #[test]
    fn git_log_returns_commits_most_recent_first() {
        let dir = tempdir().unwrap();
        init_repo_with_commit(dir.path());

        let commits = git_log(dir.path().to_str().unwrap(), 10).unwrap();

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "initial commit");
        assert_eq!(commits[0].author, "Test");
    }

    #[test]
    fn git_status_reports_untracked_file() {
        let dir = tempdir().unwrap();
        init_repo_with_commit(dir.path());
        std::fs::write(dir.path().join("untracked.txt"), b"new").unwrap();

        let status = git_status(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "untracked.txt");
        assert_eq!(status[0].status, "??");
    }

    #[test]
    fn git_status_reports_modified_file() {
        let dir = tempdir().unwrap();
        init_repo_with_commit(dir.path());
        std::fs::write(dir.path().join("a.txt"), b"changed").unwrap();

        let status = git_status(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "a.txt");
        assert_eq!(status[0].status.trim(), "M");
    }

    #[test]
    fn git_status_errors_when_not_a_repo() {
        let dir = tempdir().unwrap();

        let result = git_status(dir.path().to_str().unwrap());

        assert!(result.is_err());
    }
}
