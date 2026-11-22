use serde::Serialize;

use crate::model::chat_session::AttentionKind;
use crate::model::workspace::AgentStatus;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionActivity {
    pub session_id: String,
    pub agent_status: AgentStatus,
    pub needs_attention: bool,
    pub attention_kind: Option<AttentionKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WorkspaceActivity {
    pub workspace_id: String,
    pub agent_status: AgentStatus,
    pub attention_kind: Option<AttentionKind>,
    pub sessions: Vec<SessionActivity>,
}
