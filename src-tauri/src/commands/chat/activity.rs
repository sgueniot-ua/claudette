use std::collections::HashMap;

use tauri::{AppHandle, Emitter};

use claudette::activity::{session_status, workspace_activity};
use claudette::db::Database;
use claudette::model::{AttentionKind, SessionActivity, WorkspaceActivity, WorkspaceStatus};

use crate::state::AgentSessionState;

/// Emitted when a session's activity state changes without any stream event
/// (attention cleared, answer submitted, stop, background task ended). Paired
/// clients re-read `get_workspaces_activity` on receipt.
pub(crate) const ACTIVITY_CHANGED_EVENT: &str = "agent-activity-changed";

pub(crate) fn activity_changed_payload(
    workspace_id: &str,
    chat_session_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "workspace_id": workspace_id,
        "chat_session_id": chat_session_id,
    })
}

pub(crate) fn emit_activity_changed(app: &AppHandle, workspace_id: &str, chat_session_id: &str) {
    let _ = app.emit(
        ACTIVITY_CHANGED_EVENT,
        activity_changed_payload(workspace_id, chat_session_id),
    );
}

/// Activity of every active workspace, from the DB (workspaces and their
/// non-archived sessions) overlaid with the live agent map. A session with no
/// agent entry is idle with no pending attention.
pub(crate) fn build_workspaces_activity(
    db: &Database,
    agents: &HashMap<String, AgentSessionState>,
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
    agents: &HashMap<String, AgentSessionState>,
) -> SessionActivity {
    match agents.get(&session_id) {
        Some(agent) => SessionActivity {
            agent_status: session_status(
                agent.active_pid.is_some(),
                agent.has_background_activity(),
            ),
            needs_attention: agent.needs_attention,
            attention_kind: agent.attention_kind.map(|k| match k {
                crate::state::AttentionKind::Ask => AttentionKind::Ask,
                crate::state::AttentionKind::Plan => AttentionKind::Plan,
            }),
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
    use claudette::model::{AgentStatus, Repository, Workspace};

    // FR-008
    #[test]
    fn activity_changed_payload_shape() {
        assert_eq!(
            activity_changed_payload("ws", "s"),
            serde_json::json!({"workspace_id": "ws", "chat_session_id": "s"})
        );
        assert_eq!(ACTIVITY_CHANGED_EVENT, "agent-activity-changed");
    }

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

    fn agent(workspace_id: &str, session_id: &str, active_pid: Option<u32>) -> AgentSessionState {
        AgentSessionState {
            workspace_id: workspace_id.into(),
            session_id: session_id.into(),
            turn_count: 1,
            active_pid,
            custom_instructions: None,
            needs_attention: false,
            attention_kind: None,
            attention_notification_sent: false,
            persistent_session: None,
            claude_remote_control: crate::state::ClaudeRemoteControlStatus::disabled(),
            claude_remote_control_monitor_pid: None,
            local_user_message_uuids: Default::default(),
            mcp_config_dirty: false,
            session_plan_mode: false,
            session_allowed_tools: Vec::new(),
            session_fast_mode: false,
            session_disable_1m_context: false,
            session_backend_hash: String::new(),
            pending_permissions: HashMap::new(),
            running_background_tasks: Default::default(),
            running_background_agents: Default::default(),
            background_wake_active: false,
            background_task_output_paths: HashMap::new(),
            session_exited_plan: false,
            session_resolved_env: Default::default(),
            session_resolved_env_signature: String::new(),
            mcp_bridge: None,
            last_user_msg_id: None,
            posted_env_trust_warning: false,
            pending_history_prelude: None,
        }
    }

    /// Opens a temp-dir DB holding repo `r1` and active workspace `w1`
    /// (which has its default session).
    fn db_with_workspace(dir: &tempfile::TempDir) -> Database {
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        db.insert_repository(&make_repo("r1")).unwrap();
        db.insert_workspace(&make_workspace("w1", "r1")).unwrap();
        db
    }

    // FR-009
    #[test]
    fn excludes_archived_workspaces_and_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let kept = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let archived = db.create_chat_session("w1").unwrap();
        db.archive_chat_session_only(&archived.id).unwrap();
        db.insert_workspace(&make_workspace("w2", "r1")).unwrap();
        db.update_workspace_status("w2", &WorkspaceStatus::Archived, None)
            .unwrap();

        let result = build_workspaces_activity(&db, &HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].workspace_id, "w1");
        let ids: Vec<_> = result[0].sessions.iter().map(|s| &s.session_id).collect();
        assert_eq!(ids, vec![&kept]);
    }

    // FR-001, FR-009
    #[test]
    fn reflects_live_agent_state() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let running = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let background = db.create_chat_session("w1").unwrap().id;
        let idle = db.create_chat_session("w1").unwrap().id;
        let mut agents = HashMap::new();
        agents.insert(running.clone(), agent("w1", &running, Some(1)));
        let mut bg = agent("w1", &background, None);
        bg.running_background_tasks.insert("t1".into());
        agents.insert(background.clone(), bg);

        let result = build_workspaces_activity(&db, &agents).unwrap();

        let ws = &result[0];
        assert_eq!(ws.agent_status, AgentStatus::Running);
        let status = |id: &String| {
            ws.sessions
                .iter()
                .find(|s| &s.session_id == id)
                .unwrap()
                .agent_status
                .clone()
        };
        assert_eq!(status(&running), AgentStatus::Running);
        assert_eq!(status(&background), AgentStatus::IdleWithBackground);
        assert_eq!(status(&idle), AgentStatus::Idle);
    }

    // FR-009
    #[test]
    fn background_only_workspace_is_idle_with_background() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let mut bg = agent("w1", &sid, None);
        bg.running_background_tasks.insert("t1".into());
        let agents = HashMap::from([(sid, bg)]);

        let result = build_workspaces_activity(&db, &agents).unwrap();

        assert_eq!(result[0].agent_status, AgentStatus::IdleWithBackground);
    }

    // FR-006, FR-009
    #[test]
    fn background_agents_alone_make_session_idle_with_background() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let mut bg = agent("w1", &sid, None);
        bg.running_background_agents.insert("a39f".into());
        // The wake gates read `running_background_tasks` only: it stays empty.
        assert!(bg.running_background_tasks.is_empty());
        let agents = HashMap::from([(sid.clone(), bg)]);

        let result = build_workspaces_activity(&db, &agents).unwrap();

        assert_eq!(result[0].agent_status, AgentStatus::IdleWithBackground);
        assert_eq!(
            result[0].sessions[0].agent_status,
            AgentStatus::IdleWithBackground
        );
    }

    // FR-006
    #[test]
    fn running_wins_over_background_agents() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let mut s = agent("w1", &sid, Some(7));
        s.running_background_agents.insert("a39f".into());
        let agents = HashMap::from([(sid, s)]);

        let result = build_workspaces_activity(&db, &agents).unwrap();

        assert_eq!(result[0].sessions[0].agent_status, AgentStatus::Running);
    }

    // FR-006, FR-008
    #[test]
    fn terminal_notification_clears_background_agent() {
        let mut s = agent("w1", "s1", None);
        s.running_background_agents.insert("a39f".into());
        s.finish_background_task("a39f", Some("toolu_1"));
        assert!(s.running_background_agents.is_empty());
        assert!(!s.has_background_activity());
    }

    // FR-012
    #[test]
    fn copies_attention() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        let mut waiting = agent("w1", &sid, None);
        waiting.needs_attention = true;
        waiting.attention_kind = Some(crate::state::AttentionKind::Plan);
        let agents = HashMap::from([(sid, waiting)]);

        let result = build_workspaces_activity(&db, &agents).unwrap();

        assert!(result[0].sessions[0].needs_attention);
        assert_eq!(
            result[0].sessions[0].attention_kind,
            Some(AttentionKind::Plan)
        );
        assert_eq!(result[0].attention_kind, Some(AttentionKind::Plan));
    }

    #[test]
    fn workspace_without_sessions_is_idle() {
        let dir = tempfile::tempdir().unwrap();
        let db = db_with_workspace(&dir);
        let sid = db.default_session_id_for_workspace("w1").unwrap().unwrap();
        db.archive_chat_session_only(&sid).unwrap();

        let result = build_workspaces_activity(&db, &HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert!(result[0].sessions.is_empty());
        assert_eq!(result[0].agent_status, AgentStatus::Idle);
        assert_eq!(result[0].attention_kind, None);
    }
}
