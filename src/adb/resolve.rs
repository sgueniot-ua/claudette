use crate::model::{AdbDevice, AdbDeviceState, DeviceKey, Resolution, ResolutionSource};

/// Pick the device a workspace's logcat session should follow.
///
/// Order: manual choice, then the dedicated emulator when it is running and ready, then the only
/// ready device, then a choice between several ready devices. A manual choice never falls back to
/// another device.
pub fn resolve_device(
    manual: Option<&DeviceKey>,
    dedicated_avd: Option<&str>,
    devices: &[AdbDevice],
) -> Resolution {
    let ready: Vec<&AdbDevice> = devices
        .iter()
        .filter(|device| device.state == AdbDeviceState::Device)
        .collect();

    if let Some(key) = manual {
        return match ready.iter().find(|device| matches_key(device, key)) {
            Some(device) => Resolution::Device {
                serial: device.serial.clone(),
                source: ResolutionSource::Manual,
            },
            None => Resolution::Unavailable {
                key: key.clone(),
                source: ResolutionSource::Manual,
            },
        };
    }

    if let Some(avd) = dedicated_avd
        && let Some(device) = ready
            .iter()
            .find(|device| device.avd_name.as_deref() == Some(avd))
    {
        return Resolution::Device {
            serial: device.serial.clone(),
            source: ResolutionSource::DedicatedEmulator,
        };
    }

    match ready.as_slice() {
        [only] => Resolution::Device {
            serial: only.serial.clone(),
            source: ResolutionSource::OnlyDevice,
        },
        [] => {
            let unauthorized: Vec<&AdbDevice> = devices
                .iter()
                .filter(|device| device.state == AdbDeviceState::Unauthorized)
                .collect();
            match unauthorized.as_slice() {
                [only] => Resolution::Unavailable {
                    key: DeviceKey::Serial(only.serial.clone()),
                    source: ResolutionSource::OnlyDevice,
                },
                _ => Resolution::NoDevice,
            }
        }
        _ => Resolution::NeedsChoice,
    }
}

pub(crate) fn matches_key(device: &AdbDevice, key: &DeviceKey) -> bool {
    match key {
        DeviceKey::Avd(name) => device.avd_name.as_deref() == Some(name.as_str()),
        DeviceKey::Serial(serial) => device.serial == *serial,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(serial: &str, state: AdbDeviceState, avd_name: Option<&str>) -> AdbDevice {
        AdbDevice {
            serial: serial.into(),
            state,
            model: None,
            avd_name: avd_name.map(Into::into),
        }
    }

    // FR-007
    #[test]
    fn resolve_manual_wins_over_dedicated() {
        let devices = [
            device(
                "emulator-5554",
                AdbDeviceState::Device,
                Some("task-demo-feat-a"),
            ),
            device("R58M12345", AdbDeviceState::Device, None),
        ];
        let manual = DeviceKey::Serial("R58M12345".into());
        assert_eq!(
            resolve_device(Some(&manual), Some("task-demo-feat-a"), &devices),
            Resolution::Device {
                serial: "R58M12345".into(),
                source: ResolutionSource::Manual,
            }
        );
    }

    // FR-007c
    #[test]
    fn resolve_manual_missing_is_unavailable_even_with_other_devices() {
        let devices = [device("R58M12345", AdbDeviceState::Device, None)];
        let manual = DeviceKey::Avd("Pixel_8".into());
        assert_eq!(
            resolve_device(Some(&manual), None, &devices),
            Resolution::Unavailable {
                key: DeviceKey::Avd("Pixel_8".into()),
                source: ResolutionSource::Manual,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_dedicated_when_running_among_others() {
        let devices = [
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
            device(
                "emulator-5556",
                AdbDeviceState::Device,
                Some("task-demo-feat-a"),
            ),
        ];
        assert_eq!(
            resolve_device(None, Some("task-demo-feat-a"), &devices),
            Resolution::Device {
                serial: "emulator-5556".into(),
                source: ResolutionSource::DedicatedEmulator,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_dedicated_ignored_when_not_ready() {
        let devices = [
            device(
                "emulator-5556",
                AdbDeviceState::Offline,
                Some("task-demo-feat-a"),
            ),
            device("R58M12345", AdbDeviceState::Device, None),
        ];
        assert_eq!(
            resolve_device(None, Some("task-demo-feat-a"), &devices),
            Resolution::Device {
                serial: "R58M12345".into(),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_only_ready_device() {
        let devices = [device("R58M12345", AdbDeviceState::Device, None)];
        assert_eq!(
            resolve_device(None, None, &devices),
            Resolution::Device {
                serial: "R58M12345".into(),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_unauthorized_not_counted_as_only_device() {
        let devices = [
            device("R58M12345", AdbDeviceState::Device, None),
            device("emulator-5554", AdbDeviceState::Unauthorized, None),
        ];
        assert_eq!(
            resolve_device(None, None, &devices),
            Resolution::Device {
                serial: "R58M12345".into(),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_needs_choice_with_two_ready() {
        let devices = [
            device("R58M12345", AdbDeviceState::Device, None),
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
        ];
        assert_eq!(
            resolve_device(None, None, &devices),
            Resolution::NeedsChoice
        );
    }

    // FR-005
    #[test]
    fn resolve_no_device() {
        assert_eq!(resolve_device(None, None, &[]), Resolution::NoDevice);
    }

    // FR-007c
    #[test]
    fn resolve_manual_unauthorized_is_unavailable() {
        let devices = [device("R58M12345", AdbDeviceState::Unauthorized, None)];
        let manual = DeviceKey::Serial("R58M12345".into());
        assert_eq!(
            resolve_device(Some(&manual), None, &devices),
            Resolution::Unavailable {
                key: DeviceKey::Serial("R58M12345".into()),
                source: ResolutionSource::Manual,
            }
        );
    }

    // FR-005
    #[test]
    fn resolve_single_unauthorized_device_is_unavailable() {
        let devices = [device("R58M12345", AdbDeviceState::Unauthorized, None)];
        assert_eq!(
            resolve_device(None, None, &devices),
            Resolution::Unavailable {
                key: DeviceKey::Serial("R58M12345".into()),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-005
    #[test]
    fn resolve_two_unauthorized_is_no_device() {
        let devices = [
            device("R58M12345", AdbDeviceState::Unauthorized, None),
            device("emulator-5554", AdbDeviceState::Unauthorized, None),
        ];
        assert_eq!(resolve_device(None, None, &devices), Resolution::NoDevice);
    }

    // FR-007
    #[test]
    fn resolve_manual_avd_matches_ready_emulator() {
        let devices = [
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
            device("R58M12345", AdbDeviceState::Device, None),
        ];
        let manual = DeviceKey::Avd("Pixel_8".into());
        assert_eq!(
            resolve_device(Some(&manual), None, &devices),
            Resolution::Device {
                serial: "emulator-5554".into(),
                source: ResolutionSource::Manual,
            }
        );
    }

    // FR-007
    #[test]
    fn resolve_lone_offline_is_no_device() {
        let devices = [device("R58M12345", AdbDeviceState::Offline, None)];
        assert_eq!(resolve_device(None, None, &devices), Resolution::NoDevice);
    }
}
