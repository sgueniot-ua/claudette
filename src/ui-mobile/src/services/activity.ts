import type {
  ActivityDisplay,
  AttentionKind,
  MobileAgentStatus,
  WorkspaceActivity,
} from "../types";

export type ActivityState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "disconnected" }
  | { kind: "ready"; byWorkspace: Record<string, WorkspaceActivity> };

export const ACTIVITY_LABELS: Record<ActivityDisplay, string> = {
  running: "Running",
  background: "Background tasks running",
  idle: "Idle",
  ask: "Question requires attention",
  plan: "Plan approval needed",
  unknown: "Status unknown — disconnected",
};

export const ACTIVITY_EVENTS: readonly string[] = [
  "chat-turn-started",
  "agent-stream",
  "agent-background-task",
  "agent-permission-prompt",
  "workspaces-changed",
  "chat-session-created",
  "agent-activity-changed",
];

function fromStatus(
  status: MobileAgentStatus,
  attention: AttentionKind | null,
): ActivityDisplay {
  if (attention === "Ask") return "ask";
  if (attention === "Plan") return "plan";
  if (status === "Running" || status === "Compacting") return "running";
  if (status === "IdleWithBackground") return "background";
  return "idle";
}

export function workspaceDisplay(
  state: ActivityState,
  workspaceId: string,
): ActivityDisplay | null {
  if (state.kind === "disconnected") return "unknown";
  if (state.kind !== "ready") return null;
  const ws = state.byWorkspace[workspaceId];
  return ws ? fromStatus(ws.agent_status, ws.attention_kind) : "idle";
}

export function sessionDisplay(
  state: ActivityState,
  workspaceId: string,
  sessionId: string,
): ActivityDisplay | null {
  if (state.kind === "disconnected") return "unknown";
  if (state.kind !== "ready") return null;
  const session = state.byWorkspace[workspaceId]?.sessions.find(
    (s) => s.session_id === sessionId,
  );
  return session
    ? fromStatus(session.agent_status, session.needs_attention ? session.attention_kind : null)
    : "idle";
}

export function nextStateOnFetch(
  result: { ok: true; data: WorkspaceActivity[] } | { ok: false },
  connected: boolean,
): ActivityState {
  if (!result.ok) return { kind: connected ? "unavailable" : "disconnected" };
  return {
    kind: "ready",
    byWorkspace: Object.fromEntries(result.data.map((w) => [w.workspace_id, w])),
  };
}

/** Leading + trailing throttle: first request runs now, later ones coalesce into one run at window end. */
export class RefetchThrottle {
  private lastRun = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly run: () => void,
    private readonly intervalMs = 300,
  ) {}

  request(): void {
    if (this.timer !== null) return;
    const wait = this.lastRun + this.intervalMs - Date.now();
    if (wait <= 0) {
      this.fire();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, wait);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private fire(): void {
    this.lastRun = Date.now();
    this.run();
  }
}
