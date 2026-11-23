import { useTranslation } from "react-i18next";
import { useSessionAgents } from "../../hooks/useSessionAgents";
import { runningSessionAgents } from "../../stores/sessionAgents";
import { useAppStore } from "../../stores/useAppStore";
import { TaskStateIcon } from "./TaskStateIcon";
import styles from "./RunningAgentsBar.module.css";

export const RUNNING_AGENTS_BAR_MAX_ROWS = 3;

/**
 * Sub-agents currently running in this chat, pinned above the composer.
 * Clicking one opens it in the right sidebar's Agents tab; the transcript
 * scroll position is left alone.
 */
export function RunningAgentsBar({
  workspaceId,
  sessionId,
}: {
  workspaceId: string;
  sessionId: string;
}) {
  const { t } = useTranslation("chat");
  const agents = useSessionAgents(sessionId);
  const openAgentInSidebar = useAppStore((s) => s.openAgentInSidebar);

  const running = runningSessionAgents(agents);
  if (running.length === 0) return null;

  const visible = running.slice(0, RUNNING_AGENTS_BAR_MAX_ROWS);
  const hidden = running.length - visible.length;

  return (
    <nav className={styles.bar} aria-label={t("running_agents_bar_label")}>
      {visible.map((agent) => (
        <button
          key={agent.toolUseId}
          type="button"
          className={styles.row}
          aria-label={
            agent.subagentType
              ? t("running_agent_open", {
                  type: agent.subagentType,
                  description: agent.label || t("running_agent_default_label"),
                  state: t("agents_panel_running"),
                })
              : t("running_agent_open_untyped", {
                  description: agent.label || t("running_agent_default_label"),
                  state: t("agents_panel_running"),
                })
          }
          onClick={() => openAgentInSidebar(workspaceId, sessionId, agent.toolUseId)}
        >
          <span className={styles.icon}>
            <TaskStateIcon state="progress" label={t("agents_panel_running")} />
          </span>
          {agent.subagentType && <span className={styles.type}>{agent.subagentType}</span>}
          <span className={styles.description}>
            {agent.label || t("running_agent_default_label")}
          </span>
        </button>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className={styles.more}
          aria-label={t("running_agents_more_label", { count: hidden })}
          onClick={() => openAgentInSidebar(workspaceId, sessionId, null)}
        >
          {t("running_agents_more", { count: hidden })}
        </button>
      )}
    </nav>
  );
}
