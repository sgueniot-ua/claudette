use std::path::Path;

use tauri::State;

use claudette::diff;
use claudette::git_graph::context::resolve_repo_context;
use claudette::git_graph::{self, detail, fingerprint, worktrees};
use claudette::model::diff::FileDiff;
use claudette::model::git_graph::{CommitDetail, GitGraph, GraphFingerprint, WorktreeStateEntry};

use crate::state::AppState;

pub(crate) async fn load_git_graph_impl(
    db_path: &Path,
    workspace_id: &str,
    include_remotes: bool,
    limit: u32,
    until_hash: Option<&str>,
) -> Result<GitGraph, String> {
    let ctx = resolve_repo_context(db_path, workspace_id).await?;
    git_graph::load_git_graph(&ctx, include_remotes, limit, until_hash)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn load_git_graph_fingerprint_impl(
    db_path: &Path,
    workspace_id: &str,
    include_remotes: bool,
) -> Result<GraphFingerprint, String> {
    let ctx = resolve_repo_context(db_path, workspace_id).await?;
    let fingerprint =
        fingerprint::fingerprint(&ctx.repo_path, ctx.base_ref.as_deref(), include_remotes)
            .await
            .map_err(|e| e.to_string())?;
    Ok(GraphFingerprint { fingerprint })
}

pub(crate) async fn load_worktree_states_impl(
    db_path: &Path,
    workspace_id: &str,
) -> Result<Vec<WorktreeStateEntry>, String> {
    let ctx = resolve_repo_context(db_path, workspace_id).await?;
    worktrees::worktree_states(&ctx.repo_path)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn load_commit_detail_impl(
    db_path: &Path,
    workspace_id: &str,
    commit_hash: &str,
    include_remotes: bool,
) -> Result<CommitDetail, String> {
    let ctx = resolve_repo_context(db_path, workspace_id).await?;
    detail::commit_detail(&ctx, commit_hash, include_remotes)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn load_commit_file_diff_first_parent_impl(
    db_path: &Path,
    workspace_id: &str,
    commit_hash: &str,
    file_path: &str,
) -> Result<FileDiff, String> {
    let ctx = resolve_repo_context(db_path, workspace_id).await?;
    let raw = detail::commit_file_diff_first_parent(&ctx.repo_path, commit_hash, file_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(diff::parse_unified_diff(&raw, file_path))
}

#[tauri::command]
pub async fn load_git_graph(
    workspace_id: String,
    include_remotes: bool,
    limit: u32,
    until_hash: Option<String>,
    state: State<'_, AppState>,
) -> Result<GitGraph, String> {
    load_git_graph_impl(
        &state.db_path,
        &workspace_id,
        include_remotes,
        limit,
        until_hash.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn load_git_graph_fingerprint(
    workspace_id: String,
    include_remotes: bool,
    state: State<'_, AppState>,
) -> Result<GraphFingerprint, String> {
    load_git_graph_fingerprint_impl(&state.db_path, &workspace_id, include_remotes).await
}

#[tauri::command]
pub async fn load_worktree_states(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorktreeStateEntry>, String> {
    load_worktree_states_impl(&state.db_path, &workspace_id).await
}

#[tauri::command]
pub async fn load_commit_detail(
    workspace_id: String,
    commit_hash: String,
    include_remotes: bool,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    load_commit_detail_impl(&state.db_path, &workspace_id, &commit_hash, include_remotes).await
}

#[tauri::command]
pub async fn load_commit_file_diff_first_parent(
    workspace_id: String,
    commit_hash: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, String> {
    load_commit_file_diff_first_parent_impl(&state.db_path, &workspace_id, &commit_hash, &file_path)
        .await
}

#[cfg(test)]
mod tests {
    //! Fixture copied from `commands/diff.rs` tests: a divergent repo plus a
    //! file-backed SQLite db holding one repository and one workspace.
    use super::*;
    use claudette::db::Database;
    use claudette::model::{AgentStatus, Repository, Workspace, WorkspaceStatus};
    use std::path::PathBuf;

    fn git(dir: &Path, args: &[&str]) {
        let out = claudette::process::std_command("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git command failed to spawn");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn make_repo_row(id: &str, path: &str) -> Repository {
        Repository {
            id: id.into(),
            path: path.into(),
            name: "test-repo".into(),
            path_slug: "test-repo".into(),
            icon: None,
            created_at: String::new(),
            setup_script: None,
            custom_instructions: None,
            sort_order: 0,
            branch_rename_preferences: None,
            setup_script_auto_run: false,
            archive_script: None,
            archive_script_auto_run: false,
            base_branch: Some("main".into()),
            default_remote: None,
            required_inputs: None,
            path_valid: true,
        }
    }

    fn make_workspace_row(id: &str, repo_id: &str, worktree: &str) -> Workspace {
        Workspace {
            id: id.into(),
            repository_id: repo_id.into(),
            name: format!("ws-{id}"),
            branch_name: format!("branch-{id}"),
            worktree_path: Some(worktree.into()),
            status: WorkspaceStatus::Active,
            agent_status: AgentStatus::Idle,
            status_line: String::new(),
            created_at: String::new(),
            sort_order: 0,
            input_values: None,
        }
    }

    fn setup_repo_and_db() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let repo_dir = tmp.path().join("repo");
        std::fs::create_dir(&repo_dir).unwrap();

        git(&repo_dir, &["init", "-b", "main"]);
        git(&repo_dir, &["config", "user.email", "test@test.com"]);
        git(&repo_dir, &["config", "user.name", "Test"]);
        git(&repo_dir, &["config", "core.autocrlf", "false"]);
        std::fs::write(repo_dir.join("a.txt"), "initial\n").unwrap();
        git(&repo_dir, &["add", "."]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        let db_path = tmp.path().join("test.sqlite");
        let db = Database::open(&db_path).expect("open test db");
        db.insert_repository(&make_repo_row("r1", repo_dir.to_str().unwrap()))
            .expect("insert repo");
        db.insert_workspace(&make_workspace_row("w1", "r1", repo_dir.to_str().unwrap()))
            .expect("insert workspace");
        drop(db);

        (tmp, db_path)
    }

    // FR-015
    #[tokio::test]
    async fn commands_resolve_workspace_and_return_graph() {
        let (_tmp, db_path) = setup_repo_and_db();

        let graph = load_git_graph_impl(&db_path, "w1", false, 200, None)
            .await
            .expect("graph loads");
        assert!(
            graph.refs.iter().any(|r| r.name == "main"),
            "refs must contain main: {:?}",
            graph.refs
        );
        assert!(!graph.worktrees.is_empty(), "worktrees must not be empty");

        let fp = load_git_graph_fingerprint_impl(&db_path, "w1", false)
            .await
            .expect("fingerprint loads");
        assert_eq!(fp.fingerprint, graph.fingerprint);
    }

    #[tokio::test]
    async fn unknown_workspace_is_reported_as_error() {
        let (_tmp, db_path) = setup_repo_and_db();

        let err = load_worktree_states_impl(&db_path, "missing")
            .await
            .expect_err("unknown workspace must fail");
        assert_eq!(err, "Workspace not found");
    }
}
