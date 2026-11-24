use serde::{Deserialize, Serialize};

/// A branch the user can pick as a workspace's base or checkout target.
///
/// `name` carries no remote prefix (`feat/OMS-1`). `remote` is `Some("origin")`
/// for a branch that exists on that remote only (no local branch yet).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BranchRef {
    pub name: String,
    pub remote: Option<String>,
}

/// A [`BranchRef`] plus where it is already checked out, if anywhere.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceBranch {
    pub branch: BranchRef,
    /// Path of the worktree (main checkout included) that already has this
    /// branch checked out. Always `None` for remote-only branches.
    pub checked_out_at: Option<String>,
}

/// Where a new workspace's branch comes from.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkspaceSource {
    /// Claudette picks the branch name (`<prefix><name>`) from the repo's
    /// default base.
    #[default]
    Default,
    /// Create the user-named `branch` off `base`. Claudette owns the branch.
    NewBranch { base: BranchRef, branch: String },
    /// Open a worktree on an existing branch. Claudette does not own it.
    ExistingBranch { branch: BranchRef },
}
