//! Rules for project chats: chats whose workspace is rooted in the user's own
//! repository checkout (`WorkspaceKind::Repository`) instead of a dedicated
//! worktree. Shared by every surface (Tauri commands, IPC, server) so the
//! checkout is protected the same way everywhere.

use std::path::Path;

use crate::db::Database;
use crate::model::Workspace;
use crate::ops::workspace::PROJECT_CHAT_REFUSAL;
use crate::{git, snapshot};

/// Guard for worktree-only operations: a project chat runs in the user's own
/// repository checkout, so it must never be set up, renamed, archived,
/// restored or deleted like a worktree workspace.
pub fn reject_if_repository_rooted(ws: &Workspace) -> Result<(), String> {
    if ws.is_repository_rooted() {
        Err(PROJECT_CHAT_REFUSAL.to_string())
    } else {
        Ok(())
    }
}

/// Per-id bulk-delete decision: true when `id` names a repository-rooted
/// workspace (project chat), which must be refused whatever its status.
pub fn is_refused_project_chat(workspaces: &[Workspace], id: &str) -> bool {
    workspaces
        .iter()
        .any(|w| w.id == id && w.is_repository_rooted())
}

/// Project chats (repository-rooted workspaces) may legitimately have zero
/// active sessions, so closing the last one never auto-creates a replacement.
pub fn effective_auto_replace(ws: &Workspace, requested: Option<bool>) -> bool {
    !ws.is_repository_rooted() && requested.unwrap_or(true)
}

/// Worktree paths to remove/unwatch when a repository is removed. Excludes
/// project-chat rows (`kind = repository`): their path is the repository
/// checkout itself, which must stay intact.
pub fn worktree_paths_to_remove(workspaces: &[&Workspace]) -> Vec<String> {
    workspaces
        .iter()
        .filter(|w| !w.is_repository_rooted())
        .filter_map(|w| w.worktree_path.clone())
        .collect()
}

/// Working directory for an agent turn. A project chat (repository-rooted
/// workspace) runs in the user's own checkout, which can be deleted or moved
/// behind Claudette's back, so a missing folder is reported explicitly.
pub fn resolve_agent_cwd(ws: &Workspace) -> Result<String, String> {
    let path = ws
        .worktree_path
        .as_ref()
        .ok_or("Workspace has no worktree")?;
    if ws.is_repository_rooted() && !Path::new(path).is_dir() {
        return Err(format!("Project folder not found: {path}"));
    }
    Ok(path.clone())
}

