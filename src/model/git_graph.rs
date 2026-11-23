use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphRef {
    pub name: String,
    pub kind: RefKind,
    pub target: String,
    pub is_base: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeState {
    Clean,
    Dirty,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphWorktree {
    pub path: String,
    pub is_main: bool,
    pub branch: Option<String>,
    pub head: String,
    pub state: WorktreeState,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GitGraph {
    pub commits: Vec<GraphCommit>,
    pub refs: Vec<GraphRef>,
    pub worktrees: Vec<GraphWorktree>,
    pub base_ref: Option<String>,
    pub has_more: bool,
    pub limit: u32,
    pub target_beyond_cap: bool,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommitFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: CommitFileStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub message: String,
    pub files: Vec<CommitFile>,
    pub containing_refs: Vec<String>,
    pub containing_worktrees: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorktreeStateEntry {
    pub path: String,
    pub state: WorktreeState,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphFingerprint {
    pub fingerprint: String,
}
