//! Resolve a Claudette workspace id into the repository context the git graph needs.

use std::path::Path;

use crate::db::Database;

/// A Claudette workspace that owns a git worktree.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceLink {
    pub id: String,
    pub name: String,
    pub worktree_path: String,
}

/// Repository-level context shared by every workspace of the same repository.
#[derive(Debug, Clone, PartialEq)]
pub struct RepoContext {
    pub repo_path: String,
    pub base_ref: Option<String>,
    pub workspaces: Vec<WorkspaceLink>,
}

/// Look up `workspace_id` in the database at `db_path` and build its repository context.
///
/// The base is the repository setting, falling back to `git::default_branch`; `None` when
/// neither resolves.
pub async fn resolve_repo_context(
    db_path: &Path,
    workspace_id: &str,
) -> Result<RepoContext, String> {
    // `Database` is not `Send`: finish every read and drop it before the first `.await`.
    let (repo, workspaces) = {
        let db = Database::open(db_path).map_err(|e| e.to_string())?;
        let all = db.list_workspaces().map_err(|e| e.to_string())?;
        let ws = all
            .iter()
            .find(|w| w.id == workspace_id)
            .ok_or_else(|| "Workspace not found".to_string())?;
        let repo = db
            .get_repository(&ws.repository_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Repository not found".to_string())?;
        let workspaces: Vec<WorkspaceLink> = all
            .iter()
            .filter(|w| w.repository_id == repo.id)
            .filter_map(|w| {
                w.worktree_path.as_ref().map(|p| WorkspaceLink {
                    id: w.id.clone(),
                    name: w.name.clone(),
                    worktree_path: p.clone(),
                })
            })
            .collect();
        (repo, workspaces)
    };

    let base_ref = match repo.base_branch.clone() {
        Some(base) => Some(base),
        None => crate::git::default_branch(&repo.path, repo.default_remote.as_deref())
            .await
            .ok(),
    };

    Ok(RepoContext {
        repo_path: repo.path,
        base_ref,
        workspaces,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{make_repo, make_workspace};

    // FR-015
    #[tokio::test]
    async fn resolve_repo_context_from_db() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        {
            let db = Database::open(&db_path).unwrap();
            db.insert_repository(&make_repo("r1", "/tmp/repo1", "repo1"))
                .unwrap();
            db.update_repository_base_branch("r1", Some("main"))
                .unwrap();
            let mut with_path = make_workspace("w1", "r1", "one");
            with_path.worktree_path = Some("/tmp/wt1".into());
            db.insert_workspace(&with_path).unwrap();
            db.insert_workspace(&make_workspace("w2", "r1", "two"))
                .unwrap();
        }

        let ctx = resolve_repo_context(&db_path, "w2").await.unwrap();
        assert_eq!(ctx.repo_path, "/tmp/repo1");
        assert_eq!(ctx.base_ref.as_deref(), Some("main"));
        assert_eq!(ctx.workspaces.len(), 1);
        assert_eq!(ctx.workspaces[0].id, "w1");
        assert_eq!(ctx.workspaces[0].worktree_path, "/tmp/wt1");

        let err = resolve_repo_context(&db_path, "nope").await.unwrap_err();
        assert_eq!(err, "Workspace not found");
    }
}
