// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "../types/chat";
import type { Workspace } from "../types/workspace";
import { useAppStore } from "../stores/useAppStore";

const openProjectChat = vi.fn();
const listChatSessions = vi.fn();
const createChatSession = vi.fn();

vi.mock("../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/tauri")>()),
  notifyWorkspaceSelected: () => Promise.resolve(),
  openProjectChat: (...args: unknown[]) => openProjectChat(...args),
  listChatSessions: (...args: unknown[]) => listChatSessions(...args),
  createChatSession: (...args: unknown[]) => createChatSession(...args),
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
  listChatSessions.mockReset();
  createChatSession.mockReset();
  useAppStore.setState({
    repositories: [],
    workspaces: [],
    sessionsByWorkspace: {},
    sessionsLoadedByWorkspace: {},
    selectedSessionIdByWorkspaceId: {},
    selectedWorkspaceId: null,
    toasts: [],
  });
});

describe("openProjectChatTarget", () => {
  it("opens existing project workspace without creating a chat", async () => {
    // FR-013
    useAppStore.setState({
      workspaces: [makeWorkspace()],
      sessionsByWorkspace: { "w-project": [makeSession()] },
      sessionsLoadedByWorkspace: { "w-project": true },
    });
    await openProjectChatTarget("r1");
    expect(openProjectChat).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedWorkspaceId).toBe("w-project");
  });

  it("creates a chat when the project workspace has no active chat", async () => {
    // FR-013
    const archived = makeSession({ id: "old", status: "Archived" });
    for (const loaded of [true, false]) {
      createChatSession.mockReset();
      listChatSessions.mockReset();
      createChatSession.mockResolvedValue(makeSession());
      listChatSessions.mockResolvedValue([]);
      useAppStore.setState({
        workspaces: [makeWorkspace()],
        sessionsByWorkspace: loaded ? { "w-project": [archived] } : {},
        sessionsLoadedByWorkspace: loaded ? { "w-project": true } : {},
        selectedWorkspaceId: null,
        selectedSessionIdByWorkspaceId: {},
      });
      await openProjectChatTarget("r1");
      expect(openProjectChat).not.toHaveBeenCalled();
      expect(createChatSession).toHaveBeenCalledWith("w-project");
      const s = useAppStore.getState();
      expect(s.selectedWorkspaceId).toBe("w-project");
      expect(s.selectedSessionIdByWorkspaceId["w-project"]).toBe("s9");
    }
  });

  it("does not create a chat when an active chat exists", async () => {
    // FR-013
    const active = makeSession({ id: "live" });
    for (const loaded of [true, false]) {
      createChatSession.mockReset();
      listChatSessions.mockReset();
      listChatSessions.mockResolvedValue([active]);
      useAppStore.setState({
        workspaces: [makeWorkspace()],
        sessionsByWorkspace: loaded ? { "w-project": [active] } : {},
        sessionsLoadedByWorkspace: loaded ? { "w-project": true } : {},
        selectedWorkspaceId: null,
      });
      await openProjectChatTarget("r1");
      expect(createChatSession).not.toHaveBeenCalled();
      expect(openProjectChat).not.toHaveBeenCalled();
      expect(useAppStore.getState().selectedWorkspaceId).toBe("w-project");
    }
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

  it("does not reuse an archived project workspace: asks the backend, which refuses", async () => {
    // FR-001: the backend rejects an archived repository workspace
    // ("project chat workspace is archived"); the user gets a toast.
    useAppStore.setState({
      workspaces: [makeWorkspace({ id: "old", status: "Archived" })],
    });
    openProjectChat.mockRejectedValue(new Error("project chat workspace is archived"));
    await openProjectChatTarget("r1");
    expect(openProjectChat).toHaveBeenCalledWith("r1");
    const s = useAppStore.getState();
    expect(s.toasts.some((t) => t.message.includes("project chat workspace is archived"))).toBe(true);
    expect(s.selectedWorkspaceId).toBeNull();
  });

  it("does not reuse a remote repository workspace", async () => {
    useAppStore.setState({
      workspaces: [makeWorkspace({ remote_connection_id: "conn" })],
    });
    openProjectChat.mockResolvedValue({
      workspace: makeWorkspace({ id: "local" }),
      session: makeSession({ workspace_id: "local" }),
    });
    await openProjectChatTarget("r1");
    expect(openProjectChat).toHaveBeenCalledWith("r1");
  });

  it("still selects the workspace and toasts when listing its chats fails", async () => {
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    listChatSessions.mockRejectedValue(new Error("list failed"));
    await openProjectChatTarget("r1");
    const s = useAppStore.getState();
    expect(createChatSession).not.toHaveBeenCalled();
    expect(s.selectedWorkspaceId).toBe("w-project");
    expect(s.sessionsLoadedByWorkspace["w-project"]).toBe(true);
    expect(s.toasts.some((t) => t.message.includes("list failed"))).toBe(true);
  });

  it("concurrent opens create a single workspace and chat when the workspace is missing", async () => {
    // FR-001, FR-013
    let resolve!: (v: unknown) => void;
    openProjectChat.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = openProjectChatTarget("r1");
    const b = openProjectChatTarget("r1");
    expect(b).toBe(a);
    resolve({ workspace: makeWorkspace(), session: makeSession() });
    await Promise.all([a, b]);
    expect(openProjectChat).toHaveBeenCalledTimes(1);
    expect(createChatSession).not.toHaveBeenCalled();
  });

  it("concurrent opens create a single chat when the workspace has no active chat", async () => {
    // FR-013
    let resolve!: (v: unknown) => void;
    createChatSession.mockReturnValue(new Promise((r) => (resolve = r)));
    useAppStore.setState({
      workspaces: [makeWorkspace()],
      sessionsByWorkspace: { "w-project": [] },
      sessionsLoadedByWorkspace: { "w-project": true },
    });
    const a = openProjectChatTarget("r1");
    const b = openProjectChatTarget("r1");
    resolve(makeSession());
    await Promise.all([a, b]);
    expect(createChatSession).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().selectedSessionIdByWorkspaceId["w-project"]).toBe("s9");
  });

  it("failure shows a toast and selects nothing", async () => {
    openProjectChat.mockRejectedValue(new Error("Project folder not found: /x"));
    await openProjectChatTarget("r1");
    const s = useAppStore.getState();
    expect(s.toasts.some((t) => t.message.includes("Project folder not found: /x"))).toBe(true);
    expect(s.selectedWorkspaceId).toBeNull();
  });
});
