// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import type { AdbDevice, AdbSessionStatus } from "../../types/adb";
import { adbLogBuffer } from "./adbLogBuffer";
import { AdbPanel } from "./AdbPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { device?: string }) => (opts?.device ? `${key}|${opts.device}` : key),
  }),
}));
vi.mock("./AdbLogList", () => ({
  AdbLogList: ({
    highlight,
    reveal,
  }: {
    highlight?: number[];
    reveal?: { index: number; tick: number } | null;
  }) => (
    <div
      data-testid="log"
      data-highlight={(highlight ?? []).join(",")}
      data-reveal={reveal ? `${reveal.index}:${reveal.tick}` : ""}
    />
  ),
}));
vi.mock("../../hotkeys/platform", () => ({ getHotkeyPlatform: () => "mac" }));
vi.mock("../../services/adb", () => ({
  adbGetWorkspaceDevice: vi.fn(),
  adbSetWorkspaceDevice: vi.fn(),
  listenAdbLogcatLines: vi.fn(() => Promise.resolve(() => {})),
  listenAdbSessionStatus: vi.fn(() => Promise.resolve(() => {})),
  listenAdbDevicesChanged: vi.fn(() => Promise.resolve(() => {})),
}));

import { adbGetWorkspaceDevice, adbSetWorkspaceDevice } from "../../services/adb";

const getDevice = vi.mocked(adbGetWorkspaceDevice);
const setDevice = vi.mocked(adbSetWorkspaceDevice);

function device(serial: string, over: Partial<AdbDevice> = {}): AdbDevice {
  return { serial, state: { kind: "device" }, model: null, avd_name: null, ...over };
}

let container: HTMLElement;
let root: Root;

