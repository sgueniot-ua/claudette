//! Cheap change detector for the git graph: hashes ref tips, the worktree list and the
//! Claudette workspaces linked to them.

use std::hash::{DefaultHasher, Hash, Hasher};

use crate::git::GitError;

use super::context::RepoContext;
use super::run_git;

/// Hex digest of the displayed refs, the base ref target, the worktree list and the
/// workspace links (id, name, path) read from the database. Runs only `for-each-ref`,
/// `rev-parse` and `worktree list`, never `log` or `status`.
pub async fn fingerprint(ctx: &RepoContext, include_remotes: bool) -> Result<String, GitError> {
    let repo = ctx.repo_path.as_str();
    let mut args = vec![
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads",
    ];
    if include_remotes {
        args.push("refs/remotes");
    }
    let refs = run_git(repo, &args).await?;
    let base = match ctx.base_ref.as_deref() {
        // An unresolvable base simply hashes as empty, like the graph ignoring it.
        Some(base) => run_git(repo, &["rev-parse", "--verify", "--quiet", base])
            .await
            .unwrap_or_default(),
        None => String::new(),
    };
    let worktrees = run_git(repo, &["worktree", "list", "--porcelain"]).await?;
    // Sorted so a workspace reordering alone does not look like a change.
    let mut links: Vec<(&str, &str, &str)> = ctx
        .workspaces
        .iter()
        .map(|w| (w.id.as_str(), w.name.as_str(), w.worktree_path.as_str()))
        .collect();
    links.sort_unstable();

    let mut hasher = DefaultHasher::new();
    refs.hash(&mut hasher);
    base.hash(&mut hasher);
    worktrees.hash(&mut hasher);
    links.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::context::WorkspaceLink;
    use crate::git_graph::test_support::{commit, git, repo};

    // FR-012 SC-004
    #[tokio::test]
    async fn fingerprint_changes_only_on_ref_or_worktree_change() {
        let dir = repo().await;
        let d = dir.path();
        let context = RepoContext {
            repo_path: d.to_str().unwrap().to_string(),
            base_ref: Some("main".to_string()),
            workspaces: vec![],
        };
        let fp = || async { fingerprint(&context, false).await.unwrap() };

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

    // FR-005 FR-012
    #[tokio::test]
    async fn fingerprint_changes_on_workspace_rename_not_reorder() {
        let dir = repo().await;
        let link = |id: &str, name: &str| WorkspaceLink {
            id: id.to_string(),
            name: name.to_string(),
            worktree_path: format!("/tmp/{id}"),
        };
        let mut context = RepoContext {
            repo_path: dir.path().to_str().unwrap().to_string(),
            base_ref: Some("main".to_string()),
            workspaces: vec![link("a", "alpha"), link("b", "beta")],
        };
        let first = fingerprint(&context, false).await.unwrap();

        context.workspaces.reverse();
        assert_eq!(first, fingerprint(&context, false).await.unwrap());

        context.workspaces[0].name = "renamed".to_string();
        assert_ne!(first, fingerprint(&context, false).await.unwrap());
    }
}
