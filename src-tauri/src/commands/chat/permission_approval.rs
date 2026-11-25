//! Claude permission prompts in full ("bypass") permission mode.
//!
//! Claudette normally answers `allow` to every `can_use_tool` request in full
//! mode. With the `full_mode_honor_ask_rules` setting on, requests raised by
//! ask rules or hooks are queued as a synthetic `ClaudePermissionApproval`
//! pending control instead, answered through `submit_agent_approval`. This
//! module holds the routing, the setting read, and the "next pending prompt"
//! logic shared with `interaction.rs`.

use std::collections::HashMap;
use std::path::Path;

use tauri::{AppHandle, Emitter};

use claudette::agent::is_codex_approval_tool_name;
use claudette::chat::{CLAUDE_PERMISSION_APPROVAL_TOOL, bypass_permission_needs_user};
use claudette::permissions::is_bypass_tools;

use super::send::{control_prompt_attention_kind, queue_control_prompt};
use crate::state::{AgentSessionState, AttentionKind, PendingPermission};

const HONOR_ASK_RULES_SETTING: &str = "full_mode_honor_ask_rules";

/// Tools Claudette always routes to the user (or Codex approvals), never
/// through the bypass approval path.
fn is_user_control_tool(tool_name: &str) -> bool {
    matches!(tool_name, "AskUserQuestion" | "ExitPlanMode")
        || is_codex_approval_tool_name(tool_name)
}

fn bypass_active(session: &AgentSessionState) -> bool {
    is_bypass_tools(&session.session_allowed_tools)
        && (!session.session_plan_mode || session.session_exited_plan)
}

/// True when the `full_mode_honor_ask_rules` setting could change the answer
/// for this request, so it is worth reading it.
pub(super) fn setting_matters(session: &AgentSessionState, tool_name: &str) -> bool {
    bypass_active(session) && !is_user_control_tool(tool_name)
}

/// Read `full_mode_honor_ask_rules`. A DB error is logged and treated as off.
pub(super) fn read_honor_ask_rules(db_path: &Path) -> bool {
    let value = claudette::db::Database::open(db_path)
        .and_then(|db| db.get_app_setting(HONOR_ASK_RULES_SETTING));
    match value {
        Ok(v) => v.is_some_and(|v| v == "true"),
        Err(e) => {
            tracing::warn!(
                target: "claudette::chat",
                error = %e,
                "failed to read {HONOR_ASK_RULES_SETTING}; treating it as off"
            );
            false
        }
    }
}

/// Envelope for a bypass-mode permission request queued for the user. Shared
/// by the pending entry and the `agent-permission-prompt` event so live and
/// snapshot views are identical.
fn wrap_permission_approval_input(
    tool_name: &str,
    input: &serde_json::Value,
    decision_reason_type: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "toolName": tool_name,
        "toolInput": input,
        "decisionReasonType": decision_reason_type,
    })
}

/// Queue the request as a `ClaudePermissionApproval` when the session is in
/// bypass mode and the setting asks for it. `None` means "not handled here".
pub(super) fn queue_bypass_permission_approval(
    session: &mut AgentSessionState,
    request_id: &str,
    tool_name: &str,
    tool_use_id: &str,
    input: &serde_json::Value,
    decision_reason_type: Option<&str>,
    honor_ask_rules: bool,
) -> Option<AttentionKind> {
    if !setting_matters(session, tool_name)
        || !bypass_permission_needs_user(honor_ask_rules, decision_reason_type)
    {
        return None;
    }
    Some(queue_control_prompt(
        session,
        request_id.to_string(),
        CLAUDE_PERMISSION_APPROVAL_TOOL.to_string(),
        tool_use_id.to_string(),
        wrap_permission_approval_input(tool_name, input, decision_reason_type),
    ))
}

/// Neutral deny for a pending approval drained by cleanup (turn end, stop…):
/// the user did not decide anything.
pub(super) fn cancelled_permission_response(
    pending: &PendingPermission,
    reason: &str,
) -> Option<serde_json::Value> {
    if pending.tool_name != CLAUDE_PERMISSION_APPROVAL_TOOL {
        return None;
    }
    let tool_name = pending.original_input["toolName"]
        .as_str()
        .unwrap_or("the tool");
    Some(serde_json::json!({
        "behavior": "deny",
        "message": format!("Permission request for {tool_name} was cancelled: {reason}"),
    }))
}

/// A still-pending control the UI should show next.
#[derive(Debug, PartialEq)]
pub(crate) struct NextPrompt {
    pub workspace_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
    pub kind: AttentionKind,
}

