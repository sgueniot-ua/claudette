import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import i18n from "../i18n";
import { shouldDisable1mContext } from "../components/chat/chatHelpers";
import { getChatSession, sendChatMessage } from "../services/tauri";
import { useAppStore } from "../stores/useAppStore";
import type { CiCheck } from "../types/plugin";
import type { Workspace } from "../types/workspace";

interface CiAutoFixSessionCreatedPayload {
  workspace_id: string;
  session_id: string;
  prompt: string;
  failed_checks: CiCheck[];
  model: string | null;
  backend_id: string | null;
}

/** CI auto-fix never sends a prompt in a project chat: the agent would run
 *  unprompted in the user's own checkout (FR-018). */
export function ciAutoFixAllowed(
  workspaces: Workspace[],
  workspaceId: string,
): boolean {
  return workspaces.find((w) => w.id === workspaceId)?.kind !== "repository";
}

export function useCiAutoFixSession() {
  useEffect(() => {
    let active = true;

    const unlistenPromise = listen<CiAutoFixSessionCreatedPayload>(
      "ci-auto-fix-session-created",
      async (event) => {
        if (!active) return;

        const { workspace_id, session_id, prompt, model, backend_id } =
          event.payload;
        const store = useAppStore.getState();
        if (!ciAutoFixAllowed(store.workspaces, workspace_id)) return;

        try {
          const session = await getChatSession(session_id);
          if (!active) return;

          store.addChatSession(session);
          store.selectSession(workspace_id, session_id);

          const disable1mContext = shouldDisable1mContext(model);
          // Auto-fix sessions intentionally use the backend defaults for
          // permissionLevel / thinkingEnabled / planMode / fastMode rather
          // than inheriting the user's current chat toolbar state. This is
          // a brand-new session triggered by a background poll — there is
          // no per-tab UI state to inherit, and "safe defaults" (full perms
          // off, no plan/fast/thinking forced) is the right baseline for an
          // automated, non-interactive launch. Only model + backend + the
          // 1M-context disable flag are passed; the rest stay at backend
          // defaults so a user enabling e.g. plan mode for their chats
          // doesn't suddenly force every auto-fix into plan mode too.
          await sendChatMessage(
            session_id,
            prompt,
            undefined,
            undefined,
            model ?? undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            disable1mContext || undefined,
            backend_id ?? undefined,
          );

          if (active) {
            store.addToast(i18n.t("settings:ci_auto_fix_session_created"));
          }
        } catch (e) {
          console.error("CI auto-fix session creation failed:", e);
        }
      },
    );

    return () => {
      active = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
