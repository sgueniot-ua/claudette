// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "../../types/chat";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

const clearConversation = vi.fn();
const rollbackToCheckpoint = vi.fn();

vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  clearConversation: (...args: unknown[]) => clearConversation(...args),
  rollbackToCheckpoint: (...args: unknown[]) => rollbackToCheckpoint(...args),
  loadDiffFiles: () => Promise.resolve({ files: [], merge_base: "" }),
  loadCompletedTurns: () => Promise.resolve([]),
  loadAttachmentsForSession: () => Promise.resolve([]),
  loadAttachmentData: () => Promise.resolve(""),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

import { RollbackModal } from "./RollbackModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
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
    workspace_id: "w1",
    session_id: null,
    name: "Chat",
    name_edited: false,
    turn_count: 1,
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

function setup(opts: {
  kind?: Workspace["kind"];
  sessions?: ChatSession[];
  checkpointId?: string | null;
  hasFileChanges?: boolean;
}) {
  useAppStore.setState({
    workspaces: [makeWorkspace({ kind: opts.kind ?? "repository" })],
    sessionsByWorkspace: { w1: opts.sessions ?? [makeSession()] },
    modalData: {
      workspaceId: "w1",
      sessionId: "s1",
      checkpointId: opts.checkpointId === undefined ? "c1" : opts.checkpointId,
      messageId: null,
      messagePreview: "hello",
      messageContent: "",
      hasFileChanges: opts.hasFileChanges ?? true,
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  act(() => root.render(<RollbackModal />));
  return document.body;
}

function checkbox(c: HTMLElement): HTMLInputElement | null {
  return c.querySelector('input[type="checkbox"]');
}

function tick(c: HTMLElement) {
  act(() => checkbox(c)!.click());
}

beforeEach(() => {
  clearConversation.mockReset().mockResolvedValue([]);
  rollbackToCheckpoint.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  for (const r of mountedRoots.splice(0)) act(() => r.unmount());
  for (const c of mountedContainers.splice(0)) c.remove();
});

describe("RollbackModal project chats", () => {
  // FR-014
  it("warns about the shared folder when restoring files in a project chat", () => {
    const c = setup({});
    expect(c.textContent).not.toContain("rollback_project_shared_warning");
    tick(c);
    expect(c.textContent).toContain("rollback_project_shared_warning");
    expect(c.textContent).not.toContain("rollback_project_clear_warning");
  });

  // FR-015
  it("explains the pre-conversation restore on clear-all", () => {
    const c = setup({ checkpointId: null, hasFileChanges: false });
    expect(c.textContent).toContain("rollback_project_restore_start");
    tick(c);
    expect(c.textContent).toContain("rollback_project_clear_warning");
    expect(c.textContent).toContain("rollback_project_shared_warning");
  });

  // FR-015
  it("hides restore on clear-all when the chat has no message yet", () => {
    const c = setup({
      checkpointId: null,
      sessions: [makeSession({ turn_count: 0 })],
    });
    expect(checkbox(c)).toBeNull();
  });

  // FR-017
  it("adds the running-chats warning with the count", () => {
    const c = setup({
      sessions: [
        makeSession(),
        makeSession({ id: "s2", agent_status: "Running" }),
        makeSession({ id: "s3", agent_status: "Running" }),
        makeSession({ id: "s4" }),
      ],
    });
    expect(c.textContent).not.toContain("rollback_project_others_running");
    tick(c);
    expect(c.textContent).toContain("rollback_project_others_running:2");
  });

  // FR-017
  it("does not count the current session as another running chat", () => {
    const c = setup({
      sessions: [makeSession({ agent_status: "Running" })],
    });
    tick(c);
    expect(c.textContent).not.toContain("rollback_project_others_running");
  });

  // FR-014
  it("cancel does not call rollback services", () => {
    const c = setup({});
    tick(c);
    const cancel = c.querySelectorAll("button")[0] as HTMLButtonElement;
    act(() => cancel.click());
    expect(clearConversation).not.toHaveBeenCalled();
    expect(rollbackToCheckpoint).not.toHaveBeenCalled();
  });

  // FR-014
  it("confirm calls the same service with the restore flag", async () => {
    const c = setup({});
    tick(c);
    const confirm = c.querySelectorAll("button")[1] as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(rollbackToCheckpoint).toHaveBeenCalledWith("s1", "c1", true);
  });

  // FR-012
  it("worktree workspaces keep the current modal", () => {
    const c = setup({
      kind: "worktree",
      sessions: [
        makeSession(),
        makeSession({ id: "s2", agent_status: "Running" }),
      ],
    });
    expect(c.textContent).toContain("rollback_restore_files");
    tick(c);
    expect(c.textContent).not.toContain("rollback_project_shared_warning");
    expect(c.textContent).not.toContain("rollback_project_others_running");
  });

  // FR-012
  it("worktree clear-all still depends on hasFileChanges", () => {
    const c = setup({
      kind: "worktree",
      checkpointId: null,
      hasFileChanges: false,
    });
    expect(checkbox(c)).toBeNull();
  });
});
