//! Access to `adb` and git for the sessions; faked in tests.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

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

/// The real runner: shells out to the `adb` found by `locate_adb`.
pub struct ProcessAdbRunner {
    adb: PathBuf,
}

impl ProcessAdbRunner {
    pub fn new(adb: PathBuf) -> Self {
        Self { adb }
    }

    async fn output(&self, args: &[&str]) -> io::Result<std::process::Output> {
        let mut cmd = crate::process::command(&self.adb);
        cmd.args(args);
        crate::env::enriched_env().apply(&mut cmd);
        cmd.stdin(Stdio::null()).kill_on_drop(true);
        cmd.output().await
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
