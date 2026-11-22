import type { ScmSummary } from "../types/plugin";
import type { Repository } from "../types/repository";
import type { Workspace } from "../types/workspace";

export interface SidebarWorkspaceFilter {
  showArchived: boolean;
  /** Repo id or the literal `"all"` sentinel used by the sidebar dropdown. */
  repoFilter: string;
}

/**
 * The same visibility predicate the sidebar uses to derive its
 * `filteredWorkspaces` memo: drop remote rows, drop project chat
 * (`repository`) rows, drop archived rows unless the "show archived" toggle
 * is on, and drop rows from other repos when a repo filter is active. Shared
 * so the `Cmd+N` jump handler (which has to resolve the Nth visible workspace
 * from raw store state) can't accidentally drift from what the user actually
 * sees.
 */
export function filterSidebarWorkspaces(
  workspaces: readonly Workspace[],
  { showArchived, repoFilter }: SidebarWorkspaceFilter,
): Workspace[] {
  return workspaces.filter((ws) => {
    if (ws.remote_connection_id) return false;
    if (ws.kind === "repository") return false;
    if (!showArchived && ws.status === "Archived") return false;
    if (repoFilter !== "all" && ws.repository_id !== repoFilter) return false;
    return true;
  });
}

/**
 * True when the user has no local workspace the sidebar could ever show
 * (archived ones included). The project chat workspace does not count: a
 * repo holding only project chats still offers "New workspace".
 */
export function hasNoSidebarWorkspaces(workspaces: readonly Workspace[]): boolean {
  return (
    filterSidebarWorkspaces(workspaces, { showArchived: true, repoFilter: "all" })
      .length === 0
  );
}

export type StatusBucketKey =
  | "in-progress"
  | "in-review"
  | "draft"
  | "merged"
  | "closed"
  | "archived";

export const STATUS_BUCKET_ORDER: StatusBucketKey[] = [
  "merged",
  "in-review",
  "draft",
  "in-progress",
  "closed",
  "archived",
];

export function statusBucketGroupKey(key: StatusBucketKey): string {
  return `status:${key}`;
}

export function bucketForWorkspace(
  ws: Workspace,
  scmSummary: Record<string, ScmSummary>,
): StatusBucketKey {
  if (ws.status === "Archived") return "archived";
  const summary = scmSummary[ws.id];
  if (!summary?.hasPr) return "in-progress";
  if (summary.prState === "merged") return "merged";
  if (summary.prState === "closed") return "closed";
  if (summary.prState === "draft") return "draft";
  return "in-review";
}

export function buildStatusBuckets(
  filteredWorkspaces: readonly Workspace[],
  scmSummary: Record<string, ScmSummary>,
): Map<StatusBucketKey, Workspace[]> {
  const buckets = new Map<StatusBucketKey, Workspace[]>();
  for (const key of STATUS_BUCKET_ORDER) buckets.set(key, []);
  for (const ws of filteredWorkspaces) {
    buckets.get(bucketForWorkspace(ws, scmSummary))!.push(ws);
  }
  return buckets;
}

/**
 * The visible workspace order in status group mode — exactly the rows the
 * sidebar paints, top to bottom. Concatenates non-empty buckets in
 * `STATUS_BUCKET_ORDER` and skips workspaces inside a collapsed bucket so
 * the jump-shortcut badge (1..9) never points at a row the user can't see.
 *
 * This is the single source of truth shared by the sidebar's badge
 * rendering and the `Cmd+N` keyboard handler.
 */
export function computeStatusVisibleWorkspaces(
  filteredWorkspaces: readonly Workspace[],
  scmSummary: Record<string, ScmSummary>,
  statusGroupCollapsed: Record<string, boolean>,
): Workspace[] {
  const buckets = buildStatusBuckets(filteredWorkspaces, scmSummary);
  const out: Workspace[] = [];
  for (const key of STATUS_BUCKET_ORDER) {
    const ws = buckets.get(key)!;
    if (ws.length === 0) continue;
    if (statusGroupCollapsed[statusBucketGroupKey(key)]) continue;
    out.push(...ws);
  }
  return out;
}

export type SidebarTarget =
  | { kind: "workspace"; id: string }
  | { kind: "projectChats"; repoId: string };

/**
 * Status-mode `Cmd+N` targets, top to bottom: one project chats row per local
 * repo (callers pre-apply the repo filter), then the visible workspaces. The
 * sidebar badges and the keyboard handler both read this list.
 */
export function computeStatusJumpTargets(
  repos: readonly Repository[],
  visibleWorkspaces: readonly Workspace[],
): SidebarTarget[] {
  return [
    ...repos
      .filter((r) => !r.remote_connection_id)
      .map((r): SidebarTarget => ({ kind: "projectChats", repoId: r.id })),
    ...visibleWorkspaces.map((w): SidebarTarget => ({ kind: "workspace", id: w.id })),
  ];
}
