use serde::{Deserialize, Serialize};

/// A device as seen by `adb devices -l`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdbDevice {
    pub serial: String,
    pub state: AdbDeviceState,
    pub model: Option<String>,
    pub avd_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum AdbDeviceState {
    Device,
    Offline,
    Unauthorized,
    Other(String),
}

/// Stable identity of a manually chosen device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DeviceKey {
    Avd(String),
    Serial(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionSource {
    Manual,
    DedicatedEmulator,
    OnlyDevice,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Resolution {
    Device {
        serial: String,
        source: ResolutionSource,
    },
    Unavailable {
        key: DeviceKey,
        source: ResolutionSource,
    },
    NeedsChoice,
    NoDevice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    V,
    D,
    I,
    W,
    E,
    F,
    A,
}

/// One parsed line of logcat `threadtime` output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogcatLine {
    pub ts: Option<String>,
    pub pid: Option<u32>,
    pub tid: Option<u32>,
    pub level: Option<LogLevel>,
    pub tag: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitReason {
    Disconnected,
    Unauthorized,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdbSessionStatus {
    AdbMissing,
    NoDevice,
    NeedsChoice,
    Waiting {
        device: DeviceKey,
        reason: WaitReason,
    },
    Streaming {
        device: String,
        source: ResolutionSource,
    },
    Stopped,
}
