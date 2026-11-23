//! Cheap change detector for the git graph: hashes ref tips and the worktree list.

use std::hash::{DefaultHasher, Hash, Hasher};

use crate::git::GitError;

use super::run_git;

/// Hex digest of the displayed refs, the base ref target and the worktree list. Runs only
/// `for-each-ref`, `rev-parse` and `worktree list`, never `log` or `status`.
pub async fn fingerprint(
    repo: &str,
    base_ref: Option<&str>,
    include_remotes: bool,
) -> Result<String, GitError> {
    let mut args = vec![
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads",
    ];
    if include_remotes {
        args.push("refs/remotes");
    }
    let refs = run_git(repo, &args).await?;
    let base = match base_ref {
        // An unresolvable base simply hashes as empty, like the graph ignoring it.
        Some(base) => run_git(repo, &["rev-parse", "--verify", "--quiet", base])
            .await
            .unwrap_or_default(),
        None => String::new(),
    };
    let worktrees = run_git(repo, &["worktree", "list", "--porcelain"]).await?;

    let mut hasher = DefaultHasher::new();
    refs.hash(&mut hasher);
    base.hash(&mut hasher);
    worktrees.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::test_support::{commit, git, repo};

    // FR-012 SC-004
    #[tokio::test]
    async fn fingerprint_changes_only_on_ref_or_worktree_change() {
        let dir = repo().await;
        let d = dir.path();
        let p = d.to_str().unwrap();
        let fp = || async { fingerprint(p, Some("main"), false).await.unwrap() };

        let first = fp().await;
        assert_eq!(first, fp().await, "stable when nothing changed");

        commit(d, "c1").await;
        let after_commit = fp().await;
        assert_ne!(first, after_commit);

        git(d, &["branch", "feature"]).await;
        let after_branch = fp().await;
        assert_ne!(after_commit, after_branch);

        let wt = tempfile::tempdir().unwrap();
        let wt_path = wt.path().join("wt");
        git(
            d,
            &[
                "worktree",
                "add",
                "-b",
                "wt-branch",
                wt_path.to_str().unwrap(),
            ],
        )
        .await;
        let after_worktree = fp().await;
        assert_ne!(after_branch, after_worktree);
        assert_eq!(after_worktree, fp().await);

        // An untracked file does not touch refs or the worktree list.
        std::fs::write(d.join("untracked.txt"), "x").unwrap();
        assert_eq!(after_worktree, fp().await);
    }
}
