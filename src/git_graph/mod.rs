//! Read-only git graph (commit tree, refs, worktrees) for the git tree view.

use crate::git::GitError;

pub mod context;
pub mod log;
pub mod refs;
#[cfg(test)]
pub(crate) mod test_support;
pub mod worktrees;

/// Number of commits loaded per page.
pub const PAGE_SIZE: u32 = 200;
/// Hard cap on the number of commits ever loaded.
pub const MAX_COMMITS: u32 = 10_000;

/// Run a read-only git command in `repo`; stdout is trimmed.
pub(crate) async fn run_git(repo: &str, args: &[&str]) -> Result<String, GitError> {
    let output = crate::process::command(crate::git::resolve_git_path_blocking())
        .args(["-C", repo])
        .args(args)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(GitError::from_spawn_io)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(GitError::CommandFailed(stderr))
    }
}

/// Accept 4..=40 hex characters, reject anything else.
pub fn validate_hash(hash: &str) -> Result<(), GitError> {
    if (4..=40).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::CommandFailed("Invalid commit hash".to_string()))
    }
}
