//! ADB panel commands: thin wrappers over `claudette::adb` (contracts/tauri-adb.md).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use claudette::adb::locate::{LocateEnv, locate_adb};
use claudette::adb::session::{AdbSessions, AdbSink, ProcessAdbRunner, SessionContext};
use claudette::adb::settings;
use claudette::db::Database;
use claudette::model::{AdbDevice, AdbSessionStatus, DeviceKey, LogcatLine};
use claudette::ops::WorkspaceChangeKind;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

#[derive(Serialize, Clone)]
struct LogcatLinesPayload {
    workspace_id: String,
    lines: Vec<LogcatLine>,
    reset: bool,
}

#[derive(Serialize, Clone)]
struct SessionStatusPayload {
    workspace_id: String,
    status: AdbSessionStatus,
}

#[derive(Serialize, Clone)]
struct DevicesChangedPayload {
    devices: Vec<AdbDevice>,
}

/// Forwards what the sessions produce as the three `adb-*` Tauri events.
struct TauriAdbSink {
    app: AppHandle,
}

impl AdbSink for TauriAdbSink {
    fn lines(&self, workspace_id: &str, lines: Vec<LogcatLine>, reset: bool) {
        let _ = self.app.emit(
            "adb-logcat-lines",
            LogcatLinesPayload {
                workspace_id: workspace_id.to_string(),
                lines,
                reset,
            },
        );
    }

    fn status(&self, workspace_id: &str, status: AdbSessionStatus) {
        emit_status(&self.app, workspace_id, status);
    }

    fn devices(&self, devices: &[AdbDevice]) {
        let _ = self.app.emit(
            "adb-devices-changed",
            DevicesChangedPayload {
                devices: devices.to_vec(),
            },
        );
    }
}

fn emit_status(app: &AppHandle, workspace_id: &str, status: AdbSessionStatus) {
    let _ = app.emit(
        "adb-session-status",
        SessionStatusPayload {
            workspace_id: workspace_id.to_string(),
            status,
        },
    );
}

/// Everything `adb_open_session` checks before any adb call (FR-001a): the workspace must exist
/// in the local database (remote workspaces only live in the frontend store, tagged with a
/// UI-only `remote_connection_id`), have a worktree, and belong to a repo with Android mode on.
fn open_context(db: &Database, workspace_id: &str) -> Result<SessionContext, String> {
    let workspace = db
        .list_workspaces()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found (remote workspaces are not supported)")?;
    if !settings::android_mode(db, &workspace.repository_id).map_err(|e| e.to_string())? {
        return Err("Android mode is not enabled for this repository".into());
    }
    let worktree = workspace.worktree_path.ok_or("Workspace has no worktree")?;
    Ok(SessionContext {
        workspace_id: workspace.id,
        worktree: PathBuf::from(worktree),
        manual: settings::workspace_device(db, workspace_id).map_err(|e| e.to_string())?,
    })
}

/// Stop the session of a workspace that was archived or deleted; a deleted workspace also
/// forgets its manual device choice, an archived one keeps it (FR-007a, FR-011).
pub(crate) async fn teardown_workspace(
    sessions: Option<&AdbSessions>,
    db_path: &Path,
    workspace_id: &str,
    kind: WorkspaceChangeKind,
) {
    if !matches!(
        kind,
        WorkspaceChangeKind::Archived | WorkspaceChangeKind::Deleted
    ) {
        return;
    }
    if let Some(sessions) = sessions {
        sessions.stop(workspace_id).await;
    }
    if kind == WorkspaceChangeKind::Deleted
        && let Ok(db) = Database::open(db_path)
    {
        let _ = settings::delete_workspace_device(&db, workspace_id);
    }
}

/// Fire-and-forget teardown for the (synchronous) workspace hooks.
pub(crate) fn spawn_teardown(app: &AppHandle, ids: Vec<String>, kind: WorkspaceChangeKind) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let sessions = state.adb_sessions.read().await.clone();
        for id in &ids {
            teardown_workspace(sessions.as_deref(), &state.db_path, id, kind).await;
        }
    });
}

