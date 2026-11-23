import { useTranslation } from "react-i18next";
import { selectActiveSessionId, useAppStore } from "../../stores/useAppStore";
import { orderForAgentsPanel } from "../../stores/sessionAgents";
import { useSessionAgents } from "../../hooks/useSessionAgents";
import { AgentToolCallGroup } from "../chat/AgentToolCallGroup";
import { TaskStateIcon } from "../chat/TaskStateIcon";
import styles from "./AgentsPanel.module.css";

export function AgentsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("chat");
  const sessionId = useAppStore(selectActiveSessionId);
  const agents = orderForAgentsPanel(useSessionAgents(sessionId));
  const selectedId = useAppStore((s) =>
    sessionId ? (s.selectedAgentBySession[sessionId] ?? null) : null,
  );
  const selectAgentInSidebar = useAppStore((s) => s.selectAgentInSidebar);
  const worktreePath = useAppStore(
    (s) => s.workspaces.find((w) => w.id === workspaceId)?.worktree_path ?? null,
  );

  if (!sessionId) return null;
  if (agents.length === 0) {
    return <div className={styles.empty}>{t("agents_panel_empty")}</div>;
  }

  const selected = agents.find((a) => a.toolUseId === selectedId);
  if (selected) {
    return (
      <div className={styles.panel}>
        <button
          type="button"
          className={styles.back}
          onClick={() => selectAgentInSidebar(sessionId, null)}
        >
          {t("agents_panel_all")}
        </button>
        <div className={styles.detail}>
          <AgentToolCallGroup
            activity={selected.activity}
            searchQuery=""
            worktreePath={worktreePath}
            live={selected.live}
          />
        </div>
      </div>
    );
  }

  const groups = [
    { key: "running", title: t("agents_panel_running"), items: agents.filter((a) => a.running) },
    { key: "finished", title: t("agents_panel_finished"), items: agents.filter((a) => !a.running) },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.key} className={styles.section}>
              <div className={styles.sectionHeader}>{g.title}</div>
              {g.items.map((a) => (
                <button
                  key={a.toolUseId}
                  type="button"
                  data-agent-id={a.toolUseId}
                  className={styles.item}
                  aria-label={
                    a.subagentType
                      ? t("running_agent_open", {
                          type: a.subagentType,
                          description: a.label || t("running_agent_default_label"),
                          state: a.running ? t("agents_panel_running") : t("agents_panel_finished"),
                        })
                      : t("running_agent_open_untyped", {
                          description: a.label || t("running_agent_default_label"),
                          state: a.running ? t("agents_panel_running") : t("agents_panel_finished"),
                        })
                  }
                  onClick={() => selectAgentInSidebar(sessionId, a.toolUseId)}
                >
                  <TaskStateIcon state={a.state} />
                  {a.subagentType && <span className={styles.type}>{a.subagentType}</span>}
                  <span className={styles.label}>{a.label || t("running_agent_default_label")}</span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