/// Restore the files of a workspace before its conversation is cleared.
///
/// - Project chat (repository-rooted): restore the session's baseline
///   snapshot, i.e. the folder as it was before the chat's first message.
///   No git history is touched (FR-015). Without a baseline holding files,
///   refuse rather than guess — restoring an empty snapshot would delete
///   every file in the user's checkout.
/// - Worktree workspace: reset the worktree to the merge-base with the
///   repository's base branch (unchanged behavior).
pub async fn restore_files_for_clear(
    db_path: &Path,
    ws: &Workspace,
    chat_session_id: &str,
) -> Result<(), String> {
    let wt = ws
        .worktree_path
        .as_ref()
        .ok_or("Workspace has no worktree")?;

    if ws.is_repository_rooted() {
        if !Path::new(wt).is_dir() {
            return Err(format!("Project folder not found: {wt}"));
        }
        let baseline = {
            let db = Database::open(db_path).map_err(|e| e.to_string())?;
            db.get_session_baseline(chat_session_id)
                .map_err(|e| e.to_string())?
        };
        let baseline = baseline
            .filter(|b| b.has_file_state)
            .ok_or("No starting state to restore for this chat")?;
        return snapshot::restore_snapshot_in_checkout(db_path, &baseline.id, wt)
            .await
            .map_err(|e| e.to_string());
    }

    let repo = {
        let db = Database::open(db_path).map_err(|e| e.to_string())?;
        db.list_repositories()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|r| r.id == ws.repository_id)
            .ok_or("Repository not found")?
    };
    let base = match repo.base_branch.as_deref() {
        Some(b) => b.to_string(),
        None => git::default_branch(&repo.path, repo.default_remote.as_deref())
            .await
            .map_err(|e| e.to_string())?,
    };
    let merge_base = crate::diff::merge_base(wt, &ws.branch_name, &base)
        .await
        .map_err(|e| e.to_string())?;
    git::restore_to_commit(wt, &merge_base)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AgentStatus, Repository, WorkspaceKind, WorkspaceStatus};

    fn guard_fixture(kind: WorkspaceKind) -> Workspace {
        Workspace {
            id: "w".into(),
            repository_id: "r".into(),
            name: "n".into(),
            branch_name: "main".into(),
            worktree_path: Some("/tmp/repo".into()),
            status: WorkspaceStatus::Active,
            kind,
            agent_status: AgentStatus::Idle,
            status_line: String::new(),
            created_at: "0".into(),
            sort_order: 0,
            input_values: None,
        }
    }

    fn ws_at(id: &str, kind: WorkspaceKind, path: Option<&str>) -> Workspace {
        let mut ws = guard_fixture(kind);
        ws.id = id.into();
        ws.repository_id = "r1".into();
        ws.name = id.into();
        ws.worktree_path = path.map(Into::into);
        ws
    }

    fn make_repo(id: &str, path: &str) -> Repository {
        Repository {
            id: id.into(),
            path: path.into(),
            name: id.into(),
            path_slug: id.into(),
            icon: None,
            created_at: String::new(),
            setup_script: None,
            custom_instructions: None,
            sort_order: 0,
            branch_rename_preferences: None,
            setup_script_auto_run: false,
            archive_script: None,
            archive_script_auto_run: false,
            base_branch: None,
            default_remote: None,
            required_inputs: None,
            path_valid: true,
        }
    }

    #[test]
    fn project_chat_guard_refuses_repository_workspace() {
        // FR-003, FR-012: delete_workspace, run_workspace_setup, rename_workspace,
        // archive_workspace_inner and restore_workspace all call this guard
        // before any effect.
        let ws = guard_fixture(WorkspaceKind::Repository);
        assert_eq!(
            reject_if_repository_rooted(&ws),
            Err("Not available for project chats".to_string())
        );
    }

    #[test]
    fn project_chat_guard_bulk_delete_refuses_repository_rows_only() {
        // FR-003, FR-012
        let mut active_repo = guard_fixture(WorkspaceKind::Repository);
        active_repo.id = "repo-active".into();
        let mut archived_repo = guard_fixture(WorkspaceKind::Repository);
        archived_repo.id = "repo-archived".into();
        archived_repo.status = WorkspaceStatus::Archived;
        let mut archived_wt = guard_fixture(WorkspaceKind::Worktree);
        archived_wt.id = "wt-archived".into();
        archived_wt.status = WorkspaceStatus::Archived;
        let all = vec![active_repo, archived_repo, archived_wt];

        assert!(is_refused_project_chat(&all, "repo-active"));
        assert!(is_refused_project_chat(&all, "repo-archived"));
        assert!(!is_refused_project_chat(&all, "wt-archived"));
        assert!(!is_refused_project_chat(&all, "missing"));
    }

    #[test]
    fn project_chat_guard_allows_worktree_workspace() {
        // FR-012
        let ws = guard_fixture(WorkspaceKind::Worktree);
        assert_eq!(reject_if_repository_rooted(&ws), Ok(()));
    }

    #[test]
    fn archive_last_project_chat_does_not_recreate_session() {
        // FR-007
        let ws = ws_at("w1", WorkspaceKind::Repository, None);
        assert!(!effective_auto_replace(&ws, Some(true)));
        assert!(!effective_auto_replace(&ws, None));
        let worktree = ws_at("w2", WorkspaceKind::Worktree, None);
        assert!(effective_auto_replace(&worktree, None));
        assert!(effective_auto_replace(&worktree, Some(true)));
        assert!(!effective_auto_replace(&worktree, Some(false)));

        let db = Database::open_in_memory().unwrap();
        db.insert_repository(&make_repo("r1", "/tmp/r1")).unwrap();
        db.insert_workspace(&ws).unwrap();
        // insert_workspace seeds one default session.
        let sessions = db.list_chat_sessions_for_workspace("w1", false).unwrap();
        assert_eq!(sessions.len(), 1);
        db.archive_chat_session_only(&sessions[0].id).unwrap();
        assert_eq!(db.active_session_count_for_workspace("w1").unwrap(), 0);
    }

    #[test]
    fn worktree_paths_to_remove_skips_project_chat_rows() {
        // FR-013: removing a project must never delete the repository folder.
        let project = ws_at("p", WorkspaceKind::Repository, Some("/repo"));
        let wt = ws_at("w", WorkspaceKind::Worktree, Some("/wt"));
        let none = ws_at("n", WorkspaceKind::Worktree, None);
        assert_eq!(
            worktree_paths_to_remove(&[&project, &wt, &none]),
            vec!["/wt".to_string()]
        );
    }

    #[test]
    fn resolve_agent_cwd_reports_missing_project_folder() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("deleted");
        let ws = ws_at(
            "w1",
            WorkspaceKind::Repository,
            Some(&gone.to_string_lossy()),
        );
        let err = resolve_agent_cwd(&ws).unwrap_err();
        assert!(err.starts_with("Project folder not found"), "{err}");
    }

    #[test]
    fn resolve_agent_cwd_returns_repository_folder() {
        // FR-009, FR-010: a project chat's agent runs in the repository
        // folder itself, with the same send pipeline (permissions, plan
        // mode, attachments) as a worktree chat; the terminal opens on the
        // same `worktree_path`. Capability parity is checked manually
        // (quickstart).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let ws = ws_at("w1", WorkspaceKind::Repository, Some(&path));
        assert_eq!(resolve_agent_cwd(&ws).unwrap(), path);
    }

    #[test]
    fn resolve_agent_cwd_keeps_worktree_error() {
        let ws = ws_at("w1", WorkspaceKind::Worktree, None);
        assert_eq!(
            resolve_agent_cwd(&ws).unwrap_err(),
            "Workspace has no worktree"
        );
    }

    /// Temp DB holding one project-chat workspace rooted at `folder`.
    /// Returns the DB path, the workspace and its default chat session id.
    fn project_db(db_dir: &Path, folder: &Path) -> (std::path::PathBuf, Workspace, String) {
        let path = folder.to_string_lossy().into_owned();
        let db_path = db_dir.join("test.db");
        let db = Database::open(&db_path).unwrap();
        let mut ws = ws_at("w1", WorkspaceKind::Repository, Some(&path));
        ws.name = "@project".into();
        db.insert_repository(&make_repo("r1", &path)).unwrap();
        db.insert_workspace(&ws).unwrap();
        let session = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        (db_path, ws, session)
    }

    async fn git_init(dir: &Path) {
        let out = crate::process::command(crate::git::resolve_git_path_blocking())
            .arg("init")
            .arg(dir)
            .output()
            .await
            .unwrap();
        assert!(out.status.success());
    }

    #[tokio::test]
    async fn clear_conversation_project_chat_without_baseline_errors() {
        // FR-015
        let db_dir = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        git_init(folder.path()).await;
        std::fs::write(folder.path().join("keep.txt"), "user").unwrap();
        let (db_path, ws, session) = project_db(db_dir.path(), folder.path());

        let err = restore_files_for_clear(&db_path, &ws, &session)
            .await
            .unwrap_err();
        assert_eq!(err, "No starting state to restore for this chat");
        assert_eq!(
            std::fs::read_to_string(folder.path().join("keep.txt")).unwrap(),
            "user"
        );
    }

    #[tokio::test]
    async fn clear_conversation_project_chat_restores_baseline() {
        // FR-015
        let db_dir = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        git_init(folder.path()).await;
        std::fs::write(folder.path().join("a.txt"), "before").unwrap();
        let (db_path, ws, session) = project_db(db_dir.path(), folder.path());
        let folder_str = folder.path().to_str().unwrap();
        crate::chat::create_session_baseline(&db_path, "w1", &session, folder_str)
            .await
            .expect("baseline");

        std::fs::write(folder.path().join("a.txt"), "agent").unwrap();
        std::fs::write(folder.path().join("b.txt"), "agent").unwrap();

        restore_files_for_clear(&db_path, &ws, &session)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.path().join("a.txt")).unwrap(),
            "before"
        );
        assert!(!folder.path().join("b.txt").exists());
    }

    #[tokio::test]
    async fn clear_conversation_project_chat_refuses_file_less_baseline() {
        // FR-015: a baseline whose files were purged must not wipe the folder.
        let db_dir = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        git_init(folder.path()).await;
        std::fs::write(folder.path().join("keep.txt"), "user").unwrap();
        let (db_path, ws, session) = project_db(db_dir.path(), folder.path());
        let db = Database::open(&db_path).unwrap();
        assert!(db.insert_session_baseline("base", "w1", &session).unwrap());
        drop(db);

        let err = restore_files_for_clear(&db_path, &ws, &session)
            .await
            .unwrap_err();
        assert_eq!(err, "No starting state to restore for this chat");
        assert!(folder.path().join("keep.txt").exists());
    }

    #[tokio::test]
    async fn clear_conversation_project_chat_missing_folder_errors() {
        let db_dir = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let (db_path, ws, session) = project_db(db_dir.path(), folder.path());
        let path = folder.path().to_string_lossy().into_owned();
        drop(folder);

        let err = restore_files_for_clear(&db_path, &ws, &session)
            .await
            .unwrap_err();
        assert_eq!(err, format!("Project folder not found: {path}"));
    }
}
