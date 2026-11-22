import { describe, expect, it } from "vitest";
import { workspaceIndicator } from "./workspaceIndicator";
import type { ChatSession } from "../../types";

const session = (over: Partial<ChatSession> = {}): ChatSession => ({
  id: "s1",
  workspace_id: "ws-1",
  session_id: null,
  name: "s",
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
  ...over,
});

const base = {
  sessions: [] as ChatSession[],
  agentStatus: "Idle" as const,
  unread: false,
  envPreparing: false,
};

describe("workspaceIndicator", () => {
  // FR-011
  it("background_beats_done", () => {
    expect(
      workspaceIndicator({ ...base, agentStatus: "IdleWithBackground", unread: true }),
    ).toBe("background");
  });

  // FR-011
  it("done_when_idle_and_unread", () => {
    expect(workspaceIndicator({ ...base, unread: true })).toBe("done");
  });

  // FR-011
  it("ask_beats_everything", () => {
    expect(
      workspaceIndicator({
        ...base,
        sessions: [session({ needs_attention: true, attention_kind: "Ask" })],
        agentStatus: "Running",
        unread: true,
      }),
    ).toBe("ask");
  });

  // FR-011
  it("plan_beats_background", () => {
    expect(
      workspaceIndicator({
        ...base,
        sessions: [session({ needs_attention: true, attention_kind: "Plan" })],
        agentStatus: "IdleWithBackground",
      }),
    ).toBe("plan");
  });

  // FR-006
  it("running_and_compacting", () => {
    expect(workspaceIndicator({ ...base, agentStatus: "Running" })).toBe("running");
    expect(workspaceIndicator({ ...base, agentStatus: "Compacting" })).toBe("compacting");
  });

  // FR-011
  it("env_spinner_when_idle", () => {
    expect(workspaceIndicator({ ...base, envPreparing: true })).toBe("env");
  });

  it("idle_falls_through", () => {
    expect(workspaceIndicator(base)).toBe("other");
  });
});
