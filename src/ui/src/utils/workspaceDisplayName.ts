import type { Workspace } from "../types/workspace";

/**
 * Display name for a workspace in pickers and headers. The project chat
 * workspace (`kind === "repository"`, named "@project") is shown under its
 * repository's name; worktree workspaces keep their own name.
 */
export function workspaceDisplayName(
  ws: Workspace,
  repoName: string | null | undefined,
): string {
  return ws.kind === "repository" ? (repoName ?? ws.name) : ws.name;
}
