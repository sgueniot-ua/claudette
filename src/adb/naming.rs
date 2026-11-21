//! Name of the dedicated emulator (AVD) of a worktree, following the
//! `task-<project>-<branch>` convention.

use std::path::Path;

use crate::process::command;

const MAX_AVD_NAME_CHARS: usize = 60;

/// Replace every char outside `[A-Za-z0-9._-]` by `-`, then trim `-` at both ends.
pub fn slug(text: &str) -> String {
    let replaced: String = text
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    replaced.trim_matches('-').to_string()
}

pub fn dedicated_avd_name(project: &str, branch: &str) -> String {
    let name = format!("task-{}-{}", slug(project), slug(branch));
    name.chars().take(MAX_AVD_NAME_CHARS).collect()
}

/// Last path segment of a git remote URL, without a `.git` suffix.
pub fn project_key_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let key = last.strip_suffix(".git").unwrap_or(last);
    (!key.is_empty()).then(|| key.to_string())
}

async fn git_output(worktree: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = command("git");
    cmd.args(args).current_dir(worktree);
    crate::env::enriched_env().apply(&mut cmd);
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Dedicated AVD name for the branch currently checked out in `worktree`.
/// Reads origin and branch on every call; `None` on a detached HEAD or when
/// no project name can be derived.
pub async fn dedicated_avd_for_worktree(worktree: &Path) -> Option<String> {
    let branch = git_output(worktree, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    if branch == "HEAD" {
        return None;
    }
    let project = match git_output(worktree, &["remote", "get-url", "origin"])
        .await
        .and_then(|url| project_key_from_url(&url))
    {
        Some(p) => p,
        None => {
            let top = git_output(worktree, &["rev-parse", "--show-toplevel"]).await?;
            Path::new(&top).file_name()?.to_string_lossy().into_owned()
        }
    };
    Some(dedicated_avd_name(&project, &branch))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Assumption émulateur dédié
    #[test]
    fn avd_name_cases() {
        assert_eq!(
            dedicated_avd_name("claudette", "sgueniot-ua/worktree-adb-panel"),
            "task-claudette-sgueniot-ua-worktree-adb-panel"
        );
        assert_eq!(
            dedicated_avd_name("my app", "feat/été#1"),
            "task-my-app-feat--t--1"
        );
        assert_eq!(
            dedicated_avd_name("claudette", &format!("feat/{}", "a".repeat(80)))
                .chars()
                .count(),
            60
        );
        assert_eq!(slug("/feat/x/"), "feat-x");
    }

    #[test]
    fn project_key_cases() {
        assert_eq!(
            project_key_from_url("git@github.com:org/claudette.git"),
            Some("claudette".into())
        );
        assert_eq!(
            project_key_from_url("https://host/a/b/repo/"),
            Some("repo".into())
        );
    }

    async fn git(dir: &Path, args: &[&str]) {
        let out = command("git")
            .args(args)
            .current_dir(dir)
            .output()
            .await
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {out:?}");
    }

    // FR-007d
    #[tokio::test]
    async fn dedicated_avd_follows_checked_out_branch() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]).await;
        git(p, &["remote", "add", "origin", "git@x:o/demo.git"]).await;
        git(
            p,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "--allow-empty",
                "-q",
                "-m",
                "init",
            ],
        )
        .await;
        git(p, &["switch", "-c", "feat/a"]).await;
        assert_eq!(
            dedicated_avd_for_worktree(p).await,
            Some("task-demo-feat-a".into())
        );
        git(p, &["switch", "-c", "feat/b"]).await;
        assert_eq!(
            dedicated_avd_for_worktree(p).await,
            Some("task-demo-feat-b".into())
        );
        git(p, &["checkout", "--detach", "-q"]).await;
        assert_eq!(dedicated_avd_for_worktree(p).await, None);
    }
}
