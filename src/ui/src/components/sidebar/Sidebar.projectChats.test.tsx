// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../types/repository";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  notifyWorkspaceSelected: () => Promise.resolve(),
}));

import { Sidebar } from "./Sidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function makeRepo(id: string, remote: string | null): Repository {
  return {
    id,
    path: `/${id}`,
    name: id,
    path_slug: id,
    icon: null,
    created_at: "2026-01-01T00:00:00Z",
    setup_script: null,
    custom_instructions: null,
    sort_order: 0,
    branch_rename_preferences: null,
    setup_script_auto_run: false,
    archive_script: null,
    archive_script_auto_run: false,
    base_branch: null,
    default_remote: null,
    required_inputs: null,
    path_valid: true,
    remote_connection_id: remote,
  };
}

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "w1",
    repository_id: "local",
    name: "feature",
    branch_name: "feature",
    worktree_path: "/local/wt",
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind: "worktree",
    ...overrides,
  };
}

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const c of containers.splice(0)) c.remove();
});

describe("Sidebar project chats row", () => {
  it("row is rendered first for local repos and not for remote repos", async () => {
    // FR-013
    useAppStore.setState({
      repositories: [makeRepo("local", null), makeRepo("far", "conn-1")],
      workspaces: [makeWorkspace({ id: "w1" })],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    await act(async () => {
      root.render(<Sidebar />);
    });
    const rows = container.querySelectorAll("[data-project-chats-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-project-chats-row")).toBe("local");
    const next = rows[0].nextElementSibling;
    expect(next?.getAttribute("data-sidebar-workspace-id")).toBe("w1");
  });
});
