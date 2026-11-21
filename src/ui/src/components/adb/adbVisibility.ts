import type { Workspace } from "../../types/workspace";

/** The ADB panel is offered only for local workspaces of Android-mode repositories. */
export function isAdbAvailable(
  workspace: Pick<Workspace, "repository_id" | "remote_connection_id"> | null | undefined,
  androidModeByRepo: Record<string, boolean>,
): boolean {
  return (
    !!workspace &&
    workspace.remote_connection_id === null &&
    androidModeByRepo[workspace.repository_id] === true
  );
}
