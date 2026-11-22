import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_LABELS,
  RefetchThrottle,
  nextStateOnFetch,
  sessionDisplay,
  workspaceDisplay,
  type ActivityState,
} from "./activity";
import type { WorkspaceActivity } from "../types";

const data: WorkspaceActivity[] = [
  {
    workspace_id: "ws",
    agent_status: "Running",
    attention_kind: null,
    sessions: [
      { session_id: "s1", agent_status: "Running", needs_attention: false, attention_kind: null },
      { session_id: "s2", agent_status: "IdleWithBackground", needs_attention: false, attention_kind: null },
    ],
  },
  {
    workspace_id: "wp",
    agent_status: "Running",
    attention_kind: "Plan",
    sessions: [
      { session_id: "p1", agent_status: "Running", needs_attention: true, attention_kind: "Plan" },
    ],
  },
];

const ready: ActivityState = {
  kind: "ready",
  byWorkspace: Object.fromEntries(data.map((w) => [w.workspace_id, w])),
};

describe("display", () => {
  // FR-003
  it("workspace Running is running", () => {
    expect(workspaceDisplay(ready, "ws")).toBe("running");
  });

  // FR-004
  it("session IdleWithBackground is background", () => {
    expect(sessionDisplay(ready, "ws", "s2")).toBe("background");
  });

  // FR-005
  it("absent session is idle", () => {
    expect(sessionDisplay(ready, "ws", "nope")).toBe("idle");
  });

  // FR-012
  it("Plan attention wins over Running", () => {
    expect(workspaceDisplay(ready, "wp")).toBe("plan");
    expect(sessionDisplay(ready, "wp", "p1")).toBe("plan");
  });

  // FR-013
  it("disconnected is unknown even with attention", () => {
    expect(workspaceDisplay({ kind: "disconnected" }, "wp")).toBe("unknown");
    expect(sessionDisplay({ kind: "disconnected" }, "wp", "p1")).toBe("unknown");
  });

  // FR-013
  it("unavailable and loading give no indicator", () => {
    expect(workspaceDisplay({ kind: "unavailable" }, "ws")).toBeNull();
    expect(sessionDisplay({ kind: "loading" }, "ws", "s1")).toBeNull();
  });
});

describe("nextStateOnFetch", () => {
  it("maps results", () => {
    expect(nextStateOnFetch({ ok: false }, true)).toEqual({ kind: "unavailable" });
    expect(nextStateOnFetch({ ok: false }, false)).toEqual({ kind: "disconnected" });
    expect(nextStateOnFetch({ ok: true, data }, true)).toEqual(ready);
  });
});

describe("labels and events", () => {
  // FR-007, FR-010
  it("has distinct exact labels", () => {
    expect(ACTIVITY_LABELS.running).not.toBe(ACTIVITY_LABELS.background);
    expect(ACTIVITY_LABELS.background).not.toBe(ACTIVITY_LABELS.idle);
    expect(ACTIVITY_LABELS).toEqual({
      running: "Running",
      background: "Background tasks running",
      idle: "Idle",
      ask: "Question requires attention",
      plan: "Plan approval needed",
      unknown: "Status unknown — disconnected",
    });
  });

  it("lists the 7 contract events", () => {
    expect([...ACTIVITY_EVENTS].sort()).toEqual(
      [
        "chat-turn-started",
        "agent-stream",
        "agent-background-task",
        "agent-permission-prompt",
        "workspaces-changed",
        "chat-session-created",
        "agent-activity-changed",
      ].sort(),
    );
  });
});

describe("RefetchThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // FR-008
  it("coalesces 100 requests in 1s to at most 5 runs, leading and trailing", () => {
    const run = vi.fn();
    const t = new RefetchThrottle(run, 300);
    t.request();
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 99; i++) {
      vi.advanceTimersByTime(10);
      t.request();
    }
    vi.advanceTimersByTime(300);
    expect(run.mock.calls.length).toBeLessThanOrEqual(5);
    const before = run.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(run.mock.calls.length).toBe(before);
    expect(before).toBeGreaterThan(1);
  });

  it("dispose cancels the pending run", () => {
    const run = vi.fn();
    const t = new RefetchThrottle(run, 300);
    t.request();
    t.request();
    t.dispose();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
