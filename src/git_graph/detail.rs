//! Commit detail (files against the first parent, containing refs and worktrees) and the
//! first-parent diff of one file.

use futures::stream::{self, StreamExt};

use super::context::RepoContext;
use super::run_git;
use super::validate_hash;
use super::worktrees::list_graph_worktrees;
use crate::git::GitError;
use crate::model::git_graph::{CommitDetail, CommitFile, CommitFileStatus, WorktreeState};

/// Maximum number of concurrent `merge-base` processes.
const CONCURRENCY: usize = 8;

fn parse_status(code: &str) -> Option<CommitFileStatus> {
    match code.chars().next()? {
        'A' => Some(CommitFileStatus::Added),
        'M' => Some(CommitFileStatus::Modified),
        'D' => Some(CommitFileStatus::Deleted),
        'R' => Some(CommitFileStatus::Renamed),
        'C' => Some(CommitFileStatus::Copied),
        'T' => Some(CommitFileStatus::TypeChanged),
        _ => None,
    }
}

fn parse_files(out: &str) -> Vec<CommitFile> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status = parse_status(parts.next()?)?;
            let first = parts.next()?.to_string();
            match parts.next() {
                Some(new_path) => Some(CommitFile {
                    path: new_path.to_string(),
                    old_path: Some(first),
                    status,
                }),
                None => Some(CommitFile {
                    path: first,
                    old_path: None,
                    status,
                }),
            }
        })
        .collect()
}

/// `merge-base --is-ancestor`: exit 0 = true, exit 1 (empty stderr) = false, any other
/// failure (git prints a message) is a real error.
async fn is_ancestor(repo: &str, hash: &str, descendant: &str) -> Result<bool, GitError> {
    match run_git(repo, &["merge-base", "--is-ancestor", hash, descendant]).await {
        Ok(_) => Ok(true),
        Err(GitError::CommandFailed(stderr)) if stderr.is_empty() => Ok(false),
        Err(e) => Err(e),
    }
}

/// Commit metadata, files changed against the first parent, and the refs / worktrees whose
/// history contains the commit.
pub async fn commit_detail(
    ctx: &RepoContext,
    hash: &str,
    include_remotes: bool,
) -> Result<CommitDetail, GitError> {
    validate_hash(hash)?;
    let repo = ctx.repo_path.as_str();

    let out = run_git(
        repo,
        &[
            "-c",
            "core.quotepath=off",
            "show",
            "-m",
            "--first-parent",
            "--no-color",
            "--name-status",
            "-M",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e",
            hash,
        ],
    )
    .await?;
    let (header, files_part) = out
        .split_once('\x1e')
        .ok_or_else(|| GitError::CommandFailed("Unexpected git show output".to_string()))?;
    let mut fields = header.splitn(6, '\x1f');
    let mut next = || fields.next().unwrap_or_default().to_string();
    let full_hash = next();
    let parents: Vec<String> = next().split_whitespace().map(str::to_string).collect();
    let author = next();
    let author_email = next();
    let date = next();
    let message = next().trim().to_string();
    let short_hash = full_hash.chars().take(7).collect();

    let mut ref_args = vec![
        "for-each-ref",
        "--contains",
        full_hash.as_str(),
        "--format=%(refname)",
        "refs/heads",
    ];
    if include_remotes {
        ref_args.push("refs/remotes");
    }
    // Full names, shortened here: `%(refname:short)` turns `refs/remotes/origin/HEAD` into
    // a bare `origin`, which is not a branch.
    let mut containing_refs: Vec<String> = run_git(repo, &ref_args)
        .await?
        .lines()
        .filter_map(|full| {
            full.strip_prefix("refs/heads/").or_else(|| {
                full.strip_prefix("refs/remotes/")
                    .filter(|name| !name.ends_with("/HEAD"))
            })
        })
        .map(str::to_string)
        .collect();
    if let Some(base) = &ctx.base_ref
        && !containing_refs.contains(base)
        && is_ancestor(repo, &full_hash, base).await.unwrap_or(false)
    {
        containing_refs.push(base.clone());
    }

    let worktrees = list_graph_worktrees(repo, &ctx.workspaces).await?;
    let full = full_hash.as_str();
    let containing_worktrees: Vec<String> = stream::iter(
        worktrees
            .into_iter()
            .filter(|w| w.state != WorktreeState::Missing),
    )
    .map(|w| async move {
        is_ancestor(repo, full, &w.head)
            .await
            .unwrap_or(false)
            .then_some(w.path)
    })
    .buffered(CONCURRENCY)
    .filter_map(|p| async move { p })
    .collect()
    .await;

    Ok(CommitDetail {
        hash: full_hash,
        short_hash,
        parents,
        author,
        author_email,
        date,
        message,
        files: parse_files(files_part.trim()),
        containing_refs,
        containing_worktrees,
    })
}

