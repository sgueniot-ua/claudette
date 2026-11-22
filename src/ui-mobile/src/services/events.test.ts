import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  },
}));

import { onActivitySignal } from "./events";
import { ACTIVITY_EVENTS } from "./activity";

function forward(name: string, payload: unknown, connection_id = "c1") {
  handlers.get(name)?.({ payload: { connection_id, payload } });
}

function stream(event: unknown) {
  return { workspace_id: "w1", session_id: "s1", event };
}

describe("onActivitySignal", () => {
  beforeEach(() => handlers.clear());

  // FR-008: every contract event is still listened to.
  it("listens to the 7 contract events", async () => {
    await onActivitySignal("c1", () => {});
    expect([...handlers.keys()].sort()).toEqual([...ACTIVITY_EVENTS].sort());
  });

  // FR-008: agent-stream refetches only on activity-changing events.
  it("signals on a turn end but not on streaming deltas", async () => {
    const signal = vi.fn();
    await onActivitySignal("c1", signal);

    forward("agent-stream", stream({ Stream: { type: "stream_event", event: {} } }));
    forward("agent-stream", stream({ Stream: { type: "assistant", message: {} } }));
    expect(signal).not.toHaveBeenCalled();

    forward("agent-stream", stream({ Stream: { type: "result", subtype: "success" } }));
    expect(signal).toHaveBeenCalledTimes(1);
  });

  // FR-008: the other events always signal, for this connection only.
  it("signals on other contract events for its own connection", async () => {
    const signal = vi.fn();
    await onActivitySignal("c1", signal);

    forward("agent-activity-changed", { workspace_id: "w1", chat_session_id: "s1" });
    forward("chat-turn-started", {}, "other");
    expect(signal).toHaveBeenCalledTimes(1);
  });
});
