import type { ChatSession } from "../types/chat";
import type { Repository } from "../types/repository";
import type { Workspace } from "../types/workspace";

export interface SchedulerDefaultsInput {
  workspaces: readonly Workspace[];
  repositories: readonly Repository[];
  sessionsByWorkspace: Record<string, readonly Pick<ChatSession, "id">[]>;
  selectedWorkspaceId: string | null;
  /** Session the modal was opened for (a `/schedule` from a chat). */
  prefillSessionId: string | null;
}

export interface SchedulerDefaults {
  repoId: string;
  workspaceId: string;
  /** Project chat workspace that stays selectable; "" when none. Only a
   *  prefilled chat session can set it — the globally selected workspace
   *  never does, so the global scheduler never offers or defaults to it. */
  preselectedRepoWsId: string;
}

/** Initial repo/workspace of the "new scheduled task" modal. */
export function resolveSchedulerDefaults({
  workspaces,
  repositories,
  sessionsByWorkspace,
  selectedWorkspaceId,
  prefillSessionId,
}: SchedulerDefaultsInput): SchedulerDefaults {
  const sessionWsId =
    (prefillSessionId &&
      Object.entries(sessionsByWorkspace).find(([, list]) =>
        list.some((cs) => cs.id === prefillSessionId),
      )?.[0]) ||
    "";
  const selected = workspaces.find((w) => w.id === selectedWorkspaceId);
  const usableSelected =
    selectedWorkspaceId && selected?.kind !== "repository"
      ? selectedWorkspaceId
      : "";
  const workspaceId =
    sessionWsId ||
    usableSelected ||
    workspaces.find((w) => w.status !== "Archived" && w.kind !== "repository")
      ?.id ||
    "";
  const repoId =
    workspaces.find((w) => w.id === workspaceId)?.repository_id ??
    repositories[0]?.id ??
    "";
  const sessionWs = workspaces.find((w) => w.id === sessionWsId);
  return {
    repoId,
    workspaceId,
    preselectedRepoWsId: sessionWs?.kind === "repository" ? sessionWs.id : "",
  };
}
