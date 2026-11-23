//! Read-only git graph (commit tree, refs, worktrees) for the git tree view.

use crate::git::GitError;
use crate::model::git_graph::{GitGraph, WorktreeState};

use context::RepoContext;

pub mod context;
pub mod detail;
pub mod fingerprint;
pub mod log;
pub mod refs;
#[cfg(test)]
pub(crate) mod test_support;
pub mod worktrees;

/// Number of commits loaded per page.
pub const PAGE_SIZE: u32 = 200;
/// Hard cap on the number of commits ever loaded.
pub const MAX_COMMITS: u32 = 10_000;

/// Clamp a requested commit limit to `[1, MAX_COMMITS]`.
pub fn clamp_limit(limit: u32) -> u32 {
    limit.clamp(1, MAX_COMMITS)
}

/// Assemble the git graph: refs, worktrees, commits (with `until_hash` extension and cap)
/// and fingerprint. A repository without commits yields an empty commit list.
pub async fn load_git_graph(
    ctx: &RepoContext,
    include_remotes: bool,
    limit: u32,
    until_hash: Option<&str>,
) -> Result<GitGraph, GitError> {
    let repo = ctx.repo_path.as_str();
    let base_ref = ctx.base_ref.as_deref();
    let refs = refs::list_refs(repo, base_ref, include_remotes).await?;
    let worktrees = worktrees::list_graph_worktrees(repo, &ctx.workspaces).await?;

    let mut tips: Vec<String> = Vec::new();
    let heads = refs.iter().map(|r| r.target.as_str()).chain(
        worktrees
            .iter()
            .filter(|w| w.state != WorktreeState::Missing)
            .map(|w| w.head.as_str()),
    );
    for head in heads {
        // An unborn HEAD is reported as an all-zero id (or empty): not a commit.
        if head.is_empty() || head.bytes().all(|b| b == b'0') {
            continue;
        }
        if !tips.iter().any(|t| t == head) {
            tips.push(head.to_string());
        }
    }

    let mut limit = clamp_limit(limit);
    let mut target_beyond_cap = false;
    if let Some(hash) = until_hash {
        validate_hash(hash)?;
        match log::position_of(repo, &tips, hash).await? {
            Some(pos) => {
                let needed = (pos as u32 + 1).div_ceil(PAGE_SIZE) * PAGE_SIZE;
                limit = limit.max(needed.min(MAX_COMMITS));
            }
            None => target_beyond_cap = true,
        }
    }

    let (commits, has_more) = log::read_commits(repo, &tips, limit).await?;
    let fingerprint = fingerprint::fingerprint(repo, base_ref, include_remotes).await?;
    Ok(GitGraph {
        commits,
        refs,
        worktrees,
        base_ref: ctx.base_ref.clone(),
        has_more,
        limit,
        target_beyond_cap,
        fingerprint,
    })
}

/// Run a read-only git command in `repo`; stdout is trimmed.
pub(crate) async fn run_git(repo: &str, args: &[&str]) -> Result<String, GitError> {
    let output = crate::process::command(crate::git::resolve_git_path_blocking())
        .args(["-C", repo])
        .args(args)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(GitError::from_spawn_io)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(GitError::CommandFailed(stderr))
    }
}

