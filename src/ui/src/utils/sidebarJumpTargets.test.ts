import { describe, expect, it } from "vitest";
import type { ScmSummary } from "../types/plugin";
import type { Repository } from "../types/repository";
import type { Workspace } from "../types/workspace";
import {
  bucketForWorkspace,
  computeStatusJumpTargets,
  computeStatusVisibleWorkspaces,
  filterSidebarWorkspaces,
  hasNoSidebarWorkspaces,
  STATUS_BUCKET_ORDER,
  statusBucketGroupKey,
} from "./sidebarJumpTargets";

function workspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id,
    repository_id: "repo-1",
    name: id,
    branch_name: id,
    worktree_path: `/tmp/${id}`,
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    remote_connection_id: null,
    input_values: null,
    kind: "worktree",
    ...overrides,
  };
}

function summary(
  prState: ScmSummary["prState"],
  hasPr = true,
): ScmSummary {
  return { hasPr, prState, ciState: null, lastUpdated: 0 };
}

describe("bucketForWorkspace", () => {
  it("classifies archived workspaces first, regardless of PR state", () => {
    const ws = workspace("a", { status: "Archived" });
    const scm = { a: summary("open") };
    expect(bucketForWorkspace(ws, scm)).toBe("archived");
  });

  it("classifies by PR state when present", () => {
    expect(bucketForWorkspace(workspace("a"), { a: summary("merged") })).toBe("merged");
    expect(bucketForWorkspace(workspace("a"), { a: summary("closed") })).toBe("closed");
    expect(bucketForWorkspace(workspace("a"), { a: summary("draft") })).toBe("draft");
    expect(bucketForWorkspace(workspace("a"), { a: summary("open") })).toBe("in-review");
  });

  it("falls back to in-progress when there is no PR", () => {
    expect(bucketForWorkspace(workspace("a"), {})).toBe("in-progress");
    expect(
      bucketForWorkspace(workspace("a"), { a: summary(null, false) }),
    ).toBe("in-progress");
  });
});

describe("computeStatusVisibleWorkspaces", () => {
  // Order in STATUS_BUCKET_ORDER: merged, in-review, draft, in-progress, closed, archived.
  const merged = workspace("m1");
  const inReview1 = workspace("r1");
  const inReview2 = workspace("r2");
  const inProgress = workspace("p1");
  const archived = workspace("a1", { status: "Archived" });

  const scm: Record<string, ScmSummary> = {
    m1: summary("merged"),
    r1: summary("open"),
    r2: summary("open"),
    p1: summary(null, false),
  };

  it("concatenates non-collapsed buckets in STATUS_BUCKET_ORDER", () => {
    const out = computeStatusVisibleWorkspaces(
      [inProgress, inReview1, merged, inReview2, archived],
      scm,
      {},
    );
    // merged → in-review → in-progress → archived (closed and draft empty)
    expect(out.map((w) => w.id)).toEqual(["m1", "r1", "r2", "p1", "a1"]);
  });

  it("skips collapsed buckets entirely so badge numbers stay contiguous", () => {
    const collapsed = { [statusBucketGroupKey("in-review")]: true };
    const out = computeStatusVisibleWorkspaces(
      [merged, inReview1, inReview2, inProgress],
      scm,
      collapsed,
    );
    expect(out.map((w) => w.id)).toEqual(["m1", "p1"]);
  });

  it("empty buckets are simply omitted (no holes in the visible list)", () => {
    const out = computeStatusVisibleWorkspaces([merged, inProgress], scm, {});
    expect(out.map((w) => w.id)).toEqual(["m1", "p1"]);
  });

  it("STATUS_BUCKET_ORDER is the canonical render order", () => {
    expect(STATUS_BUCKET_ORDER).toEqual([
      "merged",
      "in-review",
      "draft",
      "in-progress",
      "closed",
      "archived",
    ]);
  });
});

describe("filterSidebarWorkspaces", () => {
  const local = workspace("local-active");
  const archived = workspace("local-archived", { status: "Archived" });
  const remote = workspace("remote-row", { remote_connection_id: "conn-1" });
  const otherRepo = workspace("other-repo", { repository_id: "repo-2" });

  it("drops project chat workspaces", () => { // FR-013
    const project = workspace("project", { kind: "repository" });
    const out = filterSidebarWorkspaces(
      [local, project],
      { showArchived: true, repoFilter: "all" },
    );
    expect(out.map((w) => w.id)).toEqual(["local-active"]);
  });

  it("drops remote rows unconditionally", () => {
    const out = filterSidebarWorkspaces(
      [local, remote],
      { showArchived: true, repoFilter: "all" },
    );
    expect(out.map((w) => w.id)).toEqual(["local-active"]);
  });

  it("hides archived rows until showArchived is on", () => {
    expect(
      filterSidebarWorkspaces(
        [local, archived],
        { showArchived: false, repoFilter: "all" },
      ).map((w) => w.id),
    ).toEqual(["local-active"]);

    expect(
      filterSidebarWorkspaces(
        [local, archived],
        { showArchived: true, repoFilter: "all" },
      ).map((w) => w.id),
    ).toEqual(["local-active", "local-archived"]);
  });

  it("scopes to a single repo when a repoFilter is set", () => {
    const out = filterSidebarWorkspaces(
      [local, otherRepo],
      { showArchived: false, repoFilter: "repo-2" },
    );
    expect(out.map((w) => w.id)).toEqual(["other-repo"]);
  });
});

describe("hasNoSidebarWorkspaces", () => {
  it("ignores the project chat workspace", () => { // FR-013
    const project = workspace("project", { kind: "repository" });
    expect(hasNoSidebarWorkspaces([project])).toBe(true);
    expect(hasNoSidebarWorkspaces([project, workspace("local")])).toBe(false);
  });

  it("counts archived local rows but not remote ones", () => {
    expect(hasNoSidebarWorkspaces([workspace("a", { status: "Archived" })])).toBe(false);
    expect(
      hasNoSidebarWorkspaces([workspace("r", { remote_connection_id: "conn-1" })]),
    ).toBe(true);
  });
});

describe("computeStatusJumpTargets", () => {
  const repo = (id: string, remote: string | null = null) =>
    ({ id, remote_connection_id: remote }) as unknown as Repository;

  it("project chat targets come first in status mode", () => { // FR-013
    const out = computeStatusJumpTargets(
      [repo("r1"), repo("remote", "conn"), repo("r2")],
      [workspace("w1")],
    );
    expect(out).toEqual([
      { kind: "projectChats", repoId: "r1" },
      { kind: "projectChats", repoId: "r2" },
      { kind: "workspace", id: "w1" },
    ]);
  });

  it("workspace jump numbers are shifted by project targets", () => { // FR-013
    const out = computeStatusJumpTargets(
      [repo("r1"), repo("r2")],
      [workspace("w1"), workspace("w2")],
    );
    expect(out.findIndex((t) => t.kind === "workspace" && t.id === "w1")).toBe(2);
    expect(out.findIndex((t) => t.kind === "workspace" && t.id === "w2")).toBe(3);
  });
});