function setSession(workspaceId: string, status: AdbSessionStatus) {
  useAppStore.getState().setAdbSessionStatus(workspaceId, status);
}
async function render() {
  await act(async () => {
    root.render(<AdbPanel />);
  });
}
async function select(workspaceId: string) {
  await act(async () => {
    useAppStore.setState({ selectedWorkspaceId: workspaceId });
  });
}
function text(): string {
  return container.textContent ?? "";
}
function panel(): HTMLElement {
  return container.querySelector('[data-testid="adb-panel"]') as HTMLElement;
}
function picker(): HTMLSelectElement {
  return container.querySelector("select") as HTMLSelectElement;
}
function pressModF(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    code: "KeyF",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  getDevice.mockResolvedValue(null);
  setDevice.mockResolvedValue({ kind: "needs_choice" });
  adbLogBuffer.clear("w1");
  adbLogBuffer.clear("w2");
  useAppStore.setState({
    selectedWorkspaceId: "w1",
    adbSessions: {},
    adbDevices: [],
    adbLogVersion: {},
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("AdbPanel state messages", () => {
  it("shows the adb-missing message", async () => {
    // FR-008
    setSession("w1", { kind: "adb_missing" });
    await render();
    expect(text()).toContain("adb_missing");
  });

  it("shows how to associate a device when none is connected", async () => {
    // FR-008
    setSession("w1", { kind: "no_device" });
    await render();
    expect(text()).toContain("adb_no_device");
  });

  it("asks to choose when several devices are connected", async () => {
    // FR-005
    setSession("w1", { kind: "needs_choice" });
    await render();
    expect(text()).toContain("adb_needs_choice");
  });

  it("explains a disconnected chosen device with its name", async () => {
    // FR-005
    useAppStore.setState({ adbDevices: [] });
    setSession("w1", {
      kind: "waiting",
      device: { kind: "avd", value: "Pixel_8" },
      reason: "disconnected",
    });
    await render();
    expect(text()).toContain("adb_waiting_disconnected|Pixel_8");
  });

  it("asks to allow USB debugging for an unauthorized device", async () => {
    // FR-005
    setSession("w1", {
      kind: "waiting",
      device: { kind: "serial", value: "R5" },
      reason: "unauthorized",
    });
    await render();
    expect(text()).toContain("adb_waiting_unauthorized");
  });

  it("shows the stopped message", async () => {
    // FR-008
    setSession("w1", { kind: "stopped" });
    await render();
    expect(text()).toContain("adb_stopped");
  });

  it("names the device avd_name > model > serial with its source", async () => {
    // FR-005
    setSession("w1", {
      kind: "streaming",
      device: device("emulator-5554", { model: "sdk_gphone", avd_name: "Pixel_8" }),
      source: "dedicated_emulator",
    });
    await render();
    expect(container.querySelector(".deviceName, [class*=deviceName]")?.textContent).toBe("Pixel_8");
    expect(text()).toContain("adb_source_dedicated_emulator");

    await act(async () => {
      setSession("w1", {
        kind: "streaming",
        device: device("R5", { model: "SM-G991" }),
        source: "manual",
      });
    });
    expect(container.querySelector("[class*=deviceName]")?.textContent).toBe("SM-G991");
    expect(text()).toContain("adb_source_manual");

    await act(async () => {
      setSession("w1", { kind: "streaming", device: device("R6"), source: "only_device" });
    });
    expect(container.querySelector("[class*=deviceName]")?.textContent).toBe("R6");
    expect(text()).toContain("adb_source_only_device");
  });
});

describe("AdbPanel picker", () => {
  beforeEach(() => {
    useAppStore.setState({
      adbDevices: [
        device("R5", { model: "SM-G991" }),
        device("emulator-5554", { avd_name: "Pixel_8" }),
        device("emulator-5556", { state: { kind: "unauthorized" } }),
      ],
    });
    setSession("w1", { kind: "needs_choice" });
  });

  it("stores a physical device by serial", async () => {
    // FR-007a
    await render();
    await act(async () => {
      picker().value = "serial:R5";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setDevice).toHaveBeenCalledWith("w1", { kind: "serial", value: "R5" });
  });

  it("stores an emulator by avd name", async () => {
    // FR-007a
    await render();
    await act(async () => {
      picker().value = "avd:Pixel_8";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setDevice).toHaveBeenCalledWith("w1", { kind: "avd", value: "Pixel_8" });
  });

  it("clears the manual choice with Automatic", async () => {
    // FR-007a
    getDevice.mockResolvedValue({ kind: "serial", value: "R5" });
    await render();
    expect(picker().value).toBe("serial:R5");
    await act(async () => {
      picker().value = "";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setDevice).toHaveBeenCalledWith("w1", null);
  });

  it("shows a placeholder for a stored choice whose device is absent", async () => {
    // FR-007a
    getDevice.mockResolvedValue({ kind: "avd", value: "Gone_AVD" });
    await render();
    expect(picker().value).toBe("avd:Gone_AVD");
    expect(picker().selectedOptions[0].textContent).toBe("adb_device_missing|Gone_AVD");
  });

  it("rolls back the choice when the service rejects", async () => {
    // FR-007a
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getDevice.mockResolvedValue({ kind: "serial", value: "R5" });
    setDevice.mockRejectedValue(new Error("boom"));
    await render();
    await act(async () => {
      picker().value = "avd:Pixel_8";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(picker().value).toBe("serial:R5");
    spy.mockRestore();
  });

  it("does not let a stale initial read overwrite an earlier choice", async () => {
    // FR-007a
    let resolveRead!: (k: null) => void;
    getDevice.mockReturnValue(new Promise((r) => (resolveRead = r)));
    await render();
    await act(async () => {
      picker().value = "serial:R5";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => resolveRead(null));
    expect(picker().value).toBe("serial:R5");
  });

  it("only lets ready devices be selected", async () => {
    // FR-007a
    await render();
    const options = Array.from(picker().options);
    expect(options.find((o) => o.value === "serial:R5")?.disabled).toBe(false);
    expect(options.find((o) => o.value === "serial:emulator-5556")?.disabled).toBe(true);
  });

  it("logs a service error instead of throwing", async () => {
    // FR-007a
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDevice.mockRejectedValue(new Error("boom"));
    await render();
    await act(async () => {
      picker().value = "serial:R5";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("AdbPanel workspace switching", () => {
  it("shows the device of the selected workspace", async () => {
    // FR-002, FR-003
    setSession("w1", { kind: "streaming", device: device("A1"), source: "manual" });
    setSession("w2", { kind: "streaming", device: device("B2"), source: "only_device" });
    await render();
    expect(container.querySelector("[class*=deviceName]")?.textContent).toBe("A1");
    await select("w2");
    expect(container.querySelector("[class*=deviceName]")?.textContent).toBe("B2");
    expect(getDevice).toHaveBeenCalledWith("w2");
  });
});

describe("AdbPanel search", () => {
  const chatSearch = vi.fn();
  beforeEach(() => {
    window.addEventListener("keydown", chatSearch);
    setSession("w1", { kind: "streaming", device: device("A1"), source: "manual" });
    adbLogBuffer.append(
      "w1",
      [
        { ts: null, pid: 1, tid: 1, level: "i", tag: "T", message: "hello" },
        { ts: null, pid: 1, tid: 1, level: "i", tag: "T", message: "world" },
      ],
      false,
    );
  });
  afterEach(() => {
    window.removeEventListener("keydown", chatSearch);
    chatSearch.mockClear();
  });

  it("opens the panel search on mod+f and does not reach the chat search", async () => {
    // FR-006c
    await render();
    const event = pressModF(panel());
    expect(event.defaultPrevented).toBe(true);
    expect(chatSearch).not.toHaveBeenCalled();
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("adb_search_placeholder");
  });

  it("closes the search with Escape without leaking the key", async () => {
    // FR-006c
    await render();
    pressModF(panel());
    chatSearch.mockClear();
    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector("input")).toBeNull();
    expect(chatSearch).not.toHaveBeenCalled();
  });

  function typeQuery(value: string) {
    const input = container.querySelector("input") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    return act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function key(k: string, shiftKey = false) {
    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
    });
  }
  const log = () => container.querySelector('[data-testid="log"]') as HTMLElement;

  async function openWithFoo() {
    adbLogBuffer.clear("w1");
    adbLogBuffer.append(
      "w1",
      ["foo a", "bar", "foo b"].map((message) => ({
        ts: null,
        pid: 1,
        tid: 1,
        level: "i" as const,
        tag: "T",
        message,
      })),
      false,
    );
    await render();
    pressModF(panel());
    await typeQuery("foo");
  }

  it("highlights matches and reveals the first one while typing", async () => {
    // FR-006c
    await openWithFoo();
    expect(log().dataset.highlight).toBe("0,2");
    expect(log().dataset.reveal).toMatch(/^0:/);
  });

  it("Enter goes to the next match and wraps, Shift+Enter goes back", async () => {
    // FR-006c
    await openWithFoo();
    key("Enter");
    expect(log().dataset.reveal).toMatch(/^2:/);
    key("Enter");
    expect(log().dataset.reveal).toMatch(/^0:/);
    key("Enter", true);
    expect(log().dataset.reveal).toMatch(/^2:/);
    key("Enter", true);
    expect(log().dataset.reveal).toMatch(/^0:/);
  });

  it("Enter re-reveals the current match with a new tick", async () => {
    // FR-006c
    await openWithFoo();
    await typeQuery("bar");
    const before = log().dataset.reveal;
    key("Enter");
    expect(log().dataset.reveal).toMatch(/^1:/);
    expect(log().dataset.reveal).not.toBe(before);
  });

  it("Escape gives focus back to the panel", async () => {
    // FR-006c
    await openWithFoo();
    key("Escape");
    expect(document.activeElement).toBe(panel());
  });

  it("mod+f with the search already open focuses the input", async () => {
    // FR-006c
    await openWithFoo();
    act(() => panel().focus());
    expect(document.activeElement).toBe(panel());
    pressModF(panel());
    expect(document.activeElement).toBe(container.querySelector("input"));
  });
});
