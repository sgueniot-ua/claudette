import { useCallback, useState } from "react";
import i18n from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import { createChatSession, listChatSessions, openProjectChat } from "../services/tauri";

/**
 * Open the project chats of a local repository: select its `repository`
 * workspace when the store already has it (creating a chat if none is
 * active; ⌘T / + create more), otherwise ask the backend to create the workspace and
 * its first chat session. Failures surface as a toast. Non-React so keyboard
 * shortcuts and the tray listener can reuse it.
 */
export async function openProjectChatTarget(repoId: string): Promise<void> {
  const s = useAppStore.getState();
  const existing = s.workspaces.find(
    (w) =>
      w.repository_id === repoId &&
      w.kind === "repository" &&
      w.status === "Active",
  );
  try {
    if (existing) {
      // FR-013: an existing workspace whose chats are all archived must get a
      // fresh chat, else the user lands on an empty tab bar. The backend
      // `open_project_chat` always creates a session, so it is not used here.
      const loaded = s.sessionsLoadedByWorkspace[existing.id];
      let sessions = s.sessionsByWorkspace[existing.id] ?? [];
      if (!loaded) {
        sessions = await listChatSessions(existing.id, false);
        useAppStore.getState().setSessionsForWorkspace(existing.id, sessions);
      }
      const st = useAppStore.getState();
      if (sessions.some((x) => x.status === "Active")) {
        st.selectWorkspace(existing.id);
        return;
      }
      const session = await createChatSession(existing.id);
      st.addChatSession(session);
      st.selectWorkspace(existing.id);
      st.selectSession(existing.id, session.id);
      return;
    }
    const { workspace, session } = await openProjectChat(repoId);
    const st = useAppStore.getState();
    // The backend emits no workspace-changed event for project chats.
    // Stamp the UI-only `remote_connection_id: null` (the Rust model
    // doesn't serialize it): without it the env-prep hook treats the
    // row as unhydrated and the chat stays at "Preparing workspace
    // environment". Mirrors useCreateWorkspace / ChatPanel's fork path.
    const known = st.workspaces.find((w) => w.id === workspace.id);
    if (!known) {
      st.addWorkspace({ ...workspace, remote_connection_id: null });
    } else if (known.remote_connection_id === undefined) {
      st.updateWorkspace(workspace.id, { remote_connection_id: null });
    }
    st.addChatSession(session);
    st.selectWorkspace(workspace.id);
    st.selectSession(workspace.id, session.id);
  } catch (e) {
    useAppStore.getState().addToast(
      i18n.t("chat:project_chats_open_failed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

export function useOpenProjectChat(): {
  open: (repoId: string) => Promise<void>;
  opening: boolean;
} {
  const [opening, setOpening] = useState(false);
  const open = useCallback(
    async (repoId: string) => {
      if (opening) return;
      setOpening(true);
      try {
        await openProjectChatTarget(repoId);
      } finally {
        setOpening(false);
      }
    },
    [opening],
  );
  return { open, opening };
}
