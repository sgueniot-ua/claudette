use std::collections::HashMap;

use claudette::activity::{session_status, workspace_activity};
use claudette::db::Database;
use claudette::model::{SessionActivity, WorkspaceActivity, WorkspaceStatus};

use crate::snapshot::attention_kind_from_pending;
use crate::ws::{self, ServerState};

/// Emitted when a session's activity changes without any stream event
/// (answer submitted, approval, stop). Paired clients re-read
/// `get_workspaces_activity` on receipt.
const ACTIVITY_CHANGED_EVENT: &str = "agent-activity-changed";

pub(crate) fn emit_activity_changed(
    state: &ServerState,
    workspace_id: &str,
    chat_session_id: &str,
) {
    state.emit(serde_json::json!({
        "event": ACTIVITY_CHANGED_EVENT,
        "payload": {
            "workspace_id": workspace_id,
            "chat_session_id": chat_session_id,
        },
    }));
}

/// Activity of every active workspace, from the DB (workspaces and their
/// non-archived sessions) overlaid with the live agent map. The standalone
/// server tracks no background tasks, so `IdleWithBackground` never appears.
pub(crate) fn build_workspaces_activity(
    db: &Database,
    agents: &HashMap<String, ws::AgentSessionState>,
) -> Result<Vec<WorkspaceActivity>, String> {
    let workspaces = db.list_workspaces().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for workspace in workspaces
        .into_iter()
        .filter(|w| w.status == WorkspaceStatus::Active)
    {
        let sessions = db
            .list_chat_sessions_for_workspace(&workspace.id, false)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|s| session_activity(s.id, agents))
            .collect();
        result.push(workspace_activity(workspace.id, sessions));
    }
    Ok(result)
}

