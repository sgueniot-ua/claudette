import { invoke } from "@tauri-apps/api/core";
import type { FileDiff } from "../../types/diff";
import type {
  CommitDetail,
  GitGraph,
  GraphFingerprint,
  WorktreeStateEntry,
} from "../../types/gitGraph";
import { viaWorkspace } from "./remoteRouting";

/**
 * Whether a remote host rejected a method it does not know yet, i.e. it
 * predates the git tree commands. The UI then degrades instead of failing.
 */
export function isUnsupportedHostError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.startsWith("Unknown method:");
}

export function loadGitGraph(
  workspaceId: string,
  includeRemotes: boolean,
  limit: number,
  untilHash?: string,
): Promise<GitGraph> {
  const untilHashOrNull = untilHash ?? null;
  return viaWorkspace(
    workspaceId,
    "load_git_graph",
    {
      include_remotes: includeRemotes,
      limit,
      until_hash: untilHashOrNull,
    },
    () =>
      invoke<GitGraph>("load_git_graph", {
        workspaceId,
        includeRemotes,
        limit,
        untilHash: untilHashOrNull,
      }),
  );
}

export function loadGitGraphFingerprint(
  workspaceId: string,
  includeRemotes: boolean,
): Promise<GraphFingerprint> {
  return viaWorkspace(
    workspaceId,
    "load_git_graph_fingerprint",
    { include_remotes: includeRemotes },
    () =>
      invoke<GraphFingerprint>("load_git_graph_fingerprint", {
        workspaceId,
        includeRemotes,
      }),
  );
}

export function loadWorktreeStates(
  workspaceId: string,
): Promise<WorktreeStateEntry[]> {
  return viaWorkspace(workspaceId, "load_worktree_states", {}, () =>
    invoke<WorktreeStateEntry[]>("load_worktree_states", { workspaceId }),
  );
}

export function loadCommitDetail(
  workspaceId: string,
  commitHash: string,
  includeRemotes: boolean,
): Promise<CommitDetail> {
  return viaWorkspace(
    workspaceId,
    "load_commit_detail",
    { commit_hash: commitHash, include_remotes: includeRemotes },
    () =>
      invoke<CommitDetail>("load_commit_detail", {
        workspaceId,
        commitHash,
        includeRemotes,
      }),
  );
}

/** One file's diff against the commit's first parent; routed like `loadCommitFileDiff`. */
export function loadCommitFileDiffFirstParent(
  workspaceId: string,
  commitHash: string,
  filePath: string,
): Promise<FileDiff> {
  return viaWorkspace(
    workspaceId,
    "load_commit_file_diff_first_parent",
    { commit_hash: commitHash, file_path: filePath },
    () =>
      invoke<FileDiff>("load_commit_file_diff_first_parent", {
        workspaceId,
        commitHash,
        filePath,
      }),
  );
}
