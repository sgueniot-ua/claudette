import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  MessageSquare,
} from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import { isAgentBusy } from "../../utils/agentStatus";
import { useOpenProjectChat } from "../../hooks/useOpenProjectChat";
import type { Repository } from "../../types/repository";
import styles from "./Sidebar.module.css";
import rowStyles from "./ProjectChatsRow.module.css";

/** Pinned "Project chats" row, always first under a local repository. It
 *  represents the repository's single `repository` workspace (shared folder,
 *  no worktree): not draggable, renamable, archivable or deletable. */
export function ProjectChatsRow({ repo }: { repo: Repository }) {
  const { t } = useTranslation("sidebar");
  const { open } = useOpenProjectChat();
  const ws = useAppStore((s) =>
    s.workspaces.find(
      (w) =>
        w.repository_id === repo.id &&
        w.kind === "repository" &&
        w.status === "Active",
    ),
  );
  const selected = useAppStore((s) => ws !== undefined && s.selectedWorkspaceId === ws.id);
  const sessions = useAppStore((s) => (ws ? s.sessionsByWorkspace[ws.id] : undefined));
  const unread = useAppStore((s) => (ws ? s.unreadCompletions.has(ws.id) : false));

  const busy = ws ? isAgentBusy(ws.agent_status) : false;
  const hasQuestion = (sessions ?? []).some(
    (x) => x.needs_attention && x.attention_kind !== "Plan",
  );
  const hasPlan = (sessions ?? []).some(
    (x) => x.needs_attention && x.attention_kind === "Plan",
  );
  const badge = hasQuestion ? "ask" : hasPlan ? "plan" : unread && !busy ? "done" : null;
  const label = t("project_chats_row");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-project-chats-row={repo.id}
      className={`${styles.wsItem} ${selected ? styles.wsSelected : ""} ${badge ? styles.wsUnread : ""}`}
      onClick={() => void open(repo.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void open(repo.id);
        }
      }}
    >
      {badge === "ask" ? (
        <span className={styles.badgeAsk} title={t("status_badge_ask_title")} aria-label={t("status_badge_ask_aria")} role="img">
          <CircleQuestionMark size={14} />
        </span>
      ) : badge === "plan" ? (
        <span className={styles.badgePlan} title={t("status_badge_plan_title")} aria-label={t("status_badge_plan_aria")} role="img">
          <CircleAlert size={14} />
        </span>
      ) : badge === "done" ? (
        <span className={styles.badgeDone} title={t("status_badge_completed_title")} aria-label={t("status_badge_completed_aria")} role="img">
          <CircleCheck size={14} />
        </span>
      ) : busy ? (
        <span
          className={styles.statusSpinner}
          aria-hidden="true"
          title={ws?.agent_status === "Compacting" ? t("status_compacting") : t("status_running")}
        >
          <span className={styles.statusSpinnerRing} />
        </span>
      ) : (
        <span className={styles.statusIcon}>
          <MessageSquare size={14} className={rowStyles.icon} aria-hidden="true" />
        </span>
      )}
      <div className={styles.wsInfo}>
        <span className={styles.wsName}>{label}</span>
        {ws && <span className={styles.wsBranch}>{ws.branch_name}</span>}
      </div>
    </div>
  );
}
