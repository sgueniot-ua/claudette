import { useCallback, useState } from "react";
import i18n from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import type { Workspace } from "../types/workspace";
import { createChatSession, listChatSessions, openProjectChat } from "../services/tauri";

/** The active local `repository` workspace of a repo, if the store has it. */
export function findRepositoryWorkspace(
  workspaces: readonly Workspace[],
  repoId: string,
): Workspace | undefined {
  return workspaces.find(
    (w) =>
      w.repository_id === repoId &&
      w.kind === "repository" &&
      w.status === "Active" &&
      !w.remote_connection_id,
  );
}

// One open at a time per repo: ⌘N, the tray, the fuzzy finder and the row all
// land here, and concurrent opens would each create a chat.
const inflight = new Map<string, Promise<void>>();

/**
 * Open the project chats of a local repository: select its `repository`
 * workspace when the store already has it (creating a chat if none is
 * active; ⌘T / + create more), otherwise ask the backend to create the workspace and
 * its first chat session. Failures surface as a toast. Non-React so keyboard
 * shortcuts and the tray listener can reuse it. A call made while another open
 * of the same repo is running joins it instead of starting a second one.
 */
export function openProjectChatTarget(repoId: string): Promise<void> {
  const pending = inflight.get(repoId);
  if (pending) return pending;
  const run = doOpenProjectChat(repoId).finally(() => inflight.delete(repoId));
  inflight.set(repoId, run);
  return run;
}

async function doOpenProjectChat(repoId: string): Promise<void> {
  const s = useAppStore.getState();
  const existing = findRepositoryWorkspace(s.workspaces, repoId);
  try {
    if (existing) {
      // FR-013: an existing workspace whose chats are all archived must get a
      // fresh chat, else the user lands on an empty tab bar. The backend
      // `open_project_chat` always creates a session, so it is not used here.
      const loaded = s.sessionsLoadedByWorkspace[existing.id];
      let sessions = s.sessionsByWorkspace[existing.id] ?? [];
      if (!loaded) {
        try {
          sessions = await listChatSessions(existing.id, false);
          useAppStore.getState().setSessionsForWorkspace(existing.id, sessions);
        } catch (e) {
          // Still land on the workspace (as before the list was needed); the
          // tab bar recovers like SessionTabs' load-error case.
          const st = useAppStore.getState();
          st.markSessionsLoaded(existing.id);
          st.selectWorkspace(existing.id);
          st.addToast(
            i18n.t("chat:project_chats_open_failed", {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
          return;
        }
      }
      const st = useAppStore.getState();
      const current = st.sessionsByWorkspace[existing.id] ?? sessions;
      if (current.some((x) => x.status === "Active")) {
        st.selectWorkspace(existing.id);
        return;
      }
      const session = await createChatSession(existing.id);
      const after = useAppStore.getState();
      after.addChatSession(session);
      after.selectWorkspace(existing.id);
      after.selectSession(existing.id, session.id);
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
