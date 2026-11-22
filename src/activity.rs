use crate::model::{AgentStatus, AttentionKind, SessionActivity, WorkspaceActivity};

/// Status of one chat session from the live process state.
pub fn session_status(process_active: bool, background_running: bool) -> AgentStatus {
    if process_active {
        AgentStatus::Running
    } else if background_running {
        AgentStatus::IdleWithBackground
    } else {
        AgentStatus::Idle
    }
}

/// Aggregates session statuses: Running > IdleWithBackground > Idle.
pub fn workspace_status(sessions: &[SessionActivity]) -> AgentStatus {
    if sessions
        .iter()
        .any(|s| s.agent_status == AgentStatus::Running)
    {
        AgentStatus::Running
    } else if sessions
        .iter()
        .any(|s| s.agent_status == AgentStatus::IdleWithBackground)
    {
        AgentStatus::IdleWithBackground
    } else {
        AgentStatus::Idle
    }
}

/// Ask wins over Plan; sessions whose attention was cleared are ignored.
pub fn workspace_attention(sessions: &[SessionActivity]) -> Option<AttentionKind> {
    let pending = || {
        sessions
            .iter()
            .filter(|s| s.needs_attention)
            .filter_map(|s| s.attention_kind.as_ref())
    };
    if pending().any(|k| *k == AttentionKind::Ask) {
        Some(AttentionKind::Ask)
    } else if pending().any(|k| *k == AttentionKind::Plan) {
        Some(AttentionKind::Plan)
    } else {
        None
    }
}

pub fn workspace_activity(
    workspace_id: String,
    sessions: Vec<SessionActivity>,
) -> WorkspaceActivity {
    WorkspaceActivity {
        workspace_id,
        agent_status: workspace_status(&sessions),
        attention_kind: workspace_attention(&sessions),
        sessions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, status: AgentStatus) -> SessionActivity {
        SessionActivity {
            session_id: id.into(),
            agent_status: status,
            needs_attention: false,
            attention_kind: None,
        }
    }

    fn attention(id: &str, kind: AttentionKind) -> SessionActivity {
        SessionActivity {
            session_id: id.into(),
            agent_status: AgentStatus::Idle,
            needs_attention: true,
            attention_kind: Some(kind),
        }
    }

    // FR-001
    #[test]
    fn session_status_running_when_process_active() {
        assert_eq!(session_status(true, true), AgentStatus::Running);
        assert_eq!(session_status(true, false), AgentStatus::Running);
    }

    // FR-001
    #[test]
    fn session_status_background_when_only_background_tasks() {
        assert_eq!(session_status(false, true), AgentStatus::IdleWithBackground);
    }

    // FR-001
    #[test]
    fn session_status_idle_after_process_ends() {
        assert_eq!(session_status(false, false), AgentStatus::Idle);
    }

    // FR-002
    #[test]
    fn workspace_status_prefers_running() {
        let sessions = [
            session("a", AgentStatus::Idle),
            session("b", AgentStatus::IdleWithBackground),
            session("c", AgentStatus::Running),
        ];
        assert_eq!(workspace_status(&sessions), AgentStatus::Running);
    }

    // FR-002
    #[test]
    fn workspace_status_background_over_idle() {
        let sessions = [
            session("a", AgentStatus::Idle),
            session("b", AgentStatus::IdleWithBackground),
        ];
        assert_eq!(workspace_status(&sessions), AgentStatus::IdleWithBackground);
    }

    // FR-002
    #[test]
    fn workspace_status_empty_is_idle() {
        assert_eq!(workspace_status(&[]), AgentStatus::Idle);
    }

    // FR-012
    #[test]
    fn workspace_attention_ask_over_plan() {
        let sessions = [
            attention("a", AttentionKind::Plan),
            attention("b", AttentionKind::Ask),
        ];
        assert_eq!(workspace_attention(&sessions), Some(AttentionKind::Ask));
    }

    // FR-012
    #[test]
    fn workspace_attention_ignores_cleared() {
        let sessions = [SessionActivity {
            session_id: "a".into(),
            agent_status: AgentStatus::Idle,
            needs_attention: false,
            attention_kind: Some(AttentionKind::Plan),
        }];
        assert_eq!(workspace_attention(&sessions), None);
    }

    #[test]
    fn workspace_activity_serializes_contract_shape() {
        let activity = workspace_activity(
            "ws_1".into(),
            vec![SessionActivity {
                session_id: "s_1".into(),
                agent_status: AgentStatus::IdleWithBackground,
                needs_attention: false,
                attention_kind: None,
            }],
        );
        let json = serde_json::to_value(&activity).unwrap();
        assert_eq!(json["workspace_id"], "ws_1");
        assert_eq!(json["agent_status"], "IdleWithBackground");
        assert!(json["attention_kind"].is_null());
        assert_eq!(json["sessions"][0]["session_id"], "s_1");
    }
}
