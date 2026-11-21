import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AdbDevice,
  AdbDevicesChangedPayload,
  AdbLogcatLinesPayload,
  AdbSessionStatus,
  AdbSessionStatusPayload,
  DeviceKey,
} from "../types/adb";

export function adbGetAndroidMode(repoId: string): Promise<boolean> {
  return invoke("adb_get_android_mode", { repoId });
}

export function adbSetAndroidMode(
  repoId: string,
  enabled: boolean,
): Promise<void> {
  return invoke("adb_set_android_mode", { repoId, enabled });
}

export function adbOpenSession(workspaceId: string): Promise<AdbSessionStatus> {
  return invoke("adb_open_session", { workspaceId });
}

export function adbCloseSession(workspaceId: string): Promise<void> {
  return invoke("adb_close_session", { workspaceId });
}

export function adbListDevices(): Promise<AdbDevice[]> {
  return invoke("adb_list_devices");
}

export function adbSetWorkspaceDevice(
  workspaceId: string,
  key: DeviceKey | null,
): Promise<AdbSessionStatus> {
  return invoke("adb_set_workspace_device", { workspaceId, key });
}

export function adbGetWorkspaceDevice(
  workspaceId: string,
): Promise<DeviceKey | null> {
  return invoke("adb_get_workspace_device", { workspaceId });
}

export function listenAdbLogcatLines(
  handler: (payload: AdbLogcatLinesPayload) => void,
): Promise<UnlistenFn> {
  return listen<AdbLogcatLinesPayload>("adb-logcat-lines", (e) =>
    handler(e.payload),
  );
}

export function listenAdbSessionStatus(
  handler: (payload: AdbSessionStatusPayload) => void,
): Promise<UnlistenFn> {
  return listen<AdbSessionStatusPayload>("adb-session-status", (e) =>
    handler(e.payload),
  );
}

export function listenAdbDevicesChanged(
  handler: (payload: AdbDevicesChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<AdbDevicesChangedPayload>("adb-devices-changed", (e) =>
    handler(e.payload),
  );
}
