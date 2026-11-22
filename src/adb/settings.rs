//! Persisted ADB choices in `app_settings`: the per-repo Android mode and the
//! per-workspace manual device choice.

use crate::db::Database;
use crate::model::DeviceKey;

impl DeviceKey {
    /// Setting value: `avd:<name>` or `serial:<serial>`.
    pub fn to_setting(&self) -> String {
        match self {
            Self::Avd(name) => format!("avd:{name}"),
            Self::Serial(serial) => format!("serial:{serial}"),
        }
    }

    /// Parse a setting value; anything unknown or empty yields `None`.
    pub fn from_setting(value: &str) -> Option<Self> {
        if let Some(name) = value.strip_prefix("avd:").filter(|s| !s.is_empty()) {
            Some(Self::Avd(name.to_string()))
        } else {
            value
                .strip_prefix("serial:")
                .filter(|s| !s.is_empty())
                .map(|serial| Self::Serial(serial.to_string()))
        }
    }
}

fn android_mode_key(repo_id: &str) -> String {
    format!("repo:{repo_id}:android_mode")
}

fn workspace_device_key(workspace_id: &str) -> String {
    format!("workspace:{workspace_id}:adb_device")
}

/// Android mode of a repo; only the value `"true"` enables it.
pub fn android_mode(db: &Database, repo_id: &str) -> Result<bool, rusqlite::Error> {
    Ok(db.get_app_setting(&android_mode_key(repo_id))?.as_deref() == Some("true"))
}

/// Enabling stores `"true"`; disabling deletes the key.
pub fn set_android_mode(
    db: &Database,
    repo_id: &str,
    enabled: bool,
) -> Result<(), rusqlite::Error> {
    let key = android_mode_key(repo_id);
    if enabled {
        db.set_app_setting(&key, "true")
    } else {
        db.delete_app_setting(&key)
    }
}

pub fn workspace_device(
    db: &Database,
    workspace_id: &str,
) -> Result<Option<DeviceKey>, rusqlite::Error> {
    Ok(db
        .get_app_setting(&workspace_device_key(workspace_id))?
        .as_deref()
        .and_then(DeviceKey::from_setting))
}

/// `None` clears the manual choice.
pub fn set_workspace_device(
    db: &Database,
    workspace_id: &str,
    key: Option<&DeviceKey>,
) -> Result<(), rusqlite::Error> {
    match key {
        Some(key) => db.set_app_setting(&workspace_device_key(workspace_id), &key.to_setting()),
        None => delete_workspace_device(db, workspace_id),
    }
}

pub fn delete_workspace_device(db: &Database, workspace_id: &str) -> Result<(), rusqlite::Error> {
    db.delete_app_setting(&workspace_device_key(workspace_id))
}

/// Forget the ADB settings of a removed repository: its Android mode and the manual device
/// choice of each of its workspaces.
pub fn forget_repo(
    db: &Database,
    repo_id: &str,
    workspace_ids: &[String],
) -> Result<(), rusqlite::Error> {
    db.delete_app_setting(&android_mode_key(repo_id))?;
    for id in workspace_ids {
        delete_workspace_device(db, id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    // FR-007a: manual choice round-trips through its setting value
    #[test]
    fn device_key_roundtrip() {
        let avd = DeviceKey::from_setting("avd:task-x").unwrap();
        assert_eq!(avd, DeviceKey::Avd("task-x".into()));
        assert_eq!(avd.to_setting(), "avd:task-x");

        let serial = DeviceKey::from_setting("serial:R58").unwrap();
        assert_eq!(serial, DeviceKey::Serial("R58".into()));
        assert_eq!(serial.to_setting(), "serial:R58");

        assert_eq!(DeviceKey::from_setting("junk"), None);
    }

    // FR-007a: an empty payload is not a device, so it reads as no choice
    #[test]
    fn device_key_empty_payload_is_absent() {
        assert_eq!(DeviceKey::from_setting("avd:"), None);
        assert_eq!(DeviceKey::from_setting("serial:"), None);
    }

    // FR-007a: an unknown stored value reads as no choice
    #[test]
    fn unknown_device_setting_is_absent() {
        let (_dir, db) = temp_db();
        db.set_app_setting("workspace:w1:adb_device", "junk")
            .unwrap();
        assert_eq!(workspace_device(&db, "w1").unwrap(), None);
    }

    // FR-007a: the choice is stored per workspace, can be changed and cleared
    #[test]
    fn workspace_device_set_change_and_delete() {
        let (_dir, db) = temp_db();
        set_workspace_device(&db, "w1", Some(&DeviceKey::Avd("task-x".into()))).unwrap();
        assert_eq!(
            workspace_device(&db, "w1").unwrap(),
            Some(DeviceKey::Avd("task-x".into()))
        );
        assert_eq!(workspace_device(&db, "w2").unwrap(), None);

        set_workspace_device(&db, "w1", Some(&DeviceKey::Serial("R58".into()))).unwrap();
        assert_eq!(
            workspace_device(&db, "w1").unwrap(),
            Some(DeviceKey::Serial("R58".into()))
        );

        set_workspace_device(&db, "w1", None).unwrap();
        assert_eq!(workspace_device(&db, "w1").unwrap(), None);
    }

    // FR-001a: Android mode is off by default
    #[test]
    fn android_mode_defaults_off() {
        let (_dir, db) = temp_db();
        assert!(!android_mode(&db, "r1").unwrap());
    }

    // FR-001a: only the stored value "true" enables the mode
    #[test]
    fn android_mode_only_true_enables() {
        let (_dir, db) = temp_db();
        for value in ["false", "1"] {
            db.set_app_setting("repo:r1:android_mode", value).unwrap();
            assert!(!android_mode(&db, "r1").unwrap(), "value {value:?}");
        }
    }

    // FR-001a: enabling stores "true"; disabling deletes the key
    #[test]
    fn set_android_mode_false_deletes_key() {
        let (_dir, db) = temp_db();
        set_android_mode(&db, "r1", true).unwrap();
        assert!(android_mode(&db, "r1").unwrap());
        assert_eq!(
            db.get_app_setting("repo:r1:android_mode")
                .unwrap()
                .as_deref(),
            Some("true")
        );

        set_android_mode(&db, "r1", false).unwrap();
        assert!(!android_mode(&db, "r1").unwrap());
        assert_eq!(db.get_app_setting("repo:r1:android_mode").unwrap(), None);
    }

    // FR-011 (suppression d'un dépôt : ses réglages ADB sont effacés)
    #[test]
    fn forget_repo_deletes_mode_and_device_choices() {
        let (_dir, db) = temp_db();
        set_android_mode(&db, "r1", true).unwrap();
        set_android_mode(&db, "r2", true).unwrap();
        set_workspace_device(&db, "w1", Some(&DeviceKey::Serial("R58".into()))).unwrap();
        set_workspace_device(&db, "w2", Some(&DeviceKey::Serial("R59".into()))).unwrap();
        forget_repo(&db, "r1", &["w1".to_string()]).unwrap();
        assert!(!android_mode(&db, "r1").unwrap());
        assert_eq!(workspace_device(&db, "w1").unwrap(), None);
        assert!(android_mode(&db, "r2").unwrap());
        assert!(workspace_device(&db, "w2").unwrap().is_some());
    }
}
