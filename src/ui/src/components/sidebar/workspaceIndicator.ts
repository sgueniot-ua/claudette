import type { ChatSession } from "../../types";
import type { AgentStatus } from "../../types/workspace";
import { isAgentBusy, isBackgroundRunning } from "../../utils/agentStatus";

export type WorkspaceIndicator =
  | "ask"
  | "plan"
  | "background"
  | "done"
  | "env"
  | "running"
  | "compacting"
  | "other";

/**
 * Decides which leading icon a workspace row shows. Order matters:
 * attention (ask, plan) > background tasks > unread completion > env
 * preparation > running/compacting > everything else. Background tasks
 * deliberately take precedence over the unread-completion badge (FR-011).
 */
export function workspaceIndicator(input: {
  sessions: readonly ChatSession[];
  agentStatus: AgentStatus;
  unread: boolean;
  envPreparing: boolean;
}): WorkspaceIndicator {
  const { sessions, agentStatus, unread, envPreparing } = input;
  if (sessions.some((s) => s.needs_attention && s.attention_kind !== "Plan")) return "ask";
  if (sessions.some((s) => s.needs_attention && s.attention_kind === "Plan")) return "plan";
  if (isBackgroundRunning(agentStatus)) return "background";
  const busy = agentStatus === "Running" || agentStatus === "Compacting";
  if (unread && !busy) return "done";
  if (envPreparing && !busy) return "env";
  if (agentStatus === "Running") return "running";
  if (agentStatus === "Compacting") return "compacting";
  return "other";
}

/**
 * Whether the row's name is bold (`wsUnread`). Unchanged from before the
 * background state existed: attention, or an unread completion while the
 * agent is not busy. Background tasks alone do not emphasize the row.
 */
export function isWorkspaceRowEmphasized(input: {
  sessions: readonly ChatSession[];
  agentStatus: AgentStatus;
  unread: boolean;
}): boolean {
  const { sessions, agentStatus, unread } = input;
  return (
    sessions.some((s) => s.needs_attention) ||
    (unread && !isAgentBusy(agentStatus))
  );
}
