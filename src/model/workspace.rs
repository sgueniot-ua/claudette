use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[allow(dead_code)]
pub enum AgentStatus {
    Running,
    Idle,
    IdleWithBackground,
    Stopped,
    /// Set while the CLI is context-compacting (~90s). Visually treated
    /// like Running (spinner + disabled input) but with a distinct label.
    Compacting,
    Error(String),
}

impl AgentStatus {
    pub fn label(&self) -> &str {
        match self {
            Self::Running => "Running",
            Self::Idle => "Idle",
            Self::IdleWithBackground => "IdleWithBackground",
            Self::Stopped => "Stopped",
            Self::Compacting => "Compacting",
            Self::Error(_) => "Error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum WorkspaceStatus {
    Active,
    Archived,
}

impl WorkspaceStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }
}

/// Returned when a string doesn't correspond to any known [`WorkspaceStatus`].
/// Surfacing the unknown value (instead of silently coercing) lets callers
/// detect corrupted DB rows or values written by a forward-version of the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseWorkspaceStatusError(pub String);

impl std::fmt::Display for ParseWorkspaceStatusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown WorkspaceStatus value: {:?}", self.0)
    }
}

impl std::error::Error for ParseWorkspaceStatusError {}

impl std::str::FromStr for WorkspaceStatus {
    type Err = ParseWorkspaceStatusError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(ParseWorkspaceStatusError(other.to_string())),
        }
    }
}

/// How a workspace is rooted: in its own git worktree, or directly in the
/// repository's checkout (at most one per repository).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Worktree,
    Repository,
}

impl WorkspaceKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Worktree => "worktree",
            Self::Repository => "repository",
        }
    }
}

/// Returned when a string doesn't correspond to any known [`WorkspaceKind`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseWorkspaceKindError(pub String);

impl std::fmt::Display for ParseWorkspaceKindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown WorkspaceKind value: {:?}", self.0)
    }
}

impl std::error::Error for ParseWorkspaceKindError {}

impl std::str::FromStr for WorkspaceKind {
    type Err = ParseWorkspaceKindError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "worktree" => Ok(Self::Worktree),
            "repository" => Ok(Self::Repository),
            other => Err(ParseWorkspaceKindError(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct Workspace {
    pub id: String,
    pub repository_id: String,
    pub name: String,
    pub branch_name: String,
    pub worktree_path: Option<String>,
    pub status: WorkspaceStatus,
    pub kind: WorkspaceKind,
    pub agent_status: AgentStatus,
    pub status_line: String,
    pub created_at: String,
    /// Per-repository display order for the sidebar. Persisted via the
    /// `workspaces.sort_order` column; reassigned by `reorder_workspaces`.
    pub sort_order: i32,
    /// Values supplied at workspace-create time for the repo's declared
    /// `required_inputs`. Keys mirror the schema's field keys; values are
    /// already coerced to strings on the way in. `None` when the repo had
    /// no inputs declared (the common case).
    pub input_values: Option<std::collections::HashMap<String, String>>,
}

impl Workspace {
    /// True when the workspace runs in the repository checkout itself
    /// rather than in a dedicated worktree.
    pub fn is_repository_rooted(&self) -> bool {
        self.kind == WorkspaceKind::Repository
    }

    /// False for repository-rooted workspaces: no SCM automation (archive on
    /// merge, CI auto-fix) may start an agent in, archive, delete or modify
    /// the user's own checkout and its project chats (FR-018).
    pub fn allows_scm_automation(&self) -> bool {
        !self.is_repository_rooted()
    }

    /// Name shown to the user (tray, notifications). The project chat
    /// workspace ("@project") is shown under its repository's name.
    pub fn display_name<'a>(&'a self, repo_name: &'a str) -> &'a str {
        if self.is_repository_rooted() {
            repo_name
        } else {
            &self.name
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_kind_round_trips_through_str() {
        for k in [WorkspaceKind::Worktree, WorkspaceKind::Repository] {
            assert_eq!(k.as_str().parse::<WorkspaceKind>().unwrap(), k);
        }
        assert!("bogus".parse::<WorkspaceKind>().is_err());
    }

    fn workspace_of_kind(kind: WorkspaceKind) -> Workspace {
        Workspace {
            id: "w".into(),
            repository_id: "r".into(),
            name: "w".into(),
            branch_name: "main".into(),
            worktree_path: Some("/tmp/w".into()),
            status: WorkspaceStatus::Active,
            kind,
            agent_status: AgentStatus::Idle,
            status_line: String::new(),
            created_at: String::new(),
            sort_order: 0,
            input_values: None,
        }
    }

    #[test]
    fn display_name_uses_repository_name_for_project_chats() {
        // FR-013
        let mut project = workspace_of_kind(WorkspaceKind::Repository);
        project.name = "@project".into();
        assert_eq!(project.display_name("my-repo"), "my-repo");
        assert_eq!(
            workspace_of_kind(WorkspaceKind::Worktree).display_name("my-repo"),
            "w"
        );
    }

    // FR-018
    #[test]
    fn scm_automation_is_refused_for_repository_workspaces() {
        assert!(workspace_of_kind(WorkspaceKind::Worktree).allows_scm_automation());
        assert!(!workspace_of_kind(WorkspaceKind::Repository).allows_scm_automation());
    }
}
