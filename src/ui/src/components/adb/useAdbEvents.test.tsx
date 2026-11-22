// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import type {
  AdbDevicesChangedPayload,
  AdbLogcatLinesPayload,
  AdbSessionStatusPayload,
} from "../../types/adb";
import { adbLogBuffer } from "./adbLogBuffer";
import { useAdbEvents } from "./useAdbEvents";

const unlisten = vi.fn();
const handlers: {
  lines?: (p: AdbLogcatLinesPayload) => void;
  status?: (p: AdbSessionStatusPayload) => void;
  devices?: (p: AdbDevicesChangedPayload) => void;
} = {};

vi.mock("../../services/adb", () => ({
  listenAdbLogcatLines: vi.fn((h) => {
    handlers.lines = h;
    return Promise.resolve(unlisten);
  }),
  listenAdbSessionStatus: vi.fn((h) => {
    handlers.status = h;
    return Promise.resolve(unlisten);
  }),
  listenAdbDevicesChanged: vi.fn((h) => {
    handlers.devices = h;
    return Promise.resolve(unlisten);
  }),
}));

function Probe() {
  useAdbEvents();
  return null;
}

let container: HTMLElement;
let root: Root;
const frames: FrameRequestCallback[] = [];

beforeEach(async () => {
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  adbLogBuffer.clear("w1");
  useAppStore.setState({ adbSessions: {}, adbDevices: [], adbLogVersion: {} });
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const line = (message: string) => ({ ts: null, pid: 1, tid: 1, level: "i" as const, tag: "T", message });

describe("useAdbEvents", () => {
  it("feeds log lines to the buffer and bumps the version once per frame", async () => {
    // FR-006
    act(() => {
      handlers.lines!({ workspace_id: "w1", lines: [line("a")], reset: false });
      handlers.lines!({ workspace_id: "w1", lines: [line("b")], reset: false });
    });
    expect(adbLogBuffer.size("w1")).toBe(2);
    expect(useAppStore.getState().adbLogVersion.w1).toBeUndefined();
    expect(frames).toHaveLength(1);
    act(() => frames[0](0));
    expect(useAppStore.getState().adbLogVersion.w1).toBe(1);
  });

  it("feeds session status and devices to the store", async () => {
    // FR-008
    act(() => {
      handlers.status!({ workspace_id: "w1", status: { kind: "stopped" } });
      handlers.devices!({
        devices: [{ serial: "R5", state: { kind: "device" }, model: null, avd_name: null }],
      });
    });
    expect(useAppStore.getState().adbSessions.w1).toEqual({ kind: "stopped" });
    expect(useAppStore.getState().adbDevices).toHaveLength(1);
  });

  it("releases the log buffer of an archived or deleted workspace", async () => {
    // FR-011
    const ws = (id: string, status: "Active" | "Archived") => ({ id, status }) as never;
    adbLogBuffer.append("w1", [line("a")]);
    adbLogBuffer.append("w2", [line("b")]);
    act(() => useAppStore.setState({ workspaces: [ws("w1", "Active"), ws("w2", "Active")] }));
    act(() => useAppStore.setState({ workspaces: [ws("w1", "Archived"), ws("w2", "Active")] }));
    expect(adbLogBuffer.size("w1")).toBe(0);
    expect(adbLogBuffer.size("w2")).toBe(1);
    act(() => useAppStore.setState({ workspaces: [ws("w1", "Archived")] }));
    expect(adbLogBuffer.size("w2")).toBe(0);
    act(() => useAppStore.setState({ workspaces: [] }));
  });

  it("unlistens on unmount", async () => {
    // FR-008
    await act(async () => root.unmount());
    expect(unlisten).toHaveBeenCalledTimes(3);
  });
});
