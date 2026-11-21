import type { StateCreator } from "zustand";
import { adbGetAndroidMode } from "../../services/adb";
import type { AdbDevice, AdbSessionStatus } from "../../types/adb";
import type { AppState } from "../useAppStore";

export const ADB_PANEL_DEFAULT_WIDTH = 480;
export const ADB_PANEL_MIN_WIDTH = 240;
export const ADB_PANEL_MAX_WIDTH = 1200;

export interface AdbSlice {
  adbPanelVisible: boolean;
  adbPanelWidth: number;
  adbSessions: Record<string, AdbSessionStatus>;
  adbDevices: AdbDevice[];
  /** Bumped per workspace whenever its (out-of-store) log buffer changes. */
  adbLogVersion: Record<string, number>;
  androidModeByRepo: Record<string, boolean>;
  toggleAdbPanel: () => void;
  setAdbPanelWidth: (width: number) => void;
  setAdbSessionStatus: (workspaceId: string, status: AdbSessionStatus) => void;
  setAdbDevices: (devices: AdbDevice[]) => void;
  bumpAdbLogVersion: (workspaceId: string) => void;
  setAndroidMode: (repoId: string, enabled: boolean) => void;
  loadAndroidMode: (repoId: string) => Promise<void>;
}

export const createAdbSlice: StateCreator<AppState, [], [], AdbSlice> = (
  set,
) => ({
  adbPanelVisible: false,
  adbPanelWidth: ADB_PANEL_DEFAULT_WIDTH,
  adbSessions: {},
  adbDevices: [],
  adbLogVersion: {},
  androidModeByRepo: {},
  toggleAdbPanel: () => set((s) => ({ adbPanelVisible: !s.adbPanelVisible })),
  setAdbPanelWidth: (width) =>
    set({
      adbPanelWidth: Math.min(
        ADB_PANEL_MAX_WIDTH,
        Math.max(ADB_PANEL_MIN_WIDTH, width),
      ),
    }),
  setAdbSessionStatus: (workspaceId, status) =>
    set((s) => ({ adbSessions: { ...s.adbSessions, [workspaceId]: status } })),
  setAdbDevices: (devices) => set({ adbDevices: devices }),
  bumpAdbLogVersion: (workspaceId) =>
    set((s) => ({
      adbLogVersion: {
        ...s.adbLogVersion,
        [workspaceId]: (s.adbLogVersion[workspaceId] ?? 0) + 1,
      },
    })),
  setAndroidMode: (repoId, enabled) =>
    set((s) => ({
      androidModeByRepo: { ...s.androidModeByRepo, [repoId]: enabled },
    })),
  loadAndroidMode: async (repoId) => {
    const enabled = await adbGetAndroidMode(repoId);
    set((s) => ({
      androidModeByRepo: { ...s.androidModeByRepo, [repoId]: enabled },
    }));
  },
});
