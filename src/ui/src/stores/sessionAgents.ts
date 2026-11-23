import type { CompletedTurn, ToolActivity } from "./useAppStore";
import {
  agentSubagentType,
  agentTaskState,
  isAgentRunningState,
} from "../components/chat/agentActivityDisplay";
import { activitySummaryText } from "../components/chat/agentToolCallRendering";
import type { TaskState } from "../components/chat/TaskStateIcon";
import { nonEmptyStringField, parseToolInput } from "../utils/toolInput";

export interface SessionAgent {
  toolUseId: string;
  activity: ToolActivity;
  /** True when the activity sits in the live `toolActivities` lane. */
  live: boolean;
  state: TaskState;
  running: boolean;
  subagentType: string | null;
  label: string;
}

/** A team agent carries both a non-empty `team_name` and `name` in its input. */
export function isTeamAgentActivity(activity: ToolActivity): boolean {
  const input = parseToolInput(activity.inputJson);
  return (
    nonEmptyStringField(input?.team_name) !== undefined &&
    nonEmptyStringField(input?.name) !== undefined
  );
}

function isSubAgent(activity: ToolActivity, excludeTeamAgents: boolean): boolean {
  return activity.toolName === "Agent" && !(excludeTeamAgents && isTeamAgentActivity(activity));
}

function toSessionAgent(activity: ToolActivity, live: boolean): SessionAgent {
  const state = agentTaskState(activity, live);
  const subagentType = agentSubagentType(activity);
  return {
    toolUseId: activity.toolUseId,
    activity,
    live,
    state,
    running: isAgentRunningState(state),
    subagentType,
    label: activitySummaryText(activity).trim() || subagentType || "",
  };
}

/**
 * Top-level sub-agents of a session in launch order: completed turns
 * oldest-first, then the live lane. A backgrounded agent can sit on a turn
 * boundary in both lanes; the live copy replaces the completed one in place.
 * Team agents are left out only while they open as their own chat tabs
 * (`excludeTeamAgents`, the `team_agent_session_tabs_enabled` setting).
 */
export function collectSessionAgents(
  liveActivities: ToolActivity[],
  completedTurns: CompletedTurn[],
  excludeTeamAgents = true,
): SessionAgent[] {
  const byId = new Map<string, SessionAgent>();
  for (const turn of completedTurns) {
    for (const activity of turn.activities) {
      if (isSubAgent(activity, excludeTeamAgents)) byId.set(activity.toolUseId, toSessionAgent(activity, false));
    }
  }
  for (const activity of liveActivities) {
    if (isSubAgent(activity, excludeTeamAgents)) byId.set(activity.toolUseId, toSessionAgent(activity, true));
  }
  return [...byId.values()];
}

export function runningSessionAgents(agents: SessionAgent[]): SessionAgent[] {
  return agents.filter((a) => a.running);
}

/** Running agents first, launch order kept inside each group. */
export function orderForAgentsPanel(agents: SessionAgent[]): SessionAgent[] {
  return [...agents.filter((a) => a.running), ...agents.filter((a) => !a.running)];
}
