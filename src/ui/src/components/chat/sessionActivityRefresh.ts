import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getChatSession } from "../../services/tauri";
import { useAppStore } from "../../stores/useAppStore";
import type { SessionAgentStatus } from "../../types/chat";
import { syncWorkspaceTurnStatus } from "./chatTurnLifecycle";

// Latest request per session: an older response landing late is dropped.
const latestRequest: Record<string, number> = {};
let requestCounter = 0;

function isIdleLike(status: SessionAgentStatus | undefined): boolean {
  return status === "Idle" || status === "IdleWithBackground";
}

/**
 * Re-read a session's `agent_status` from Rust, which tracks every
 * background task (shell, subagent, Workflow), and apply it to the store
 * when it only flips between `Idle` and `IdleWithBackground`. A local
 * `Running` or `Stopped` is never overwritten, and a `Running` answer is
 * ignored: the turn lifecycle owns those (FR-006).
 */
export async function refreshSessionBackgroundStatus(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  const request = ++requestCounter;
  latestRequest[sessionId] = request;
  let fresh: SessionAgentStatus;
  try {
    fresh = (await getChatSession(sessionId)).agent_status;
  } catch {
    return;
  }
  if (latestRequest[sessionId] !== request) return;
  const state = useAppStore.getState();
  const current = (state.sessionsByWorkspace[workspaceId] ?? []).find(
    (session) => session.id === sessionId,
  );
  if (!current || !isIdleLike(current.agent_status) || !isIdleLike(fresh)) return;
  if (current.agent_status !== fresh) {
    state.updateChatSession(sessionId, { agent_status: fresh });
  }
  syncWorkspaceTurnStatus(workspaceId);
}

/** Re-read a session's status whenever Rust signals an activity change. */
export function listenToSessionActivityChanges(): Promise<UnlistenFn> {
  return listen<{ workspace_id: string; chat_session_id: string }>(
    "agent-activity-changed",
    (event) => {
      const { workspace_id, chat_session_id } = event.payload;
      void refreshSessionBackgroundStatus(workspace_id, chat_session_id);
    },
  );
}
