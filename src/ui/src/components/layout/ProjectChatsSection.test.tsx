// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "../../types/chat";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

const listChatSessions = vi.fn();
const openProjectChat = vi.fn();

vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  notifyWorkspaceSelected: () => Promise.resolve(),
  listChatSessions: (...args: unknown[]) => listChatSessions(...args),
  openProjectChat: (...args: unknown[]) => openProjectChat(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { error?: string }) =>
      opts?.error ? `${key} ${opts.error}` : key,
  }),
}));

import { ProjectChatsSection } from "./ProjectChatsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

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
    id: "s1",
    workspace_id: "w-project",
    session_id: null,
    name: "Chat one",
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

async function renderSection(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(<ProjectChatsSection repoId="r1" />);
  });
  return container;
}

beforeEach(() => {
  listChatSessions.mockReset();
  openProjectChat.mockReset();
  listChatSessions.mockResolvedValue([]);
  useAppStore.setState({
    workspaces: [],
    sessionsByWorkspace: {},
    selectedSessionIdByWorkspaceId: {},
    selectedWorkspaceId: null,
    selectedRepositoryId: "r1",
    toasts: [],
  });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  for (const c of mountedContainers.splice(0)) c.remove();
});

describe("ProjectChatsSection", () => {
  it("lists only active sessions of the project workspace", async () => {
    // US3-1, FR-013
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    listChatSessions.mockResolvedValue([
      makeSession({ id: "s1", name: "Chat one" }),
      makeSession({ id: "s2", name: "Old chat", status: "Archived", archived_at: "x" }),
    ]);
    const c = await renderSection();
    expect(listChatSessions).toHaveBeenCalledWith("w-project", false);
    expect(c.textContent).toContain("Chat one");
    expect(c.textContent).not.toContain("Old chat");
    expect(c.textContent).not.toContain("project_chats_empty");
  });

  it("shows the empty state when there is no chat", async () => {
    const c = await renderSection();
    expect(c.textContent).toContain("project_chats_empty");
  });

  it("shows the shared-folder notice permanently", async () => {
    // FR-005
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    listChatSessions.mockResolvedValue([makeSession()]);
    const c = await renderSection();
    expect(c.textContent).toContain("project_chats_shared_notice");
    const empty = await renderSection();
    expect(empty.textContent).toContain("project_chats_shared_notice");
  });

  it("new chat opens the returned session", async () => {
    // FR-001, US1-1
    const workspace = makeWorkspace();
    const session = makeSession({ id: "s9", name: "Fresh" });
    openProjectChat.mockResolvedValue({ workspace, session });
    const c = await renderSection();
    const btn = Array.from(c.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("project_chats_new"),
    )!;
    await act(async () => {
      btn.click();
    });
    expect(openProjectChat).toHaveBeenCalledWith("r1");
    const s = useAppStore.getState();
    expect(s.workspaces.some((w) => w.id === workspace.id)).toBe(true);
    expect(s.selectedWorkspaceId).toBe(workspace.id);
    expect(s.selectedSessionIdByWorkspaceId[workspace.id]).toBe("s9");
  });

  it("clicking a chat opens it", async () => {
    // US3-1
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    listChatSessions.mockResolvedValue([
      makeSession({ id: "s1" }),
      makeSession({ id: "s2", name: "Second" }),
    ]);
    const c = await renderSection();
    const row = Array.from(c.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Second"),
    )!;
    await act(async () => {
      row.click();
    });
    const s = useAppStore.getState();
    expect(s.selectedWorkspaceId).toBe("w-project");
    expect(s.selectedSessionIdByWorkspaceId["w-project"]).toBe("s2");
  });

  it("new chat failure shows a toast", async () => {
    // edge case: missing project folder
    openProjectChat.mockRejectedValue(new Error("Project folder not found: /x"));
    const c = await renderSection();
    const btn = Array.from(c.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("project_chats_new"),
    )!;
    await act(async () => {
      btn.click();
    });
    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes("Project folder not found: /x"))).toBe(true);
    expect(useAppStore.getState().selectedWorkspaceId).toBeNull();
  });
});
