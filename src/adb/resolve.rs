use crate::model::{AdbDevice, AdbDeviceState, DeviceKey, Resolution, ResolutionSource};

/// Pick the device a workspace's logcat session should follow.
///
/// Order: manual choice, then the dedicated emulator when it is running and ready, then the only
/// ready device, then a choice between several ready devices. A manual choice never falls back to
/// another device. `kept` is the device chosen automatically earlier (dedicated emulator or only
/// ready device): it is kept while it is ready, even when another ready device connects (FR-007e),
/// and waited for when it is gone, whatever else is ready (FR-007f). Only the manual choice and a
/// ready dedicated emulator beat it.
pub fn resolve_device(
    manual: Option<&DeviceKey>,
    dedicated_avd: Option<&str>,
    kept: Option<&DeviceKey>,
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

    if let Some(key) = kept {
        return match ready.iter().find(|device| matches_key(device, key)) {
            Some(device) => Resolution::Device {
                serial: device.serial.clone(),
                source: ResolutionSource::OnlyDevice,
            },
            None => Resolution::Unavailable {
                key: key.clone(),
                source: ResolutionSource::OnlyDevice,
            },
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

    fn serial(serial: &str) -> DeviceKey {
        DeviceKey::Serial(serial.into())
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
            resolve_device(Some(&manual), Some("task-demo-feat-a"), None, &devices),
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
            resolve_device(Some(&manual), None, None, &devices),
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
            resolve_device(None, Some("task-demo-feat-a"), None, &devices),
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
            resolve_device(None, Some("task-demo-feat-a"), None, &devices),
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
            resolve_device(None, None, None, &devices),
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
            resolve_device(None, None, None, &devices),
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
            resolve_device(None, None, None, &devices),
            Resolution::NeedsChoice
        );
    }

    // FR-005
    #[test]
    fn resolve_no_device() {
        assert_eq!(resolve_device(None, None, None, &[]), Resolution::NoDevice);
    }

    // FR-007c
    #[test]
    fn resolve_manual_unauthorized_is_unavailable() {
        let devices = [device("R58M12345", AdbDeviceState::Unauthorized, None)];
        let manual = DeviceKey::Serial("R58M12345".into());
        assert_eq!(
            resolve_device(Some(&manual), None, None, &devices),
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
            resolve_device(None, None, None, &devices),
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
        assert_eq!(
            resolve_device(None, None, None, &devices),
            Resolution::NoDevice
        );
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
            resolve_device(Some(&manual), None, None, &devices),
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
        assert_eq!(
            resolve_device(None, None, None, &devices),
            Resolution::NoDevice
        );
    }

    // FR-007e
    #[test]
    fn resolve_keeps_current_when_second_ready_device_connects() {
        let devices = [
            device("R58M12345", AdbDeviceState::Device, None),
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
        ];
        assert_eq!(
            resolve_device(None, None, Some(&serial("R58M12345")), &devices),
            Resolution::Device {
                serial: "R58M12345".into(),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007f
    #[test]
    fn resolve_waits_for_gone_device_when_several_others_remain() {
        let devices = [
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
            device("emulator-5556", AdbDeviceState::Device, None),
        ];
        assert_eq!(
            resolve_device(None, None, Some(&serial("R58M12345")), &devices),
            Resolution::Unavailable {
                key: serial("R58M12345"),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007f (un seul appareil prêt restant : pas de bascule)
    #[test]
    fn resolve_waits_for_gone_device_when_one_other_remains() {
        let devices = [device("emulator-5554", AdbDeviceState::Device, None)];
        assert_eq!(
            resolve_device(None, None, Some(&serial("R58M12345")), &devices),
            Resolution::Unavailable {
                key: serial("R58M12345"),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007f (un appareil kept non autorisé est attendu)
    #[test]
    fn resolve_waits_for_kept_device_that_is_not_ready() {
        let devices = [device("R58M12345", AdbDeviceState::Unauthorized, None)];
        assert_eq!(
            resolve_device(None, None, Some(&serial("R58M12345")), &devices),
            Resolution::Unavailable {
                key: serial("R58M12345"),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007f / FR-009 (reprise au retour, un émulateur est identifié par son AVD)
    #[test]
    fn resolve_resumes_kept_emulator_on_return_with_new_serial() {
        let devices = [
            device("emulator-5556", AdbDeviceState::Device, Some("Pixel_8")),
            device("R58M12345", AdbDeviceState::Device, None),
        ];
        assert_eq!(
            resolve_device(
                None,
                None,
                Some(&DeviceKey::Avd("Pixel_8".into())),
                &devices
            ),
            Resolution::Device {
                serial: "emulator-5556".into(),
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007f (un émulateur dédié attendu reste attendu)
    #[test]
    fn resolve_keeps_waiting_for_gone_dedicated_emulator() {
        let devices = [device("R58M12345", AdbDeviceState::Device, None)];
        let dedicated = DeviceKey::Avd("task-demo-feat-a".into());
        assert_eq!(
            resolve_device(None, Some("task-demo-feat-a"), Some(&dedicated), &devices),
            Resolution::Unavailable {
                key: dedicated,
                source: ResolutionSource::OnlyDevice,
            }
        );
    }

    // FR-007e
    #[test]
    fn resolve_dedicated_beats_current() {
        let devices = [
            device("R58M12345", AdbDeviceState::Device, None),
            device(
                "emulator-5556",
                AdbDeviceState::Device,
                Some("task-demo-feat-a"),
            ),
        ];
        assert_eq!(
            resolve_device(
                None,
                Some("task-demo-feat-a"),
                Some(&serial("R58M12345")),
                &devices
            ),
            Resolution::Device {
                serial: "emulator-5556".into(),
                source: ResolutionSource::DedicatedEmulator,
            }
        );
    }

    // FR-007f
    #[test]
    fn resolve_manual_beats_waited_device() {
        let devices = [device("emulator-5554", AdbDeviceState::Device, None)];
        let manual = serial("emulator-5554");
        assert_eq!(
            resolve_device(Some(&manual), None, Some(&serial("R58M12345")), &devices),
            Resolution::Device {
                serial: "emulator-5554".into(),
                source: ResolutionSource::Manual,
            }
        );
    }

    // FR-007e
    #[test]
    fn resolve_manual_beats_current() {
        let devices = [
            device("R58M12345", AdbDeviceState::Device, None),
            device("emulator-5554", AdbDeviceState::Device, Some("Pixel_8")),
        ];
        let manual = DeviceKey::Avd("Pixel_8".into());
        assert_eq!(
            resolve_device(Some(&manual), None, Some(&serial("R58M12345")), &devices),
            Resolution::Device {
                serial: "emulator-5554".into(),
                source: ResolutionSource::Manual,
            }
        );
    }
}