/// Accept 4..=40 hex characters, reject anything else.
pub fn validate_hash(hash: &str) -> Result<(), GitError> {
    if (4..=40).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::CommandFailed("Invalid commit hash".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::test_support::{commit, git, repo};

    fn ctx(dir: &tempfile::TempDir) -> RepoContext {
        RepoContext {
            repo_path: dir.path().to_str().unwrap().to_string(),
            base_ref: Some("main".to_string()),
            workspaces: vec![],
        }
    }

    async fn many_commits(dir: &tempfile::TempDir, total: usize) -> Vec<String> {
        // One fast-import stream: far quicker than `total` separate `git commit` calls.
        let mut stream = String::new();
        for i in 0..total {
            stream.push_str(&format!(
                "commit refs/heads/main\ncommitter T <t@t> {} +0000\ndata 2\nc{}\n",
                1_700_000_000 + i,
                i % 10
            ));
            if i == 0 {
                stream.push_str("from refs/heads/main^0\n");
            }
            stream.push('\n');
        }
        use tokio::io::AsyncWriteExt;
        let mut child = crate::process::command(crate::git::resolve_git_path_blocking())
            .args(["-C", dir.path().to_str().unwrap(), "fast-import", "--quiet"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(stream.as_bytes()).await.unwrap();
        drop(stdin);
        assert!(child.wait().await.unwrap().success());
        git(dir.path(), &["log", "--format=%H", "main"])
            .await
            .lines()
            .map(String::from)
            .collect()
    }

    // FR-011
    #[test]
    fn limit_is_clamped() {
        assert_eq!(clamp_limit(0), 1);
        assert_eq!(clamp_limit(200), 200);
        assert_eq!(clamp_limit(20_000), 10_000);
    }

    // FR-011
    #[tokio::test]
    async fn until_hash_extends_limit_to_next_page() {
        let dir = repo().await;
        let hashes = many_commits(&dir, 449).await; // + initial = 450, newest first
        assert_eq!(hashes.len(), 450);
        let target = &hashes[250];
        let graph = load_git_graph(&ctx(&dir), false, 200, Some(target))
            .await
            .unwrap();
        assert_eq!(graph.limit, 400);
        assert!(!graph.target_beyond_cap);
        assert!(graph.has_more);
        assert_eq!(graph.commits.len(), 400);
        assert!(graph.commits.iter().any(|c| &c.hash == target));
    }

    // FR-011
    #[tokio::test]
    async fn until_hash_not_found_sets_beyond_cap() {
        let dir = repo().await;
        let d = dir.path();
        git(d, &["checkout", "-b", "hidden"]).await;
        let hidden = commit(d, "hidden").await;
        git(d, &["checkout", "main"]).await;
        git(d, &["branch", "-D", "hidden"]).await;
        let graph = load_git_graph(&ctx(&dir), false, 200, Some(&hidden))
            .await
            .unwrap();
        assert!(graph.target_beyond_cap);
        assert_eq!(graph.limit, 200);
    }

    // FR-004
    #[tokio::test]
    async fn tips_include_detached_worktree_head_once() {
        let dir = repo().await;
        let d = dir.path();
        let wt = tempfile::tempdir().unwrap();
        let wt_path = wt.path().join("wt");
        git(
            d,
            &["worktree", "add", "--detach", wt_path.to_str().unwrap()],
        )
        .await;
        let detached = commit(&wt_path, "detached work").await;
        let graph = load_git_graph(&ctx(&dir), false, 200, None).await.unwrap();
        assert!(graph.commits.iter().any(|c| c.hash == detached));
        assert_eq!(graph.worktrees.len(), 2);
        let mut seen = std::collections::HashSet::new();
        assert!(graph.commits.iter().all(|c| seen.insert(c.hash.clone())));
    }

    // Edge: empty repository
    #[tokio::test]
    async fn empty_repository_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-b", "main"]).await;
        let graph = load_git_graph(&ctx(&dir), false, 200, None).await.unwrap();
        assert!(graph.commits.is_empty());
        assert!(!graph.has_more);
        assert_eq!(graph.worktrees.len(), 1);
    }

    // Edge: unreadable folder
    #[tokio::test]
    async fn non_repository_folder_errors() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = RepoContext {
            repo_path: dir.path().to_str().unwrap().to_string(),
            base_ref: None,
            workspaces: vec![],
        };
        assert!(load_git_graph(&ctx, false, 200, None).await.is_err());
    }

    async fn snapshot(d: &std::path::Path) -> [String; 3] {
        let p = d.to_str().unwrap();
        // A repo without reflog makes `reflog` fail; compare the raw outcome instead.
        let reflog = format!("{:?}", run_git(p, &["reflog", "HEAD"]).await);
        [
            run_git(p, &["for-each-ref"]).await.unwrap(),
            reflog,
            run_git(p, &["status", "--porcelain"]).await.unwrap(),
        ]
    }

    // FR-013
    #[tokio::test]
    async fn graph_functions_do_not_modify_repository() {
        let dir = repo().await;
        let d = dir.path();
        commit(d, "c1").await;
        git(d, &["branch", "other"]).await;
        std::fs::write(d.join("dirty.txt"), "x").unwrap();
        let head = git(d, &["rev-parse", "HEAD"]).await;
        let context = ctx(&dir);

        let before = snapshot(d).await;
        load_git_graph(&context, true, 200, Some(&head))
            .await
            .unwrap();
        detail::commit_detail(&context, &head, true).await.unwrap();
        worktrees::worktree_states(&context.repo_path)
            .await
            .unwrap();
        assert_eq!(before, snapshot(d).await);
    }

    // SC-002
    #[tokio::test]
    #[ignore = "needs CLAUDETTE_GIT_GRAPH_BENCH_REPO (scripts/bench/make-git-graph-bench-repo.sh)"]
    async fn git_graph_perf_50k() {
        use std::time::{Duration, Instant};
        let Ok(path) = std::env::var("CLAUDETTE_GIT_GRAPH_BENCH_REPO") else {
            return;
        };
        let ctx = RepoContext {
            repo_path: path,
            base_ref: Some("main".to_string()),
            workspaces: vec![],
        };
        let budget = Duration::from_millis(1500);

        let start = Instant::now();
        let first = load_git_graph(&ctx, false, 200, None).await.unwrap();
        let first_elapsed = start.elapsed();
        println!("load_git_graph(limit 200): {first_elapsed:?}");

        let target = log::read_commits(&ctx.repo_path, &[ctx.base_ref.clone().unwrap()], 5_000)
            .await
            .unwrap()
            .0
            .last()
            .unwrap()
            .hash
            .clone();
        let start = Instant::now();
        let until = load_git_graph(&ctx, false, 200, Some(&target))
            .await
            .unwrap();
        let until_elapsed = start.elapsed();
        println!(
            "load_git_graph(until_hash ~5000): {until_elapsed:?} ({} commits)",
            until.commits.len()
        );

        assert_eq!(first.commits.len(), 200);
        assert!(until.commits.iter().any(|c| c.hash == target));
        assert!(first_elapsed < budget, "limit 200 took {first_elapsed:?}");
        assert!(until_elapsed < budget, "until_hash took {until_elapsed:?}");
    }
}
