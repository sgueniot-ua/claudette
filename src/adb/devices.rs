use crate::model::{AdbDevice, AdbDeviceState};

/// Parse the output of `adb devices -l`. The header, daemon notices (`*`) and blank lines are skipped.
pub fn parse_devices(output: &str) -> Vec<AdbDevice> {
    output.lines().filter_map(parse_device_line).collect()
}

fn parse_device_line(line: &str) -> Option<AdbDevice> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('*') || line.starts_with("List of devices") {
        return None;
    }
    let mut tokens = line.split_whitespace();
    let serial = tokens.next()?;
    let state = tokens.next()?;
    let model = tokens
        .find_map(|token| token.strip_prefix("model:"))
        .map(|value| value.replace('_', " "));
    Some(AdbDevice {
        serial: serial.to_string(),
        state: parse_state(state),
        model,
        avd_name: None,
    })
}

fn parse_state(state: &str) -> AdbDeviceState {
    match state {
        "device" => AdbDeviceState::Device,
        "offline" => AdbDeviceState::Offline,
        "unauthorized" => AdbDeviceState::Unauthorized,
        other => AdbDeviceState::Other(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // FR-005
    #[test]
    fn parse_devices_ignores_header_daemon_noise_and_blank_lines() {
        let out = "* daemon not running; starting now at tcp:5037\r\n* daemon started successfully\r\nList of devices attached\r\nemulator-5560\tdevice product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\r\nR58M12345\tunauthorized usb:1-1 transport_id:2\r\n\r\n";
        let d = parse_devices(out);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].serial, "emulator-5560");
        assert_eq!(d[0].state, AdbDeviceState::Device);
        assert_eq!(d[0].model.as_deref(), Some("sdk gphone64 arm64"));
        assert_eq!(d[0].avd_name, None);
        assert_eq!(d[1].serial, "R58M12345");
        assert_eq!(d[1].state, AdbDeviceState::Unauthorized);
        assert_eq!(d[1].model, None);
    }

    // FR-005
    #[test]
    fn parse_devices_maps_offline_and_unknown_states() {
        let out = "List of devices attached\nabc\toffline\nxyz\trecovery\n";
        let d = parse_devices(out);
        assert_eq!(d[0].state, AdbDeviceState::Offline);
        assert_eq!(d[1].state, AdbDeviceState::Other("recovery".into()));
    }

    // FR-005
    #[test]
    fn parse_devices_empty_output_yields_no_devices() {
        assert!(parse_devices("List of devices attached\n\n").is_empty());
    }
}