/// Pick the pending control to show next. `pending_permissions` is a
/// `HashMap` with no insertion order, so the smallest `tool_use_id` is used to
/// stay deterministic.
fn next_pending_prompt(
    workspace_id: &str,
    pending: &HashMap<String, PendingPermission>,
) -> Option<NextPrompt> {
    let (tool_use_id, p) = pending.iter().min_by_key(|(id, _)| id.as_str())?;
    Some(NextPrompt {
        workspace_id: workspace_id.to_string(),
        tool_use_id: tool_use_id.clone(),
        tool_name: p.tool_name.clone(),
        input: p.original_input.clone(),
        kind: control_prompt_attention_kind(&p.tool_name),
    })
}

/// Called after a pending control was removed because the user answered it.
/// The UI shows one card per session, so another pending control must keep the
/// session in attention and be shown next; otherwise attention is reset.
pub(crate) fn settle_attention_after_answer(session: &mut AgentSessionState) -> Option<NextPrompt> {
    match next_pending_prompt(&session.workspace_id, &session.pending_permissions) {
        Some(next) => {
            session.needs_attention = true;
            session.attention_kind = Some(next.kind);
            Some(next)
        }
        None => {
            session.reset_attention();
            None
        }
    }
}

/// Re-emit `agent-permission-prompt` for `next`, same payload as the live one.
pub(crate) fn emit_next_prompt(app: &AppHandle, chat_session_id: &str, next: &NextPrompt) {
    let payload = serde_json::json!({
        "workspace_id": next.workspace_id,
        "chat_session_id": chat_session_id,
        "tool_use_id": next.tool_use_id,
        "tool_name": next.tool_name,
        "input": next.input,
    });
    let _ = app.emit("agent-permission-prompt", &payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(tool_name: &str, input: serde_json::Value) -> PendingPermission {
        PendingPermission {
            request_id: "r".to_string(),
            tool_name: tool_name.to_string(),
            original_input: input,
        }
    }

    #[test]
    fn next_pending_prompt_is_none_when_empty() {
        assert_eq!(next_pending_prompt("w", &HashMap::new()), None);
    }

    #[test]
    fn next_pending_prompt_picks_smallest_tool_use_id() {
        let mut map = HashMap::new();
        map.insert(
            "tool-b".to_string(),
            pending(
                "ClaudePermissionApproval",
                serde_json::json!({"toolName": "B"}),
            ),
        );
        map.insert(
            "tool-a".to_string(),
            pending(
                "ClaudePermissionApproval",
                serde_json::json!({"toolName": "A"}),
            ),
        );

        let next = next_pending_prompt("w1", &map).unwrap();
        assert_eq!(next.tool_use_id, "tool-a");
        assert_eq!(next.workspace_id, "w1");
        assert_eq!(next.tool_name, "ClaudePermissionApproval");
        assert_eq!(next.input["toolName"], "A");
        assert_eq!(next.kind, AttentionKind::Ask);
    }

    #[test]
    fn next_pending_prompt_uses_plan_kind_for_exit_plan_mode() {
        let mut map = HashMap::new();
        map.insert(
            "t".to_string(),
            pending("ExitPlanMode", serde_json::json!({})),
        );
        assert_eq!(
            next_pending_prompt("w", &map).unwrap().kind,
            AttentionKind::Plan
        );
    }

    #[test]
    fn cancelled_response_is_neutral_for_permission_approval() {
        let p = pending(
            "ClaudePermissionApproval",
            serde_json::json!({"toolName": "Bash", "toolInput": {}}),
        );
        let response = cancelled_permission_response(&p, "turn ended").unwrap();
        assert_eq!(response["behavior"], "deny");
        let message = response["message"].as_str().unwrap();
        assert_eq!(
            message,
            "Permission request for Bash was cancelled: turn ended"
        );
        assert!(!message.contains("The user denied"));
    }

    #[test]
    fn cancelled_response_ignores_other_tools() {
        let p = pending("ExitPlanMode", serde_json::json!({}));
        assert!(cancelled_permission_response(&p, "x").is_none());
    }

    #[test]
    fn read_honor_ask_rules_reflects_setting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let db = claudette::db::Database::open(&path).unwrap();
        assert!(!read_honor_ask_rules(&path));
        db.set_app_setting(HONOR_ASK_RULES_SETTING, "true").unwrap();
        assert!(read_honor_ask_rules(&path));
        db.set_app_setting(HONOR_ASK_RULES_SETTING, "false")
            .unwrap();
        assert!(!read_honor_ask_rules(&path));
    }

    #[test]
    fn read_honor_ask_rules_is_off_when_db_cannot_open() {
        let dir = tempfile::tempdir().unwrap();
        // A directory is not a valid database file.
        assert!(!read_honor_ask_rules(dir.path()));
    }

    #[test]
    fn wrapped_input_carries_tool_input_and_reason() {
        let w = wrap_permission_approval_input(
            "Bash",
            &serde_json::json!({"command": "ls"}),
            Some("rule"),
        );
        assert_eq!(w["toolName"], "Bash");
        assert_eq!(w["toolInput"]["command"], "ls");
        assert_eq!(w["decisionReasonType"], "rule");
    }
}
