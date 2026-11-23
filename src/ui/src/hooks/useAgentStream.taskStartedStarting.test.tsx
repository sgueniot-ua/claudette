// @vitest-environment happy-dom

/**
 * `task_started` carries no status. For a background `Agent` the launch
 * acknowledgement already fills `resultText`, so without a status the card
 * would read "done" until the first `task_progress`.
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

const persistAgentSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/tauri", async () => {
  const actual = await vi.importActual<typeof import("../services/tauri")>(
    "../services/tauri",
  );
  return {
    ...actual,
    loadChatHistory: vi.fn().mockResolvedValue([]),
    saveTurnToolActivities: vi.fn().mockResolvedValue(undefined),
    setSessionCliInvocation: vi.fn().mockResolvedValue(undefined),
    updateTurnToolActivityProgress: vi.fn().mockResolvedValue(undefined),
    updateTurnAgentActivity: persistAgentSpy,
  };
});

import { useAgentStream } from "./useAgentStream";
import {
  useAppStore,
  type CompletedTurn,
  type ToolActivity,
} from "../stores/useAppStore";
import { findToolActivity } from "../stores/findToolActivity";
import { agentTaskState } from "../components/chat/agentActivityDisplay";

const WS_ID = "ws-1";
const SESSION_ID = "session-1";
const AGENT_TOOL_USE_ID = "toolu_agent1";
const AGENT_ID = "agent-abc";

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
}

function agentActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    toolUseId: AGENT_TOOL_USE_ID,
    toolName: "Agent",
    inputJson: JSON.stringify({ description: "scan", run_in_background: true }),
    resultText: "Async agent launched successfully.",
    collapsed: true,
    summary: "scan",
    agentTaskId: AGENT_ID,
    agentStatus: "running",
    ...overrides,
  };
}

function turn(activities: ToolActivity[]): CompletedTurn {
  return {
    id: "turn-1",
    activities,
    messageCount: 1,
    collapsed: true,
    afterMessageIndex: 1,
  };
}

function agent(): ToolActivity | undefined {
  return findToolActivity(useAppStore.getState(), SESSION_ID, AGENT_TOOL_USE_ID);
}

async function taskStarted(extra: Record<string, unknown> = {}) {
  await fire("agent-stream", {
    workspace_id: WS_ID,
    chat_session_id: SESSION_ID,
    event: {
      Stream: {
        type: "system",
        subtype: "task_started",
        task_id: AGENT_ID,
        tool_use_id: AGENT_TOOL_USE_ID,
        description: "scan",
        ...extra,
      },
    },
  });
}

beforeEach(() => {
  registeredHandlers.clear();
  useAppStore.setState({
    agentQuestions: {},
    toolActivities: {},
    completedTurns: {},
    streamingContent: {},
    streamingThinking: {},
    promptStartTime: {},
    sessionsByWorkspace: {},
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

describe("useAgentStream — task_started marks an Agent starting", () => {
  it("task_started without status marks an Agent starting", async () => {
    // FR-004
    useAppStore.setState({
      toolActivities: { [SESSION_ID]: [agentActivity({ agentStatus: null })] },
    });
    await mountHook();
    await taskStarted();
    expect(agent()?.agentStatus).toBe("starting");
    expect(agentTaskState(agent()!, true)).toBe("progress");
  });

  it("task_started leaves a Bash activity untouched", async () => {
    // FR-017
    useAppStore.setState({
      toolActivities: {
        [SESSION_ID]: [
          agentActivity({ toolName: "Bash", agentStatus: undefined }),
        ],
      },
    });
    await mountHook();
    await taskStarted();
    expect(agent()?.agentStatus ?? null).toBeNull();
  });

  it("task_started keeps an explicit status", async () => {
    // FR-004
    useAppStore.setState({
      toolActivities: { [SESSION_ID]: [agentActivity({ agentStatus: null })] },
    });
    await mountHook();
    await taskStarted({ status: "running" });
    expect(agent()?.agentStatus).toBe("running");
  });

  it("task_started reaches an Agent in a completed turn", async () => {
    // FR-004
    useAppStore.setState({
      completedTurns: {
        [SESSION_ID]: [turn([agentActivity({ agentStatus: null })])],
      },
    });
    await mountHook();
    await taskStarted();
    expect(agent()?.agentStatus).toBe("starting");
    expect(agentTaskState(agent()!, false)).toBe("progress");
  });
});
