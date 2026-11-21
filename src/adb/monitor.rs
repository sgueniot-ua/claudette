//! Device monitor: polls `adb devices -l` while at least one session exists (R4).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;
use tokio::time::{Instant, MissedTickBehavior, interval_at};

use super::devices::parse_devices;
use super::session::{AdbRunner, AdbSink};
use crate::model::{AdbDevice, AdbDeviceState};

/// Interval between two `adb devices -l` polls (R4).
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Latest device list, `None` until the first poll of the current monitor run.
pub(crate) type DeviceList = Option<Arc<Vec<AdbDevice>>>;

/// Poll forever (the owner aborts the task when the last session stops). Every poll publishes the
/// list to the sessions, even unchanged, so a session waiting for a retry gets its tick; the sink
/// hears about the list only when it changed.
pub(crate) async fn run(
    runner: Arc<dyn AdbRunner>,
    sink: Arc<dyn AdbSink>,
    devices_tx: Arc<watch::Sender<DeviceList>>,
) {
    let mut avd_names: HashMap<String, String> = HashMap::new();
    let mut last: Option<Vec<AdbDevice>> = None;
    let mut ticker = interval_at(Instant::now(), POLL_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let devices = match runner.devices().await {
            Ok(output) => {
                let mut devices = parse_devices(&output);
                fill_avd_names(runner.as_ref(), &mut devices, &mut avd_names).await;
                devices
            }
            // A failed poll keeps the last list; before any list, sessions see no device.
            Err(_) => last.clone().unwrap_or_default(),
        };
        if last.as_ref() != Some(&devices) {
            sink.devices(&devices);
            last = Some(devices.clone());
        }
        devices_tx.send_replace(Some(Arc::new(devices)));
    }
}

/// Fill `avd_name` of ready emulators, from the cache or `emu avd name`. Successes are cached per
/// serial until the serial leaves the list; a failure leaves `None` and is retried next poll.
async fn fill_avd_names(
    runner: &dyn AdbRunner,
    devices: &mut [AdbDevice],
    cache: &mut HashMap<String, String>,
) {
    cache.retain(|serial, _| devices.iter().any(|device| device.serial == *serial));
    for device in devices.iter_mut() {
        if !device.serial.starts_with("emulator-") || device.state != AdbDeviceState::Device {
            continue;
        }
        if let Some(name) = cache.get(&device.serial) {
            device.avd_name = Some(name.clone());
        } else if let Some(name) = runner.avd_name(&device.serial).await {
            cache.insert(device.serial.clone(), name.clone());
            device.avd_name = Some(name);
        }
    }
}

/// Parse the output of `adb -s <serial> emu avd name`: the name, then an `OK` line.
pub fn parse_avd_name(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .filter(|line| *line != "OK" && !line.starts_with("KO"))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    // R4 (nom d'AVD lu par `emu avd name`)
    #[test]
    fn avd_name_is_first_line_before_ok() {
        assert_eq!(
            parse_avd_name("Pixel_8\r\nOK\r\n").as_deref(),
            Some("Pixel_8")
        );
    }

    // R4 (échec → avd_name = None)
    #[test]
    fn avd_name_absent_or_error_is_none() {
        assert_eq!(parse_avd_name("OK\r\n"), None);
        assert_eq!(parse_avd_name(""), None);
        assert_eq!(parse_avd_name("KO: unknown command\r\n"), None);
    }
}
