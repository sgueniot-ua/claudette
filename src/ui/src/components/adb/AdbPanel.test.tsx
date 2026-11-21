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
    // FR-003
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

  it("highlights matches while typing", async () => {
    // FR-006c
    await render();
    pressModF(panel());
    const input = container.querySelector("input") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "wor");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = Array.from(container.querySelectorAll('[data-testid="adb-log-row"]'));
    const highlighted = rows.filter((r) => r.className.includes("highlight"));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toContain("world");
  });
});
