import { describe, expect, it } from "vitest";
import type { Repository } from "../types/repository";
import type { Workspace } from "../types/workspace";
import { resolveSchedulerDefaults } from "./schedulerDefaults";

function ws(id: string, kind: Workspace["kind"]): Workspace {
  return {
    id,
    repository_id: "r1",
    name: id,
    branch_name: id,
    worktree_path: null,
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind,
  };
}

const repositories = [{ id: "r1" }] as Repository[];
const workspaces = [ws("project", "repository"), ws("feat", "worktree")];
const sessionsByWorkspace = { project: [{ id: "chat-1" }], feat: [] };

describe("resolveSchedulerDefaults", () => {
  it("keeps the project chat workspace when opened from its chat session", () => { // FR-011
    const out = resolveSchedulerDefaults({
      workspaces,
      repositories,
      sessionsByWorkspace,
      selectedWorkspaceId: "project",
      prefillSessionId: "chat-1",
    });
    expect(out).toEqual({
      repoId: "r1",
      workspaceId: "project",
      preselectedRepoWsId: "project",
    });
  });

  it("never defaults to the project chat workspace from the global scheduler", () => { // FR-013
    const out = resolveSchedulerDefaults({
      workspaces,
      repositories,
      sessionsByWorkspace,
      selectedWorkspaceId: "project",
      prefillSessionId: null,
    });
    expect(out.workspaceId).toBe("feat");
    expect(out.preselectedRepoWsId).toBe("");
  });

  it("still uses the selected worktree workspace", () => {
    const out = resolveSchedulerDefaults({
      workspaces: [...workspaces, ws("other", "worktree")],
      repositories,
      sessionsByWorkspace,
      selectedWorkspaceId: "other",
      prefillSessionId: null,
    });
    expect(out.workspaceId).toBe("other");
  });
});
