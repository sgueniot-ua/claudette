// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const getChatSessionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/tauri", () => ({ getChatSession: getChatSessionMock }));

import { useAppStore } from "../../stores/useAppStore";
import type { ChatSession, SessionAgentStatus } from "../../types/chat";
import { refreshSessionBackgroundStatus } from "./sessionActivityRefresh";

function makeSession(agent_status: SessionAgentStatus): ChatSession {
  return {
    id: "session-1",
    workspace_id: "ws-1",
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

function seed(agent_status: SessionAgentStatus) {
  useAppStore.setState({
    sessionsByWorkspace: { "ws-1": [makeSession(agent_status)] },
    agentBackgroundTasksBySessionId: {},
  });
}

function status() {
  return useAppStore.getState().sessionsByWorkspace["ws-1"]?.[0]?.agent_status;
}

describe("refreshSessionBackgroundStatus", () => {
  beforeEach(() => {
    getChatSessionMock.mockReset();
  });

  // FR-006
  it("raises Idle to IdleWithBackground from Rust", async () => {
    seed("Idle");
    getChatSessionMock.mockResolvedValue(makeSession("IdleWithBackground"));
    await refreshSessionBackgroundStatus("ws-1", "session-1");
    expect(status()).toBe("IdleWithBackground");
  });

  // FR-006: a user stop stays visible.
  it("never turns Stopped into Idle", async () => {
    seed("Stopped");
    getChatSessionMock.mockResolvedValue(makeSession("Idle"));
    await refreshSessionBackgroundStatus("ws-1", "session-1");
    expect(status()).toBe("Stopped");
  });

  // FR-006: the turn lifecycle owns Running.
  it("ignores a Running answer", async () => {
    seed("Idle");
    getChatSessionMock.mockResolvedValue(makeSession("Running"));
    await refreshSessionBackgroundStatus("ws-1", "session-1");
    expect(status()).toBe("Idle");
  });

  // FR-006: the latest request wins.
  it("drops an older response that lands last", async () => {
    seed("Idle");
    let resolveFirst: (value: ChatSession) => void = () => {};
    getChatSessionMock
      .mockReturnValueOnce(
        new Promise<ChatSession>((r) => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce(makeSession("Idle"));
    const first = refreshSessionBackgroundStatus("ws-1", "session-1");
    await refreshSessionBackgroundStatus("ws-1", "session-1");
    resolveFirst(makeSession("IdleWithBackground"));
    await first;
    expect(status()).toBe("Idle");
  });

  // FR-006: no fetch for a session the store does not hold.
  it("skips the fetch for a session not in the store", async () => {
    seed("Idle");
    await refreshSessionBackgroundStatus("ws-1", "unknown-session");
    await refreshSessionBackgroundStatus("ws-other", "session-1");
    expect(getChatSessionMock).not.toHaveBeenCalled();
  });

  it("swallows a failed read", async () => {
    seed("Idle");
    getChatSessionMock.mockRejectedValue(new Error("offline"));
    await expect(
      refreshSessionBackgroundStatus("ws-1", "session-1"),
    ).resolves.toBeUndefined();
    expect(status()).toBe("Idle");
  });
});
