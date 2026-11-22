// @vitest-environment happy-dom

/**
 * The chat tab must show "Background tasks running" after a turn whose
 * background tasks (shell, subagent, Workflow) outlive it (FR-006). The
 * store used to reset the session to Idle on `result`, and task events that
 * arrived during the turn were ignored, so the tab showed Idle. The session
 * status is now re-read from Rust at turn end and on `agent-activity-changed`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HandlerRecord = (event: { payload: unknown }) => void;
const registeredHandlers = new Map<string, HandlerRecord[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: HandlerRecord) => {
    const list = registeredHandlers.get(eventName) ?? [];
    list.push(handler);
    registeredHandlers.set(eventName, list);
    return Promise.resolve(() => {
      const after =
        registeredHandlers.get(eventName)?.filter((h) => h !== handler) ?? [];
      registeredHandlers.set(eventName, after);
    });
  },
}));

const getChatSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../services/tauri", async () => {
  const actual = await vi.importActual<typeof import("../services/tauri")>(
    "../services/tauri",
  );
  return {
    ...actual,
    getChatSession: getChatSessionMock,
    loadChatHistory: vi.fn().mockResolvedValue([]),
    saveTurnToolActivities: vi.fn().mockResolvedValue(undefined),
    setSessionCliInvocation: vi.fn().mockResolvedValue(undefined),
  };
});

import { useAgentStream } from "./useAgentStream";
import { useAppStore } from "../stores/useAppStore";
import { statusFor } from "../components/chat/sessionTabsLogic";
import { markChatTurnStarting } from "../components/chat/chatTurnLifecycle";
import type { ChatSession, SessionAgentStatus } from "../types/chat";
import type { TerminalTab } from "../types/terminal";

const WS_ID = "ws-1";
const SESSION_ID = "session-1";

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

async function mountHook(): Promise<void> {
  function Probe() {
    useAgentStream();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(<Probe />);
  });
}

async function fire(eventName: string, payload: unknown): Promise<void> {
  const handlers = registeredHandlers.get(eventName) ?? [];
  expect(handlers.length).toBeGreaterThan(0);
  await act(async () => {
    for (const handler of handlers) handler({ payload });
  });
  await flush();
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function makeSession(agent_status: SessionAgentStatus): ChatSession {
  return {
    id: SESSION_ID,
    workspace_id: WS_ID,
    session_id: null,
    name: "New chat",
    name_edited: false,
    turn_count: 1,
    sort_order: 0,
    status: "Active",
    created_at: "2026-11-22T00:00:00Z",
    archived_at: null,
    cli_invocation: null,
    agent_status,
    needs_attention: false,
    attention_kind: null,
  };
}

function rustSays(agent_status: SessionAgentStatus) {
  getChatSessionMock.mockResolvedValue(makeSession(agent_status));
}

function taskTab(task_status: string): TerminalTab {
  return {
    id: 10,
    workspace_id: WS_ID,
    title: "Task",
    kind: "agent_task",
    is_script_output: false,
    sort_order: 0,
    created_at: "2026-11-22T00:00:00Z",
    agent_chat_session_id: SESSION_ID,
    agent_task_id: "task-1",
    task_status,
  };
}

function session(): ChatSession {
  const found = useAppStore.getState().sessionsByWorkspace[WS_ID]?.[0];
  if (!found) throw new Error("session missing");
  return found;
}

function workspaceStatus() {
  return useAppStore.getState().workspaces[0]?.agent_status;
}

const resultEvent = {
  workspace_id: WS_ID,
  chat_session_id: SESSION_ID,
  event: { Stream: { type: "result", subtype: "success" } },
};

beforeEach(() => {
  registeredHandlers.clear();
  getChatSessionMock.mockReset();
  useAppStore.setState({
    agentQuestions: {},
    toolActivities: {},
    completedTurns: {},
    streamingContent: {},
    streamingThinking: {},
    promptStartTime: {},
    chatMessages: {},
    chatAttachments: {},
    unreadCompletions: new Set(),
    agentBackgroundTasksBySessionId: {},
    workspaces: [
      {
        id: WS_ID,
        repository_id: "repo-1",
        name: "workspace",
        branch_name: "feat/x",
        worktree_path: "/tmp/ws",
        status: "Active",
        agent_status: "Running",
        status_line: "",
        created_at: "2026-11-22T00:00:00Z",
        sort_order: 0,
        remote_connection_id: null,
        input_values: null,
      },
    ],
    sessionsByWorkspace: { [WS_ID]: [makeSession("Running")] },
  });
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0).reverse()) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

describe("useAgentStream — background status after the turn", () => {
  // FR-006 (US2-AS1): a shell task started during the turn keeps the tab on
  // "background" after `result`; FR-006 (US2-AS2): back to idle at its end.
  it("shows background after result when a task started during the turn, then idle when it ends", async () => {
    await mountHook();
    rustSays("Running");
    await fire("agent-background-task", {
      kind: "bound",
      workspace_id: WS_ID,
      chat_session_id: SESSION_ID,
      tab: taskTab("running"),
    });
    expect(session().agent_status).toBe("Running");

    rustSays("IdleWithBackground");
    await fire("agent-stream", resultEvent);
    expect(statusFor(session())).toEqual({ kind: "background" });
    expect(workspaceStatus()).toBe("IdleWithBackground");

    rustSays("Idle");
    await fire("agent-activity-changed", {
      workspace_id: WS_ID,
      chat_session_id: SESSION_ID,
    });
    await fire("agent-background-task", {
      kind: "status",
      workspace_id: WS_ID,
      chat_session_id: SESSION_ID,
      tab: taskTab("completed"),
    });
    expect(statusFor(session())).toEqual({ kind: "idle" });
    expect(workspaceStatus()).toBe("Idle");
  });

  // FR-006: subagents and Workflows have no task tab; Rust's status still
  // drives the tab and the workspace row.
  it("shows background for a task without a terminal tab, then idle on activity change", async () => {
    await mountHook();
    rustSays("IdleWithBackground");
    await fire("agent-stream", resultEvent);
    expect(statusFor(session())).toEqual({ kind: "background" });
    expect(workspaceStatus()).toBe("IdleWithBackground");

    rustSays("Idle");
    await fire("agent-activity-changed", {
      workspace_id: WS_ID,
      chat_session_id: SESSION_ID,
    });
    expect(statusFor(session())).toEqual({ kind: "idle" });
    expect(workspaceStatus()).toBe("Idle");
  });

  // FR-006: a late answer never overrides a new turn's Running.
  it("ignores a response that lands after a new turn started", async () => {
    await mountHook();
    let resolve: (value: ChatSession) => void = () => {};
    getChatSessionMock.mockReturnValue(
      new Promise<ChatSession>((r) => {
        resolve = r;
      }),
    );
    await act(async () => {
      for (const handler of registeredHandlers.get("agent-stream") ?? []) {
        handler({ payload: resultEvent });
      }
    });
    markChatTurnStarting({
      sessionId: SESSION_ID,
      workspaceId: WS_ID,
      messageId: "m-2",
      content: "next",
    });

    resolve(makeSession("IdleWithBackground"));
    await flush();

    expect(session().agent_status).toBe("Running");
  });
});
