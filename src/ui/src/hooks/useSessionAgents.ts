import { useMemo } from "react";
import { useAppStore } from "../stores/useAppStore";
import type { CompletedTurn, ToolActivity } from "../stores/useAppStore";
import { useTeamAgentSessionTabs } from "./useTeamAgentSessionTabs";
import { collectSessionAgents, type SessionAgent } from "../stores/sessionAgents";

const EMPTY_ACTIVITIES: ToolActivity[] = [];
const EMPTY_TURNS: CompletedTurn[] = [];
const EMPTY_AGENTS: SessionAgent[] = [];

/** Sub-agents of a session, in launch order (see `collectSessionAgents`). */
export function useSessionAgents(sessionId: string | null): SessionAgent[] {
  const toolActivities = useAppStore(
    (s) => (sessionId ? s.toolActivities[sessionId] : null) ?? EMPTY_ACTIVITIES,
  );
  const completedTurns = useAppStore(
    (s) => (sessionId ? s.completedTurns[sessionId] : null) ?? EMPTY_TURNS,
  );

  const excludeTeamAgents = useTeamAgentSessionTabs();

  return useMemo(() => {
    if (!sessionId) return EMPTY_AGENTS;
    const agents = collectSessionAgents(toolActivities, completedTurns, excludeTeamAgents);
    return agents.length === 0 ? EMPTY_AGENTS : agents;
  }, [sessionId, toolActivities, completedTurns, excludeTeamAgents]);
}
