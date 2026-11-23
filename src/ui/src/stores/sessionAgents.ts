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

function isSubAgent(activity: ToolActivity): boolean {
  return activity.toolName === "Agent" && !isTeamAgentActivity(activity);
}

function toSessionAgent(activity: ToolActivity, live: boolean): SessionAgent {
  const state = agentTaskState(activity, live);
  return {
    toolUseId: activity.toolUseId,
    activity,
    live,
    state,
    running: isAgentRunningState(state),
    subagentType: agentSubagentType(activity),
    label: activitySummaryText(activity),
  };
}

/**
 * Top-level sub-agents of a session in launch order: completed turns
 * oldest-first, then the live lane. A backgrounded agent can sit on a turn
 * boundary in both lanes; the live copy replaces the completed one in place.
 */
export function collectSessionAgents(
  liveActivities: ToolActivity[],
  completedTurns: CompletedTurn[],
): SessionAgent[] {
  const byId = new Map<string, SessionAgent>();
  for (const turn of completedTurns) {
    for (const activity of turn.activities) {
      if (isSubAgent(activity)) byId.set(activity.toolUseId, toSessionAgent(activity, false));
    }
  }
  for (const activity of liveActivities) {
    if (isSubAgent(activity)) byId.set(activity.toolUseId, toSessionAgent(activity, true));
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
