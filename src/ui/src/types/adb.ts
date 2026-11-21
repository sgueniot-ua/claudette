// Mirrors `LogLevel` / `LogcatLine` in src/model/adb.rs. LogLevel is
// `#[serde(rename_all = "snake_case")]`, so the wire values are lowercase
// ("v" .. "a"), and the Option fields serialize as null.
export type LogLevel = "v" | "d" | "i" | "w" | "e" | "f" | "a";

export interface LogcatLine {
  ts: string | null;
  pid: number | null;
  tid: number | null;
  level: LogLevel | null;
  tag: string | null;
  message: string;
}

// Mirrors the remaining types in src/model/adb.rs. Enums with newtype variants
// (`AdbDeviceState`, `DeviceKey`) are adjacently tagged `{ kind, value }`; the
// other data enums are internally tagged by `kind`; unit enums are snake_case
// strings.
export type AdbDeviceState =
  | { kind: "device" }
  | { kind: "offline" }
  | { kind: "unauthorized" }
  | { kind: "other"; value: string };

export interface AdbDevice {
  serial: string;
  state: AdbDeviceState;
  model: string | null;
  avd_name: string | null;
}

export type DeviceKey =
  | { kind: "avd"; value: string }
  | { kind: "serial"; value: string };

export type ResolutionSource = "manual" | "dedicated_emulator" | "only_device";

export type Resolution =
  | { kind: "device"; serial: string; source: ResolutionSource }
  | { kind: "unavailable"; key: DeviceKey; source: ResolutionSource }
  | { kind: "needs_choice" }
  | { kind: "no_device" };

export type WaitReason = "disconnected" | "unauthorized";

export type AdbSessionStatus =
  | { kind: "adb_missing" }
  | { kind: "no_device" }
  | { kind: "needs_choice" }
  | { kind: "waiting"; device: DeviceKey; reason: WaitReason }
  | { kind: "streaming"; device: AdbDevice; source: ResolutionSource }
  | { kind: "stopped" };

// Event payloads (field names are snake_case as serialized by Rust).
export interface AdbLogcatLinesPayload {
  workspace_id: string;
  lines: LogcatLine[];
  reset: boolean;
}

export interface AdbSessionStatusPayload {
  workspace_id: string;
  status: AdbSessionStatus;
}

export interface AdbDevicesChangedPayload {
  devices: AdbDevice[];
}