fn session_activity(
    session_id: String,
    agents: &HashMap<String, ws::AgentSessionState>,
) -> SessionActivity {
    match agents.get(&session_id) {
        Some(agent) => SessionActivity {
            agent_status: session_status(agent.active_pid.is_some(), false),
            needs_attention: !agent.pending_permissions.is_empty(),
            attention_kind: attention_kind_from_pending(&agent.pending_permissions),
            session_id,
        },
        None => SessionActivity {
            session_id,
            agent_status: session_status(false, false),
            needs_attention: false,
            attention_kind: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handler::handle_stop_agent;
    use claudette::model::{AgentStatus, AttentionKind, Repository, Workspace};

    fn make_repo(id: &str) -> Repository {
        Repository {
            id: id.into(),
            path: format!("/tmp/{id}"),
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

    fn make_workspace(id: &str, repo_id: &str) -> Workspace {
        Workspace {
            id: id.into(),
            repository_id: repo_id.into(),
            name: id.into(),
            branch_name: format!("claudette/{id}"),
            worktree_path: Some(format!("/tmp/{id}")),
            status: WorkspaceStatus::Active,
            agent_status: AgentStatus::Idle,
            status_line: String::new(),
            created_at: String::new(),
            sort_order: 0,
            input_values: None,
        }
    }

    fn agent(
        workspace_id: &str,
        session_id: &str,
        active_pid: Option<u32>,
    ) -> ws::AgentSessionState {
        ws::AgentSessionState {
            workspace_id: workspace_id.into(),
            session_id: session_id.into(),
            turn_count: 1,
            active_pid,
            custom_instructions: None,
            session_resolved_env: Default::default(),
            persistent_session: None,
            pending_permissions: HashMap::new(),
            pending_message_queue: Default::default(),
            spawn_signature: String::new(),
        }
    }

    /// Temp-dir state holding repo `r1` and active workspace `w1`; returns
    /// the state and `w1`'s default chat session id.
    fn state_with_workspace(dir: &tempfile::TempDir) -> (ServerState, String) {
        let db_path = dir.path().join("test.db");
        let db = Database::open(&db_path).unwrap();
        db.insert_repository(&make_repo("r1")).unwrap();
        db.insert_workspace(&make_workspace("w1", "r1")).unwrap();
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        (ServerState::new(db_path, dir.path().join("wt")), sid)
    }

    fn pending(tool_name: &str) -> ws::PendingPermission {
        ws::PendingPermission {
            request_id: "req".into(),
            tool_name: tool_name.into(),
            original_input: serde_json::json!({}),
        }
    }

    // Standalone server edge case: no background-task tracking.
    #[tokio::test]
    async fn standalone_never_reports_background() {
        let dir = tempfile::tempdir().unwrap();
        let (state, sid) = state_with_workspace(&dir);
        state
            .agents
            .write()
            .await
            .insert(sid.clone(), agent("w1", &sid, None));
        let db = Database::open(&state.db_path).unwrap();

        let result = build_workspaces_activity(&db, &*state.agents.read().await).unwrap();

        assert!(result.iter().all(|w| {
            w.agent_status != AgentStatus::IdleWithBackground
                && w.sessions
                    .iter()
                    .all(|s| s.agent_status != AgentStatus::IdleWithBackground)
        }));
    }

    // FR-001, FR-012
    #[tokio::test]
    async fn standalone_running_and_attention() {
        let dir = tempfile::tempdir().unwrap();
        let (state, sid) = state_with_workspace(&dir);
        let mut a = agent("w1", &sid, Some(1));
        a.pending_permissions
            .insert("t1".into(), pending("ExitPlanMode"));
        state.agents.write().await.insert(sid.clone(), a);
        let db = Database::open(&state.db_path).unwrap();

        let result = build_workspaces_activity(&db, &*state.agents.read().await).unwrap();

        let session = &result[0].sessions[0];
        assert_eq!(session.agent_status, AgentStatus::Running);
        assert!(session.needs_attention);
        assert_eq!(session.attention_kind, Some(AttentionKind::Plan));
        assert_eq!(result[0].agent_status, AgentStatus::Running);
    }

    // FR-009
    #[tokio::test]
    async fn excludes_archived_workspaces_and_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let (state, sid) = state_with_workspace(&dir);
        let db = Database::open(&state.db_path).unwrap();
        let archived = db.create_chat_session("w1").unwrap();
        db.archive_chat_session_only(&archived.id).unwrap();
        db.insert_workspace(&make_workspace("w2", "r1")).unwrap();
        db.update_workspace_status("w2", &WorkspaceStatus::Archived, None)
            .unwrap();

        let result = build_workspaces_activity(&db, &HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        let ids: Vec<_> = result[0].sessions.iter().map(|s| &s.session_id).collect();
        assert_eq!(ids, vec![&sid]);
    }

    // FR-008
    #[tokio::test]
    async fn stop_emits_activity_changed() {
        let dir = tempfile::tempdir().unwrap();
        let (state, sid) = state_with_workspace(&dir);
        state
            .agents
            .write()
            .await
            .insert(sid.clone(), agent("w1", &sid, None));
        let mut rx = state.events.subscribe();

        handle_stop_agent(&state, &sid).await.unwrap();

        assert_eq!(
            rx.try_recv().unwrap(),
            serde_json::json!({
                "event": "agent-activity-changed",
                "payload": {"workspace_id": "w1", "chat_session_id": sid},
            })
        );
    }

    // FR-008: the signal goes out even when the kill fails afterwards.
    #[tokio::test]
    async fn stop_emits_even_when_kill_fails() {
        let dir = tempfile::tempdir().unwrap();
        let (state, sid) = state_with_workspace(&dir);
        // A pid that cannot exist, so `kill -9` fails.
        state
            .agents
            .write()
            .await
            .insert(sid.clone(), agent("w1", &sid, Some(2_000_000_000)));
        let mut rx = state.events.subscribe();

        assert!(handle_stop_agent(&state, &sid).await.is_err());

        assert_eq!(rx.try_recv().unwrap()["event"], "agent-activity-changed");
    }
}
