//! Worktree listing, per-worktree state and the link to Claudette workspaces.

use std::path::Path;
use std::time::Duration;

use futures::stream::{StreamExt, TryStreamExt};

use super::context::WorkspaceLink;
use crate::git::GitError;
use crate::model::git_graph::{GraphWorktree, WorktreeState, WorktreeStateEntry};

/// Delay after which a `git status` is abandoned and the state reported as unknown.
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);

/// Read-only status: `--no-optional-locks` keeps git from writing `index.lock` in worktrees
/// that agents are using.
const STATUS_ARGS: [&str; 4] = [
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--untracked-files=normal",
];

/// One entry of `git worktree list --porcelain`.
#[derive(Debug, Default)]
struct RawWorktree {
    path: String,
    head: String,
    branch: Option<String>,
    prunable: bool,
    bare: bool,
}

fn parse_porcelain(out: &str) -> Vec<RawWorktree> {
    let mut entries = Vec::new();
    let mut current: Option<RawWorktree> = None;
    for line in out.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            entries.extend(current.take());
            current = Some(RawWorktree {
                path: path.to_string(),
                ..Default::default()
            });
        } else if let Some(entry) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                entry.head = head.to_string();
            } else if let Some(branch) = line.strip_prefix("branch ") {
                entry.branch = Some(
                    branch
                        .strip_prefix("refs/heads/")
                        .unwrap_or(branch)
                        .to_string(),
                );
            } else if line == "prunable" || line.starts_with("prunable ") {
                entry.prunable = true;
            } else if line == "bare" {
                entry.bare = true;
            }
        }
    }
    entries.extend(current);
    entries
}

/// Non-bare worktrees paired with `is_main` (the first porcelain entry is the main worktree).
async fn raw_worktrees(repo: &str) -> Result<Vec<(bool, RawWorktree)>, GitError> {
    let out = super::run_git(repo, &["worktree", "list", "--porcelain"]).await?;
    Ok(parse_porcelain(&out)
        .into_iter()
        .enumerate()
        .filter(|(_, e)| !e.bare)
        .map(|(i, e)| (i == 0, e))
        .collect())
}

fn canonical(path: &str) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
}

fn is_missing(entry: &RawWorktree) -> bool {
    entry.prunable || !Path::new(&entry.path).exists()
}

/// List every worktree of `repo` (main, branch, detached, missing) and link those that belong
/// to a Claudette workspace by canonical path. States are `Missing` or `Unknown` here; use
/// [`worktree_states`] for the real ones.
pub async fn list_graph_worktrees(
    repo: &str,
    workspaces: &[WorkspaceLink],
) -> Result<Vec<GraphWorktree>, GitError> {
    let links: Vec<(std::path::PathBuf, &WorkspaceLink)> = workspaces
        .iter()
        .map(|w| (canonical(&w.worktree_path), w))
        .collect();

    Ok(raw_worktrees(repo)
        .await?
        .into_iter()
        .map(|(is_main, e)| {
            let missing = is_missing(&e);
            let link = if missing {
                None
            } else {
                let path = canonical(&e.path);
                links.iter().find(|(p, _)| *p == path).map(|(_, w)| *w)
            };
            GraphWorktree {
                state: if missing {
                    WorktreeState::Missing
                } else {
                    WorktreeState::Unknown
                },
                is_main,
                branch: e.branch,
                head: e.head,
                workspace_id: link.map(|w| w.id.clone()),
                workspace_name: link.map(|w| w.name.clone()),
                path: e.path,
            }
        })
        .collect())
}