/// Stop the sessions of every workspace of a repository.
pub(crate) async fn stop_repo_sessions(state: &AppState, repo_id: &str) {
    let Some(sessions) = state.adb_sessions.read().await.clone() else {
        return;
    };
    let ids: Vec<String> = Database::open(&state.db_path)
        .and_then(|db| db.list_workspaces())
        .map(|all| {
            all.into_iter()
                .filter(|w| w.repository_id == repo_id)
                .map(|w| w.id)
                .collect()
        })
        .unwrap_or_default();
    for id in ids {
        sessions.stop(&id).await;
    }
}

/// The sessions, created on the first open once `adb` is found; `None` when it is not.
async fn sessions_or_create(
    app: &AppHandle,
    state: &AppState,
    worktree: &Path,
) -> Option<Arc<AdbSessions>> {
    let mut guard = state.adb_sessions.write().await;
    if let Some(sessions) = guard.as_ref() {
        return Some(sessions.clone());
    }
    let adb = locate_adb(Some(worktree), &LocateEnv::from_process())?;
    let sessions = AdbSessions::new(
        Arc::new(ProcessAdbRunner::new(adb)),
        Arc::new(TauriAdbSink { app: app.clone() }),
    );
    *guard = Some(sessions.clone());
    Some(sessions)
}

