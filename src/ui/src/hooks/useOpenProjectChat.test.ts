// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "../types/chat";
import type { Workspace } from "../types/workspace";
import { useAppStore } from "../stores/useAppStore";

const openProjectChat = vi.fn();

vi.mock("../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/tauri")>()),
  notifyWorkspaceSelected: () => Promise.resolve(),
  openProjectChat: (...args: unknown[]) => openProjectChat(...args),
}));

import { openProjectChatTarget } from "./useOpenProjectChat";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w-project",
    repository_id: "r1",
    name: "@project",
    branch_name: "main",
    worktree_path: "/repo",
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind: "repository",
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "s9",
    workspace_id: "w-project",
    session_id: null,
    name: "Fresh",
    name_edited: false,
    turn_count: 0,
    sort_order: 0,
    status: "Active",
    created_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    cli_invocation: null,
    agent_status: "Idle",
    needs_attention: false,
    attention_kind: null,
    ...overrides,
  };
}

beforeEach(() => {
  openProjectChat.mockReset();
  useAppStore.setState({
    repositories: [],
    workspaces: [],
    sessionsByWorkspace: {},
    selectedSessionIdByWorkspaceId: {},
    selectedWorkspaceId: null,
    toasts: [],
  });
});

describe("openProjectChatTarget", () => {
  it("opens existing project workspace without creating a chat", async () => {
    // FR-013
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    await openProjectChatTarget("r1");
    expect(openProjectChat).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedWorkspaceId).toBe("w-project");
  });

  it("creates the project workspace when missing and stamps remote_connection_id", async () => {
    // FR-001, FR-013: the Rust model doesn't serialize the UI-only field.
    const { remote_connection_id: _omit, ...raw } = makeWorkspace();
    openProjectChat.mockResolvedValue({
      workspace: raw as Workspace,
      session: makeSession(),
    });
    await openProjectChatTarget("r1");
    expect(openProjectChat).toHaveBeenCalledWith("r1");
    const s = useAppStore.getState();
    const row = s.workspaces.find((w) => w.id === "w-project");
    expect(row?.remote_connection_id).toBeNull();
    expect(s.selectedWorkspaceId).toBe("w-project");
    expect(s.selectedSessionIdByWorkspaceId["w-project"]).toBe("s9");
  });

  it("ignores an archived project workspace and creates a new one", async () => {
    // FR-001
    useAppStore.setState({
      workspaces: [makeWorkspace({ id: "old", status: "Archived" })],
    });
    openProjectChat.mockResolvedValue({
      workspace: makeWorkspace(),
      session: makeSession(),
    });
    await openProjectChatTarget("r1");
    expect(openProjectChat).toHaveBeenCalledWith("r1");
  });

  it("failure shows a toast and selects nothing", async () => {
    openProjectChat.mockRejectedValue(new Error("Project folder not found: /x"));
    await openProjectChatTarget("r1");
    const s = useAppStore.getState();
    expect(s.toasts.some((t) => t.message.includes("Project folder not found: /x"))).toBe(true);
    expect(s.selectedWorkspaceId).toBeNull();
  });
});
