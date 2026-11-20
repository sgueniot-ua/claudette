import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import { listChatSessions, openProjectChat } from "../../services/tauri";
import {
  SessionStatusIcon,
  type SessionStatusKind,
} from "../shared/SessionStatusIcon";
import type { ChatSession } from "../../types/chat";
import styles from "./ProjectChatsSection.module.css";

const NO_SESSIONS: ChatSession[] = [];

function statusKind(session: ChatSession): SessionStatusKind {
  if (session.agent_status === "Running") return { kind: "running" };
  if (session.agent_status === "Stopped") return { kind: "stopped" };
  return { kind: "idle" };
}

/** "Chats" section of the project view: lists, launches and opens the chats
 *  of the repository's single `repository` workspace (no worktree). */
export function ProjectChatsSection({ repoId }: { repoId: string }) {
  const { t } = useTranslation("chat");
  const workspaces = useAppStore((s) => s.workspaces);
  const projectWs = useMemo(
    () =>
      workspaces.find(
        (w) => w.repository_id === repoId && w.kind === "repository",
      ),
    [workspaces, repoId],
  );
  const sessions = useAppStore((s) =>
    projectWs ? (s.sessionsByWorkspace[projectWs.id] ?? NO_SESSIONS) : NO_SESSIONS,
  );
  const activeSessions = useMemo(
    () => sessions.filter((x) => x.status === "Active"),
    [sessions],
  );
  // open_project_chat is local-only: a paired server's repo has no project chats.
  const isRemoteRepo = useAppStore((s) =>
    Boolean(s.repositories.find((r) => r.id === repoId)?.remote_connection_id),
  );
  const [opening, setOpening] = useState(false);
  const projectWsId = isRemoteRepo ? undefined : projectWs?.id;

  useEffect(() => {
    if (!projectWsId) return;
    let cancelled = false;
    listChatSessions(projectWsId, false)
      .then((list) => {
        if (!cancelled) useAppStore.getState().setSessionsForWorkspace(projectWsId, list);
      })
      .catch((e) => {
        console.error("Failed to load project chats:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [projectWsId]);

  const openSession = useCallback((wsId: string, sessionId: string) => {
    const s = useAppStore.getState();
    s.selectWorkspace(wsId);
    s.selectSession(wsId, sessionId);
  }, []);

  const handleNewChat = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { workspace, session } = await openProjectChat(repoId);
      const s = useAppStore.getState();
      // The backend emits no workspace-changed event for project chats.
      if (!s.workspaces.some((w) => w.id === workspace.id)) {
        s.addWorkspace(workspace);
      }
      s.addChatSession(session);
      openSession(workspace.id, session.id);
    } catch (e) {
      useAppStore
        .getState()
        .addToast(
          t("project_chats_open_failed", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
    } finally {
      setOpening(false);
    }
  }, [opening, repoId, openSession, t]);

  if (isRemoteRepo) return null;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>{t("project_chats_title")}</span>
        <button
          type="button"
          className={styles.newButton}
          onClick={() => void handleNewChat()}
          disabled={opening}
        >
          <Plus size={12} aria-hidden />
          {t("project_chats_new")}
        </button>
      </div>
      <p className={styles.notice}>{t("project_chats_shared_notice")}</p>
      {activeSessions.length === 0 ? (
        <p className={styles.empty}>{t("project_chats_empty")}</p>
      ) : (
        <ul className={styles.list}>
          {activeSessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => projectWs && openSession(projectWs.id, session.id)}
              >
                <SessionStatusIcon status={statusKind(session)} size={14} />
                <span className={styles.name}>{session.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
