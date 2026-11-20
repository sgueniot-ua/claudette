import { describe, expect, it } from "vitest";
import type { Workspace } from "../types/workspace";
import { ciAutoFixAllowed } from "./useCiAutoFixSession";

function ws(id: string, kind: Workspace["kind"]): Workspace {
  return {
    id,
    repository_id: "r1",
    name: kind === "repository" ? "@project" : id,
    branch_name: "main",
    worktree_path: "/tmp/repo",
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

describe("ciAutoFixAllowed", () => {
  const workspaces = [ws("w1", "worktree"), ws("p1", "repository")];

  // FR-018
  it("never auto-sends in a project chat workspace", () => {
    expect(ciAutoFixAllowed(workspaces, "p1")).toBe(false);
  });

  it("keeps auto-fix for worktree workspaces", () => {
    expect(ciAutoFixAllowed(workspaces, "w1")).toBe(true);
  });
});
