use std::path::Path;

use super::run_git;

/// Temporary repo on `main` with user config and one initial commit.
pub async fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-b", "main"]).await;
    git(dir.path(), &["config", "user.email", "test@test.com"]).await;
    git(dir.path(), &["config", "user.name", "Test"]).await;
    git(dir.path(), &["commit", "--allow-empty", "-m", "initial"]).await;
    dir
}

/// Run git in `dir`, panicking on error.
pub async fn git(dir: &Path, args: &[&str]) -> String {
    run_git(dir.to_str().unwrap(), args).await.unwrap()
}

/// Empty commit with `msg`; returns the new HEAD hash.
pub async fn commit(dir: &Path, msg: &str) -> String {
    git(dir, &["commit", "--allow-empty", "-m", msg]).await;
    git(dir, &["rev-parse", "HEAD"]).await
}
