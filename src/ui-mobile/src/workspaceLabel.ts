import type { Workspace } from "./types";

export function workspaceLabel(w: Workspace, repoName?: string | null): string {
  return w.kind === "repository" ? (repoName ?? "Project") : w.name;
}