/// Current state of every worktree of `repo`: `Missing` when the folder is gone, otherwise
/// `Clean` / `Dirty` from `git status`, or `Unknown` on failure or after 5 seconds.
pub async fn worktree_states(repo: &str) -> Result<Vec<WorktreeStateEntry>, GitError> {
    let entries = raw_worktrees(repo).await?;
    futures::stream::iter(entries)
        .map(|(_, e)| async move {
            let state = if is_missing(&e) {
                WorktreeState::Missing
            } else {
                let status = super::run_git(&e.path, &STATUS_ARGS);
                match tokio::time::timeout(STATUS_TIMEOUT, status).await {
                    Ok(Ok(out)) if out.is_empty() => WorktreeState::Clean,
                    Ok(Ok(_)) => WorktreeState::Dirty,
                    _ => WorktreeState::Unknown,
                }
            };
            Ok::<_, GitError>(WorktreeStateEntry {
                path: e.path,
                state,
            })
        })
        .buffer_unordered(8)
        .try_collect()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::test_support::{commit, git, repo};

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    fn link(id: &str, path: &str) -> WorkspaceLink {
        WorkspaceLink {
            id: id.into(),
            name: format!("name-{id}"),
            worktree_path: path.into(),
        }
    }

    /// Repo with branch `feat`, a worktree on it (d1) and a detached one (d2).
    async fn setup() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        std::path::PathBuf,
        std::path::PathBuf,
    ) {
        let main = repo().await;
        git(main.path(), &["branch", "feat"]).await;
        let wt = tempfile::tempdir().unwrap();
        let d1 = wt.path().join("d1");
        let d2 = wt.path().join("d2");
        git(main.path(), &["worktree", "add", s(&d1), "feat"]).await;
        git(
            main.path(),
            &["worktree", "add", "--detach", s(&d2), "HEAD"],
        )
        .await;
        (main, wt, d1, d2)
    }

    fn find<'a>(list: &'a [GraphWorktree], dir: &Path) -> &'a GraphWorktree {
        let want = std::fs::canonicalize(dir).unwrap();
        list.iter()
            .find(|w| std::fs::canonicalize(&w.path).unwrap() == want)
            .unwrap()
    }

    // FR-004 FR-010 SC-003
    #[tokio::test]
    async fn lists_main_branch_and_detached_worktrees() {
        let (main, _wt, d1, d2) = setup().await;
        let list = list_graph_worktrees(s(main.path()), &[]).await.unwrap();
        assert_eq!(list.len(), 3);
        let m = find(&list, main.path());
        assert!(m.is_main);
        assert_eq!(m.branch.as_deref(), Some("main"));
        assert_eq!(m.head.len(), 40);
        let w1 = find(&list, &d1);
        assert!(!w1.is_main);
        assert_eq!(w1.branch.as_deref(), Some("feat"));
        let w2 = find(&list, &d2);
        assert_eq!(w2.branch, None);
        assert!(!w2.is_main);
        assert_eq!(w2.state, WorktreeState::Unknown);
    }

    // FR-010
    #[tokio::test]
    async fn removed_folder_is_missing_without_error() {
        let (main, _wt, d1, _d2) = setup().await;
        std::fs::remove_dir_all(&d1).unwrap();
        let list = list_graph_worktrees(s(main.path()), &[]).await.unwrap();
        let w1 = list.iter().find(|w| w.path.ends_with("d1")).unwrap();
        assert_eq!(w1.state, WorktreeState::Missing);
        let states = worktree_states(s(main.path())).await.unwrap();
        let st = states.iter().find(|e| e.path.ends_with("d1")).unwrap();
        assert_eq!(st.state, WorktreeState::Missing);
    }

    // FR-005 FR-008
    #[tokio::test]
    async fn claudette_workspace_matched_and_external_not() {
        let (main, _wt, d1, d2) = setup().await;
        let links = [link("w1", s(&d1))];
        let list = list_graph_worktrees(s(main.path()), &links).await.unwrap();
        let w1 = find(&list, &d1);
        assert_eq!(w1.workspace_id.as_deref(), Some("w1"));
        assert_eq!(w1.workspace_name.as_deref(), Some("name-w1"));
        let w2 = find(&list, &d2);
        assert_eq!(w2.workspace_id, None);
        assert_eq!(w2.workspace_name, None);
    }

    // FR-005
    #[tokio::test]
    async fn claudette_workspace_matched_through_symlink() {
        let (main, wt, d1, _d2) = setup().await;
        let sym = wt.path().join("sym");
        std::os::unix::fs::symlink(&d1, &sym).unwrap();
        let links = [link("w1", s(&sym))];
        let list = list_graph_worktrees(s(main.path()), &links).await.unwrap();
        assert_eq!(find(&list, &d1).workspace_id.as_deref(), Some("w1"));
    }

    // FR-004
    #[tokio::test]
    async fn worktree_path_with_spaces_and_unicode_branch() {
        let main = repo().await;
        git(main.path(), &["branch", "feat/é-ü"]).await;
        let wt = tempfile::tempdir().unwrap();
        let dir = wt.path().join("dir with space");
        git(main.path(), &["worktree", "add", s(&dir), "feat/é-ü"]).await;
        let list = list_graph_worktrees(s(main.path()), &[]).await.unwrap();
        let w = find(&list, &dir);
        // git reports the canonical path (e.g. /private/var on macOS).
        assert_eq!(
            std::fs::canonicalize(&w.path).unwrap(),
            std::fs::canonicalize(&dir).unwrap()
        );
        assert!(w.path.ends_with("dir with space"));
        assert_eq!(w.branch.as_deref(), Some("feat/é-ü"));
    }

    // FR-009 SC-006
    #[tokio::test]
    async fn states_clean_dirty_untracked() {
        let (main, _wt, d1, d2) = setup().await;
        // Tracked file modified in d1; untracked file only in d2; main stays clean.
        std::fs::write(main.path().join("f.txt"), "a").unwrap();
        git(main.path(), &["add", "f.txt"]).await;
        commit(main.path(), "add f").await;
        git(&d1, &["merge", "--ff-only", "main"]).await;
        std::fs::write(d1.join("f.txt"), "changed").unwrap();
        std::fs::write(d2.join("new.txt"), "x").unwrap();

        let states = worktree_states(s(main.path())).await.unwrap();
        let state_of = |dir: &Path| {
            let want = std::fs::canonicalize(dir).unwrap();
            states
                .iter()
                .find(|e| std::fs::canonicalize(&e.path).unwrap() == want)
                .unwrap()
                .state
                .clone()
        };
        assert_eq!(state_of(main.path()), WorktreeState::Clean);
        assert_eq!(state_of(&d1), WorktreeState::Dirty);
        assert_eq!(state_of(&d2), WorktreeState::Dirty);
    }

    // FR-009
    #[tokio::test]
    async fn git_failure_maps_to_unknown() {
        let (main, _wt, d1, _d2) = setup().await;
        std::fs::write(d1.join(".git"), "").unwrap();
        let states = worktree_states(s(main.path())).await.unwrap();
        let st = states.iter().find(|e| e.path.ends_with("d1")).unwrap();
        assert_eq!(st.state, WorktreeState::Unknown);
    }

    // FR-013
    #[test]
    fn status_uses_no_optional_locks() {
        assert_eq!(STATUS_ARGS[0], "--no-optional-locks");
        assert_eq!(STATUS_ARGS[1], "status");
    }
}
