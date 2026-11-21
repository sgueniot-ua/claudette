import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adbGetAndroidMode: vi.fn() }));

vi.mock("../../services/adb", () => ({
  adbGetAndroidMode: mocks.adbGetAndroidMode,
}));

import type { AdbSessionStatus } from "../../types/adb";
import { useAppStore } from "../useAppStore";

describe("adbSlice", () => {
  beforeEach(() => {
    mocks.adbGetAndroidMode.mockReset();
    useAppStore.setState({
      adbPanelVisible: false,
      adbPanelWidth: 480,
      adbSessions: {},
      adbDevices: [],
      adbLogVersion: {},
      androidModeByRepo: {},
      terminalPanelVisible: false,
      terminalTabs: {},
    });
  });

  // FR-010
  it("toggleAdbPanel leaves terminal state untouched", () => {
    const tabs = { w1: [] };
    useAppStore.setState({ terminalPanelVisible: true, terminalTabs: tabs });
    useAppStore.getState().toggleAdbPanel();
    expect(useAppStore.getState().adbPanelVisible).toBe(true);
    expect(useAppStore.getState().terminalPanelVisible).toBe(true);
    expect(useAppStore.getState().terminalTabs).toBe(tabs);
    useAppStore.getState().toggleAdbPanel();
    expect(useAppStore.getState().adbPanelVisible).toBe(false);
    expect(useAppStore.getState().terminalPanelVisible).toBe(true);
    expect(useAppStore.getState().terminalTabs).toBe(tabs);
  });

  // FR-002
  it("clamps the panel width to 240..1200", () => {
    expect(useAppStore.getState().adbPanelWidth).toBe(480);
    useAppStore.getState().setAdbPanelWidth(100);
    expect(useAppStore.getState().adbPanelWidth).toBe(240);
    useAppStore.getState().setAdbPanelWidth(5000);
    expect(useAppStore.getState().adbPanelWidth).toBe(1200);
    useAppStore.getState().setAdbPanelWidth(600);
    expect(useAppStore.getState().adbPanelWidth).toBe(600);
  });

  // FR-004
  it("keeps session status per workspace", () => {
    const streaming: AdbSessionStatus = { kind: "needs_choice" };
    useAppStore.getState().setAdbSessionStatus("w1", streaming);
    useAppStore.getState().setAdbSessionStatus("w2", { kind: "stopped" });
    expect(useAppStore.getState().adbSessions).toEqual({
      w1: { kind: "needs_choice" },
      w2: { kind: "stopped" },
    });
  });

  // FR-006
  it("bumps the log version per workspace", () => {
    useAppStore.getState().bumpAdbLogVersion("w1");
    useAppStore.getState().bumpAdbLogVersion("w1");
    useAppStore.getState().bumpAdbLogVersion("w2");
    expect(useAppStore.getState().adbLogVersion).toEqual({ w1: 2, w2: 1 });
  });

  // FR-001a
  it("tracks android mode per repo and loads it from the backend", async () => {
    mocks.adbGetAndroidMode.mockResolvedValue(true);
    await useAppStore.getState().loadAndroidMode("r1");
    expect(mocks.adbGetAndroidMode).toHaveBeenCalledWith("r1");
    expect(useAppStore.getState().androidModeByRepo).toEqual({ r1: true });
    useAppStore.getState().setAndroidMode("r1", false);
    expect(useAppStore.getState().androidModeByRepo).toEqual({ r1: false });
  });
});
