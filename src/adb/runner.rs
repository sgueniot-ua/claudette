//! Access to `adb` and git for the sessions; faked in tests.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use super::logcat::{LogcatStream, TailFrom};

/// Everything a session needs from `adb` and git. Faked in tests.
// async_trait's expansion marks the boxed futures `#[must_use]`, which newer
// clippy flags as `double_must_use` on the generated trait methods.
#[allow(clippy::double_must_use)]
#[async_trait::async_trait]
pub trait AdbRunner: Send + Sync {
    /// Raw output of `adb devices -l`.
    async fn devices(&self) -> io::Result<String>;
    /// AVD name of an emulator (`emu avd name`), `None` on failure.
    async fn avd_name(&self, serial: &str) -> Option<String>;
    /// Start `adb -s <serial> logcat -v threadtime -T <tail>`.
    fn spawn_logcat(&self, serial: &str, tail: &TailFrom) -> io::Result<Box<dyn LogcatStream>>;
    /// Dedicated emulator of the branch checked out in `worktree`, read at each resolution (FR-007d).
    async fn dedicated_avd(&self, worktree: &Path) -> Option<String>;
}

/// Longest an `adb devices` or `adb emu avd name` call may take; a call that runs longer is
/// killed and counts as failed, so a wedged adb server or emulator cannot freeze the shared poll.
pub const ADB_CALL_TIMEOUT: Duration = Duration::from_secs(5);

/// The real runner: shells out to the `adb` found by `locate_adb`.
pub struct ProcessAdbRunner {
    adb: PathBuf,
    timeout: Duration,
}

impl ProcessAdbRunner {
    pub fn new(adb: PathBuf) -> Self {
        Self {
            adb,
            timeout: ADB_CALL_TIMEOUT,
        }
    }

    async fn output(&self, args: &[&str]) -> io::Result<std::process::Output> {
        let mut cmd = crate::process::command(&self.adb);
        cmd.args(args);
        crate::env::enriched_env().apply(&mut cmd);
        cmd.stdin(Stdio::null()).kill_on_drop(true);
        match tokio::time::timeout(self.timeout, cmd.output()).await {
            Ok(output) => output,
            Err(_) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("adb {} timed out", args.join(" ")),
            )),
        }
    }
}

#[async_trait::async_trait]
impl AdbRunner for ProcessAdbRunner {
    async fn devices(&self) -> io::Result<String> {
        let out = self.output(&["devices", "-l"]).await?;
        if !out.status.success() {
            return Err(io::Error::other(format!(
                "adb devices failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    async fn avd_name(&self, serial: &str) -> Option<String> {
        let out = self
            .output(&["-s", serial, "emu", "avd", "name"])
            .await
            .ok()?;
        if !out.status.success() {
            return None;
        }
        super::monitor::parse_avd_name(&String::from_utf8_lossy(&out.stdout))
    }

    fn spawn_logcat(&self, serial: &str, tail: &TailFrom) -> io::Result<Box<dyn LogcatStream>> {
        super::logcat::spawn_logcat(&self.adb, serial, tail)
    }

    async fn dedicated_avd(&self, worktree: &Path) -> Option<String> {
        super::naming::dedicated_avd_for_worktree(worktree).await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    /// An `adb` that never answers.
    fn hanging_adb(dir: &Path) -> PathBuf {
        let path = dir.join("adb");
        std::fs::write(&path, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    // FR-008 (un appel adb bloqué échoue au lieu de figer le sondage)
    #[tokio::test]
    async fn hanging_devices_call_times_out() {
        let dir = tempfile::tempdir().unwrap();
        let mut runner = ProcessAdbRunner::new(hanging_adb(dir.path()));
        runner.timeout = Duration::from_millis(100);
        let err = runner.devices().await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
    }

    // FR-008
    #[tokio::test]
    async fn hanging_avd_name_call_times_out_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let mut runner = ProcessAdbRunner::new(hanging_adb(dir.path()));
        runner.timeout = Duration::from_millis(100);
        assert_eq!(runner.avd_name("emulator-5554").await, None);
    }
}
