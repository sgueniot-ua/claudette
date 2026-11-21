//! Locate the `adb` executable (FR-008, research R5).

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::env::enriched_path;

/// Environment inputs of the adb lookup, injected so tests never read the real machine.
#[derive(Debug, Clone, Default)]
pub struct LocateEnv {
    pub path: Option<OsString>,
    pub android_home: Option<PathBuf>,
    pub android_sdk_root: Option<PathBuf>,
    pub home: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
}

impl LocateEnv {
    pub fn from_process() -> Self {
        Self {
            path: Some(enriched_path()),
            android_home: std::env::var_os("ANDROID_HOME").map(PathBuf::from),
            android_sdk_root: std::env::var_os("ANDROID_SDK_ROOT").map(PathBuf::from),
            home: dirs::home_dir(),
            local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        }
    }
}

/// Find adb: `sdk.dir` of the worktree's `local.properties`, then the PATH,
/// then `$ANDROID_HOME`, `$ANDROID_SDK_ROOT`, and the OS default SDK directory.
pub fn locate_adb(worktree: Option<&Path>, env: &LocateEnv) -> Option<PathBuf> {
    let name = adb_file_name();
    if let Some(adb) = worktree
        .and_then(sdk_dir_from_local_properties)
        .and_then(|sdk| sdk_adb(&sdk))
    {
        return Some(adb);
    }
    if let Some(adb) = env
        .path
        .as_deref()
        .and_then(|path| find_in_path(path, name))
    {
        return Some(adb);
    }
    [
        env.android_home.clone(),
        env.android_sdk_root.clone(),
        default_sdk_dir(env),
    ]
    .into_iter()
    .flatten()
    .find_map(|sdk| sdk_adb(&sdk))
}

fn adb_file_name() -> &'static str {
    if cfg!(windows) { "adb.exe" } else { "adb" }
}

fn sdk_adb(sdk: &Path) -> Option<PathBuf> {
    let adb = sdk.join("platform-tools").join(adb_file_name());
    adb.is_file().then_some(adb)
}

fn find_in_path(path: &OsStr, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn sdk_dir_from_local_properties(worktree: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(worktree.join("local.properties")).ok()?;
    parse_sdk_dir(&text)
}

/// `sdk.dir` value of a `local.properties` text. Gradle writes Windows paths
/// with `\:` and `\\` escapes, which are unescaped here.
fn parse_sdk_dir(text: &str) -> Option<PathBuf> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "sdk.dir").then(|| PathBuf::from(unescape_properties_value(value.trim())))
    })
}

fn unescape_properties_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\'
            && let Some(next) = chars.next_if(|n| matches!(n, ':' | '\\'))
        {
            out.push(next);
        } else {
            out.push(c);
        }
    }
    out
}

fn default_sdk_dir(env: &LocateEnv) -> Option<PathBuf> {
    if cfg!(windows) {
        env.local_app_data
            .as_ref()
            .map(|dir| dir.join("Android").join("Sdk"))
    } else if cfg!(target_os = "macos") {
        env.home
            .as_ref()
            .map(|home| home.join("Library/Android/sdk"))
    } else {
        env.home.as_ref().map(|home| home.join("Android/Sdk"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adb_in(sdk: &Path) -> PathBuf {
        let dir = sdk.join("platform-tools");
        std::fs::create_dir_all(&dir).unwrap();
        let adb = dir.join(adb_file_name());
        std::fs::write(&adb, b"").unwrap();
        adb
    }

    // FR-008 (R5): local.properties sdk.dir wins over every other source
    #[test]
    fn locate_prefers_local_properties() {
        let tmp = tempfile::tempdir().unwrap();
        let sdk = tmp.path().join("sdk");
        let expected = adb_in(&sdk);
        std::fs::write(
            tmp.path().join("local.properties"),
            format!("# generated\nsdk.dir={}\n", sdk.display()),
        )
        .unwrap();
        let other = tmp.path().join("other-sdk");
        adb_in(&other);

        let env = LocateEnv {
            android_home: Some(other),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(Some(tmp.path()), &env), Some(expected));
    }

    // FR-008 (R5): sdk.dir written by Gradle with escapes is unescaped
    #[test]
    fn locate_unescapes_local_properties_sdk_dir() {
        assert_eq!(
            parse_sdk_dir(r"sdk.dir=C\:\\Android\\sdk"),
            Some(PathBuf::from(r"C:\Android\sdk"))
        );
    }

    // FR-008 (R5): a PATH hit comes before ANDROID_HOME
    #[test]
    fn locate_uses_path_before_android_home() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let on_path = bin.join(adb_file_name());
        std::fs::write(&on_path, b"").unwrap();
        let sdk = tmp.path().join("sdk");
        adb_in(&sdk);

        let env = LocateEnv {
            path: Some(std::env::join_paths([bin]).unwrap()),
            android_home: Some(sdk),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(None, &env), Some(on_path));
    }

    // FR-008 (R5): ANDROID_HOME is used when no local.properties or PATH hit
    #[test]
    fn locate_uses_android_home() {
        let tmp = tempfile::tempdir().unwrap();
        let sdk = tmp.path().join("sdk");
        let expected = adb_in(&sdk);

        let env = LocateEnv {
            android_home: Some(sdk),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(None, &env), Some(expected));
    }

    // FR-008 (R5): ANDROID_SDK_ROOT is used when ANDROID_HOME is unset
    #[test]
    fn locate_uses_android_sdk_root() {
        let tmp = tempfile::tempdir().unwrap();
        let sdk = tmp.path().join("sdk");
        let expected = adb_in(&sdk);

        let env = LocateEnv {
            android_sdk_root: Some(sdk),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(None, &env), Some(expected));
    }

    // FR-008 (R5): an sdk.dir without adb does not stop the search
    #[test]
    fn locate_falls_through_when_sdk_dir_has_no_adb() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("local.properties"),
            format!("sdk.dir={}\n", tmp.path().join("empty-sdk").display()),
        )
        .unwrap();
        let sdk = tmp.path().join("sdk");
        let expected = adb_in(&sdk);

        let env = LocateEnv {
            android_home: Some(sdk),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(Some(tmp.path()), &env), Some(expected));
    }

    // FR-008 (R5): empty PATH segments are not the current directory
    #[test]
    fn locate_ignores_empty_path_segments() {
        let env = LocateEnv {
            path: Some(OsString::from(":")),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(None, &env), None);
    }

    // FR-008: no adb anywhere in the injected environment
    #[test]
    fn locate_returns_none_without_adb() {
        let tmp = tempfile::tempdir().unwrap();
        let env = LocateEnv {
            home: Some(tmp.path().to_path_buf()),
            local_app_data: Some(tmp.path().to_path_buf()),
            ..LocateEnv::default()
        };
        assert_eq!(locate_adb(Some(tmp.path()), &env), None);
    }
}