#[tauri::command]
pub async fn adb_get_android_mode(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    settings::android_mode(&db, &repo_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn adb_set_android_mode(
    repo_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    settings::set_android_mode(&db, &repo_id, enabled).map_err(|e| e.to_string())?;
    if !enabled {
        stop_repo_sessions(&state, &repo_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn adb_open_session(
    workspace_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AdbSessionStatus, String> {
    let ctx = {
        let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
        open_context(&db, &workspace_id)?
    };
    let Some(sessions) = sessions_or_create(&app, &state, &ctx.worktree).await else {
        emit_status(&app, &workspace_id, AdbSessionStatus::AdbMissing);
        return Ok(AdbSessionStatus::AdbMissing);
    };
    Ok(sessions.open(ctx).await)
}

#[tauri::command]
pub async fn adb_close_session(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(sessions) = state.adb_sessions.read().await.clone() {
        sessions.stop(&workspace_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn adb_list_devices(state: State<'_, AppState>) -> Result<Vec<AdbDevice>, String> {
    Ok(match state.adb_sessions.read().await.as_ref() {
        Some(sessions) => sessions.devices(),
        None => Vec::new(),
    })
}

/// Persists the manual choice (`None` clears it) and re-resolves the running session. The
/// returned status is the session's status at call time: `AdbSessions` exposes no status getter
/// and re-resolution is asynchronous, so the new status arrives through `adb-session-status`.
/// Without sessions (nothing opened yet) the answer is `Stopped`.
#[tauri::command]
pub async fn adb_set_workspace_device(
    workspace_id: String,
    key: Option<DeviceKey>,
    state: State<'_, AppState>,
) -> Result<AdbSessionStatus, String> {
    let ctx = {
        let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
        settings::set_workspace_device(&db, &workspace_id, key.as_ref())
            .map_err(|e| e.to_string())?;
        open_context(&db, &workspace_id)?
    };
    let Some(sessions) = state.adb_sessions.read().await.clone() else {
        return Ok(AdbSessionStatus::Stopped);
    };
    sessions.re_resolve(&workspace_id, key).await;
    Ok(sessions.open(ctx).await)
}

#[tauri::command]
pub async fn adb_get_workspace_device(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Option<DeviceKey>, String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    settings::workspace_device(&db, &workspace_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use claudette::adb::logcat::{LogcatStream, TailFrom};
    use claudette::adb::runner::AdbRunner;
    use claudette::model::{AgentStatus, Repository, Workspace, WorkspaceStatus};
    use std::io;

    struct IdleRunner;

    #[async_trait::async_trait]
    impl AdbRunner for IdleRunner {
        async fn devices(&self) -> io::Result<String> {
            Ok("List of devices attached\n\n".into())
        }
        async fn avd_name(&self, _serial: &str) -> Option<String> {
            None
        }
        fn spawn_logcat(&self, _s: &str, _t: &TailFrom) -> io::Result<Box<dyn LogcatStream>> {
            Err(io::Error::other("unused"))
        }
        async fn dedicated_avd(&self, _worktree: &Path) -> Option<String> {
            None
        }
    }

    #[derive(Default)]
    struct NullSink {
        stopped: std::sync::Mutex<Vec<String>>,
    }

    impl AdbSink for NullSink {
        fn lines(&self, _w: &str, _l: Vec<LogcatLine>, _r: bool) {}
        fn status(&self, w: &str, status: AdbSessionStatus) {
            if status == AdbSessionStatus::Stopped {
                self.stopped.lock().unwrap().push(w.to_string());
            }
        }
        fn devices(&self, _d: &[AdbDevice]) {}
    }

    fn db_with_workspace() -> (tempfile::TempDir, PathBuf, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let db = Database::open(&path).unwrap();
        db.insert_repository(&Repository {
            id: "r1".into(),
            path: "/tmp/r1".into(),
            name: "r1".into(),
            path_slug: "r1".into(),
            icon: None,
            created_at: String::new(),
            setup_script: None,
            custom_instructions: None,
            sort_order: 0,
            branch_rename_preferences: None,
            setup_script_auto_run: false,
            archive_script: None,
            archive_script_auto_run: false,
            base_branch: None,
            default_remote: None,
            required_inputs: None,
            path_valid: true,
        })
        .unwrap();
        db.insert_workspace(&Workspace {
            id: "w1".into(),
            repository_id: "r1".into(),
            name: "w1".into(),
            branch_name: "feat".into(),
            worktree_path: Some("/tmp/w1".into()),
            status: WorkspaceStatus::Active,
            agent_status: AgentStatus::Idle,
            status_line: String::new(),
            created_at: String::new(),
            sort_order: 0,
            input_values: None,
        })
        .unwrap();
        (dir, path, db)
    }

    // FR-001a
    #[test]
    fn open_session_requires_android_mode() {
        let (_dir, _path, db) = db_with_workspace();
        assert!(open_context(&db, "w1").is_err());
        settings::set_android_mode(&db, "r1", true).unwrap();
        let ctx = open_context(&db, "w1").unwrap();
        assert_eq!(ctx.worktree, PathBuf::from("/tmp/w1"));
        assert_eq!(ctx.manual, None);
    }

    // FR-003a: remote workspaces are not in the local database
    #[test]
    fn open_session_rejects_remote_workspace() {
        let (_dir, _path, db) = db_with_workspace();
        settings::set_android_mode(&db, "r1", true).unwrap();
        assert!(open_context(&db, "remote-ws").is_err());
    }

    // FR-007a
    #[tokio::test]
    async fn deleted_hook_clears_device_choice() {
        let (_dir, path, db) = db_with_workspace();
        let key = DeviceKey::Avd("task-x".into());
        settings::set_workspace_device(&db, "w1", Some(&key)).unwrap();
        teardown_workspace(None, &path, "w1", WorkspaceChangeKind::Deleted).await;
        assert_eq!(settings::workspace_device(&db, "w1").unwrap(), None);
    }

    // FR-007a
    #[tokio::test]
    async fn archived_hook_keeps_device_choice() {
        let (_dir, path, db) = db_with_workspace();
        let key = DeviceKey::Avd("task-x".into());
        settings::set_workspace_device(&db, "w1", Some(&key)).unwrap();
        teardown_workspace(None, &path, "w1", WorkspaceChangeKind::Archived).await;
        assert_eq!(settings::workspace_device(&db, "w1").unwrap(), Some(key));
    }

    // FR-011
    #[tokio::test]
    async fn archive_and_delete_stop_sessions() {
        let (_dir, path, _db) = db_with_workspace();
        let sink = Arc::new(NullSink::default());
        let sessions = AdbSessions::new(Arc::new(IdleRunner), sink.clone());
        for (kind, stops) in [
            (WorkspaceChangeKind::Renamed, 0),
            (WorkspaceChangeKind::Archived, 1),
            (WorkspaceChangeKind::Deleted, 2),
        ] {
            let ctx = SessionContext {
                workspace_id: "w1".into(),
                worktree: PathBuf::from("/tmp/w1"),
                manual: None,
            };
            sessions.open(ctx).await;
            teardown_workspace(Some(&sessions), &path, "w1", kind).await;
            assert_eq!(sink.stopped.lock().unwrap().len(), stops);
        }
    }
}