/// Raw diff of `file` in commit `hash` against its first parent. A renamed file is diffed
/// against its old path, so only the real changes show instead of a full addition.
pub async fn commit_file_diff_first_parent(
    repo: &str,
    hash: &str,
    file: &str,
) -> Result<String, GitError> {
    validate_hash(hash)?;
    crate::diff::validate_file_path(file).map_err(|e| GitError::CommandFailed(e.to_string()))?;
    // Rename detection needs both paths in the pathspec: look up the old one first.
    let names = run_git(
        repo,
        &[
            "-c",
            "core.quotepath=off",
            "show",
            "-m",
            "--first-parent",
            "--format=",
            "--no-color",
            "--name-status",
            "-M",
            hash,
        ],
    )
    .await?;
    let old_path = parse_files(&names)
        .into_iter()
        .find(|f| f.path == file && f.status == CommitFileStatus::Renamed)
        .and_then(|f| f.old_path);
    let mut args = vec![
        "show",
        "-m",
        "--first-parent",
        "--format=",
        "--no-color",
        "-M",
        hash,
        "--",
    ];
    if let Some(old) = old_path.as_deref() {
        args.push(old);
    }
    args.push(file);
    run_git(repo, &args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::test_support::{commit, git, repo};

    fn ctx(dir: &std::path::Path) -> RepoContext {
        RepoContext {
            repo_path: dir.to_str().unwrap().to_string(),
            base_ref: Some("main".to_string()),
            workspaces: vec![],
        }
    }

    async fn write_commit(dir: &std::path::Path, file: &str, content: &str, msg: &str) -> String {
        std::fs::write(dir.join(file), content).unwrap();
        git(dir, &["add", "-A"]).await;
        git(dir, &["commit", "-m", msg]).await;
        git(dir, &["rev-parse", "HEAD"]).await
    }

    async fn merge_repo() -> (tempfile::TempDir, String) {
        let dir = repo().await;
        git(dir.path(), &["checkout", "-b", "feat"]).await;
        write_commit(dir.path(), "f.txt", "x\n", "add f").await;
        git(dir.path(), &["checkout", "main"]).await;
        commit(dir.path(), "main work").await;
        git(
            dir.path(),
            &["merge", "--no-ff", "feat", "-m", "merge feat"],
        )
        .await;
        let merge = git(dir.path(), &["rev-parse", "HEAD"]).await;
        (dir, merge)
    }

    // FR-016
    #[tokio::test]
    async fn merge_commit_files_against_first_parent() {
        let (dir, merge) = merge_repo().await;
        let detail = commit_detail(&ctx(dir.path()), &merge, false)
            .await
            .unwrap();
        assert_eq!(detail.parents.len(), 2);
        assert_eq!(detail.message, "merge feat");
        assert_eq!(
            detail.files,
            vec![CommitFile {
                path: "f.txt".into(),
                old_path: None,
                status: CommitFileStatus::Added
            }]
        );
    }

    // FR-016
    #[tokio::test]
    async fn root_and_rename_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-b", "main"]).await;
        git(p, &["config", "user.email", "test@test.com"]).await;
        git(p, &["config", "user.name", "Test"]).await;
        git(p, &["config", "commit.gpgsign", "false"]).await;
        let root = write_commit(p, "README", "hello\n", "root").await;
        let detail = commit_detail(&ctx(p), &root, false).await.unwrap();
        assert!(detail.parents.is_empty());
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].path, "README");
        assert_eq!(detail.files[0].status, CommitFileStatus::Added);

        write_commit(p, "a", "some content here\nmore\n", "add a").await;
        git(p, &["mv", "a", "b"]).await;
        git(p, &["commit", "-m", "rename"]).await;
        let head = git(p, &["rev-parse", "HEAD"]).await;
        let detail = commit_detail(&ctx(p), &head, false).await.unwrap();
        assert_eq!(
            detail.files,
            vec![CommitFile {
                path: "b".into(),
                old_path: Some("a".into()),
                status: CommitFileStatus::Renamed
            }]
        );
    }

    // FR-016
    #[tokio::test]
    async fn containing_refs_and_worktrees_include_detached() {
        let dir = repo().await;
        let p = dir.path();
        let c1 = commit(p, "c1").await;
        let wt_dir = tempfile::tempdir().unwrap();
        let detached = wt_dir.path().join("detached");
        let gone = wt_dir.path().join("gone");
        git(
            p,
            &[
                "worktree",
                "add",
                "--detach",
                detached.to_str().unwrap(),
                &c1,
            ],
        )
        .await;
        git(
            p,
            &["worktree", "add", "--detach", gone.to_str().unwrap(), &c1],
        )
        .await;
        std::fs::remove_dir_all(&gone).unwrap();
        commit(p, "c2").await;

        let detail = commit_detail(&ctx(p), &c1, false).await.unwrap();
        assert_eq!(detail.containing_refs, vec!["main".to_string()]);
        let canon = |s: &str| std::fs::canonicalize(s).unwrap_or_else(|_| s.into());
        let paths: Vec<_> = detail
            .containing_worktrees
            .iter()
            .map(|s| canon(s))
            .collect();
        assert!(paths.contains(&canon(detached.to_str().unwrap())));
        assert!(paths.contains(&canon(p.to_str().unwrap())));
        assert!(
            !detail
                .containing_worktrees
                .iter()
                .any(|s| s.ends_with("gone"))
        );
    }

    // FR-016
    #[tokio::test]
    async fn first_parent_diff_of_merge_is_not_empty() {
        let (dir, merge) = merge_repo().await;
        let diff = commit_file_diff_first_parent(dir.path().to_str().unwrap(), &merge, "f.txt")
            .await
            .unwrap();
        assert!(diff.contains("+x"), "{diff}");
    }

    // FR-016
    #[tokio::test]
    async fn first_parent_diff_of_renamed_file_is_a_rename() {
        let dir = repo().await;
        let p = dir.path();
        let body: String = (0..20).map(|i| format!("line {i}\n")).collect();
        write_commit(p, "old.txt", &body, "add old").await;
        git(p, &["mv", "old.txt", "new.txt"]).await;
        std::fs::write(p.join("new.txt"), format!("{body}extra\n")).unwrap();
        git(p, &["add", "-A"]).await;
        git(p, &["commit", "-m", "rename"]).await;
        let head = git(p, &["rev-parse", "HEAD"]).await;
        let diff = commit_file_diff_first_parent(p.to_str().unwrap(), &head, "new.txt")
            .await
            .unwrap();
        assert!(diff.contains("rename from old.txt"), "{diff}");
        assert!(diff.contains("rename to new.txt"), "{diff}");
        assert!(diff.contains("+extra"), "{diff}");
        assert!(!diff.contains("+line 0"), "{diff}");
    }

    // FR-016
    #[tokio::test]
    async fn containing_refs_skip_remote_head_alias() {
        let dir = repo().await;
        let p = dir.path();
        let head = git(p, &["rev-parse", "HEAD"]).await;
        git(p, &["update-ref", "refs/remotes/origin/main", &head]).await;
        git(
            p,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        )
        .await;
        let detail = commit_detail(&ctx(p), &head, true).await.unwrap();
        assert_eq!(
            detail.containing_refs,
            vec!["main".to_string(), "origin/main".to_string()]
        );
    }

    // FR-016
    #[tokio::test]
    async fn rejects_invalid_hash_and_path() {
        let dir = repo().await;
        let repo_path = dir.path().to_str().unwrap();
        let head = git(dir.path(), &["rev-parse", "HEAD"]).await;
        assert!(commit_detail(&ctx(dir.path()), "zz", false).await.is_err());
        assert!(
            commit_file_diff_first_parent(repo_path, "zz", "f")
                .await
                .is_err()
        );
        assert!(
            commit_file_diff_first_parent(repo_path, &head, "../x")
                .await
                .is_err()
        );
    }
}
