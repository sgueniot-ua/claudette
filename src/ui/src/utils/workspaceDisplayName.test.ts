import { describe, expect, it } from "vitest";
import type { Workspace } from "../types/workspace";
import { workspaceDisplayName } from "./workspaceDisplayName";

function ws(kind: Workspace["kind"]): Workspace {
  return {
    id: "w1",
    repository_id: "r1",
    name: kind === "repository" ? "@project" : "feature-x",
    branch_name: "b",
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

describe("workspaceDisplayName", () => {
  it("shows the repository name for project chat workspaces", () => {
    expect(workspaceDisplayName(ws("repository"), "my-repo")).toBe("my-repo");
  });

  it("falls back to the workspace name without a repository name", () => {
    expect(workspaceDisplayName(ws("repository"), undefined)).toBe("@project");
    expect(workspaceDisplayName(ws("repository"), null)).toBe("@project");
  });

  it("keeps worktree workspace names", () => {
    expect(workspaceDisplayName(ws("worktree"), "my-repo")).toBe("feature-x");
  });
});
