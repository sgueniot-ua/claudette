//! Displayed refs (local branches, base branch, optional remotes) with ahead/behind counters.

use crate::git::GitError;
use crate::model::git_graph::{GraphRef, RefKind};

/// List the refs shown in the graph: the base first (if any), then local branches, then
/// remote branches (only when `include_remotes`), each group sorted by name.
pub async fn list_refs(
    repo: &str,
    base_ref: Option<&str>,
    include_remotes: bool,
) -> Result<Vec<GraphRef>, GitError> {
    let out = super::run_git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await?;

    let mut all: Vec<GraphRef> = out
        .lines()
        .filter_map(|line| {
            let (full, target) = line.split_once('\0')?;
            let (name, kind) = if let Some(n) = full.strip_prefix("refs/heads/") {
                (n, RefKind::Local)
            } else {
                (full.strip_prefix("refs/remotes/")?, RefKind::Remote)
            };
            if kind == RefKind::Remote && name.ends_with("/HEAD") {
                return None;
            }
            Some(GraphRef {
                name: name.to_string(),
                kind,
                target: target.to_string(),
                is_base: base_ref == Some(name),
                ahead: None,
                behind: None,
            })
        })
        .collect();

    if let Some(base) = base_ref
        && !all.iter().any(|r| r.is_base)
        && let Ok(target) = super::run_git(
            repo,
            &["rev-parse", "--verify", &format!("{base}^{{commit}}")],
        )
        .await
    {
        all.push(GraphRef {
            name: base.to_string(),
            kind: RefKind::Local,
            target,
            is_base: true,
            ahead: None,
            behind: None,
        });
    }

    // Base first, then locals, then remotes (only when requested), each sorted by name.
    all.retain(|r| r.is_base || include_remotes || r.kind == RefKind::Local);
    all.sort_by(|a, b| {
        let rank = |r: &GraphRef| match (r.is_base, &r.kind) {
            (true, _) => 0,
            (false, RefKind::Local) => 1,
            (false, RefKind::Remote) => 2,
        };
        rank(a).cmp(&rank(b)).then_with(|| a.name.cmp(&b.name))
    });

    if let Some(base) = base_ref
        && all.iter().any(|r| r.is_base)
    {
        fill_ahead_behind(repo, base, &mut all).await?;
    }
    Ok(all)
}

/// Fill `ahead`/`behind` (relative to `base_ref`) of local, non-base refs.
pub async fn fill_ahead_behind(
    repo: &str,
    base_ref: &str,
    refs: &mut [GraphRef],
) -> Result<(), GitError> {
    // `%(ahead-behind:)` needs git >= 2.41; fall back on any failure.
    if ahead_behind_for_each_ref(repo, base_ref, refs)
        .await
        .is_err()
    {
        return ahead_behind_fallback(repo, base_ref, refs).await;
    }
    Ok(())
}

/// Strict `for-each-ref %(ahead-behind:)` pass; leaves `refs` untouched on error.
async fn ahead_behind_for_each_ref(
    repo: &str,
    base_ref: &str,
    refs: &mut [GraphRef],
) -> Result<(), GitError> {
    let format = format!("--format=%(refname:lstrip=2)%00%(ahead-behind:{base_ref})");
    let out = super::run_git(repo, &["for-each-ref", &format, "refs/heads"]).await?;

    let mut counts = Vec::new();
    for line in out.lines() {
        let Some((name, raw)) = line.split_once('\0') else {
            continue;
        };
        let (ahead, behind) = parse_counts(raw).ok_or_else(|| {
            GitError::CommandFailed(format!("Unexpected ahead-behind output: {raw}"))
        })?;
        counts.push((name, ahead, behind));
    }
    for (name, ahead, behind) in counts {
        if let Some(r) = refs
            .iter_mut()
            .find(|r| r.kind == RefKind::Local && !r.is_base && r.name == name)
        {
            r.ahead = Some(ahead);
            r.behind = Some(behind);
        }
    }
    Ok(())
}

/// Same as [`fill_ahead_behind`] using one `rev-list --left-right --count` per ref.
pub(crate) async fn ahead_behind_fallback(
    repo: &str,
    base_ref: &str,
    refs: &mut [GraphRef],
) -> Result<(), GitError> {
    use futures::stream::{StreamExt, TryStreamExt};

    let counts: Vec<(usize, u32, u32)> = futures::stream::iter(
        refs.iter()
            .enumerate()
            .filter(|(_, r)| r.kind == RefKind::Local && !r.is_base)
            .map(|(i, r)| (i, r.name.clone())),
    )
    .map(|(i, name)| async move {
        let range = format!("{base_ref}...refs/heads/{name}");
        let out = super::run_git(repo, &["rev-list", "--left-right", "--count", &range]).await?;
        // Left side = in base only (behind), right side = in the ref only (ahead).
        let (behind, ahead) = parse_counts(&out)
            .ok_or_else(|| GitError::CommandFailed(format!("Unexpected rev-list output: {out}")))?;
        Ok::<_, GitError>((i, ahead, behind))
    })
    .buffer_unordered(8)
    .try_collect()
    .await?;

    for (i, ahead, behind) in counts {
        refs[i].ahead = Some(ahead);
        refs[i].behind = Some(behind);
    }
    Ok(())
}

/// Parse two whitespace-separated counters, e.g. `"2 3"`.
fn parse_counts(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    Some((a, b))
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{commit, git, repo};
    use super::*;

    /// Origin with `main` + `feat` (one commit each), cloned locally.
    async fn cloned() -> (tempfile::TempDir, tempfile::TempDir) {
        let origin = repo().await;
        git(origin.path(), &["checkout", "-b", "feat"]).await;
        commit(origin.path(), "feat work").await;
        git(origin.path(), &["checkout", "main"]).await;
        let parent = tempfile::tempdir().unwrap();
        git(
            parent.path(),
            &["clone", origin.path().to_str().unwrap(), "clone"],
        )
        .await;
        (origin, parent)
    }

    fn names(refs: &[GraphRef], kind: RefKind) -> Vec<&str> {
        refs.iter()
            .filter(|r| r.kind == kind)
            .map(|r| r.name.as_str())
            .collect()
    }

    // FR-003 FR-014
    #[tokio::test]
    async fn lists_local_refs_and_remotes_only_when_requested() {
        let (_origin, parent) = cloned().await;
        let clone = parent.path().join("clone");
        let clone = clone.to_str().unwrap();

        let refs = list_refs(clone, None, false).await.unwrap();
        assert_eq!(names(&refs, RefKind::Local), ["main"]);
        assert!(names(&refs, RefKind::Remote).is_empty());

        let refs = list_refs(clone, None, true).await.unwrap();
        assert_eq!(
            names(&refs, RefKind::Remote),
            ["origin/feat", "origin/main"]
        );
    }

    // FR-007
    #[tokio::test]
    async fn remote_base_always_present_and_marked() {
        let (_origin, parent) = cloned().await;
        let clone = parent.path().join("clone");
        let refs = list_refs(clone.to_str().unwrap(), Some("origin/main"), false)
            .await
            .unwrap();
        let bases: Vec<_> = refs.iter().filter(|r| r.is_base).collect();
        assert_eq!(bases.len(), 1);
        assert_eq!(bases[0].name, "origin/main");
        assert_eq!(bases[0].kind, RefKind::Remote);
        assert_eq!(names(&refs, RefKind::Remote), ["origin/main"]);
        assert_eq!(refs[0].name, "origin/main");

        // Included only once when remotes are listed too.
        let refs = list_refs(clone.to_str().unwrap(), Some("origin/main"), true)
            .await
            .unwrap();
        assert_eq!(refs.iter().filter(|r| r.name == "origin/main").count(), 1);
    }

    async fn diverged() -> tempfile::TempDir {
        let dir = repo().await;
        git(dir.path(), &["checkout", "-b", "feat"]).await;
        commit(dir.path(), "f1").await;
        commit(dir.path(), "f2").await;
        git(dir.path(), &["checkout", "main"]).await;
        for i in 0..3 {
            commit(dir.path(), &format!("m{i}")).await;
        }
        dir
    }

    // FR-017
    #[tokio::test]
    async fn ahead_behind_against_base() {
        let dir = diverged().await;
        let refs = list_refs(dir.path().to_str().unwrap(), Some("main"), false)
            .await
            .unwrap();
        assert_eq!(refs[0].name, "main");
        assert!(refs[0].is_base);
        assert_eq!((refs[0].ahead, refs[0].behind), (None, None));
        let feat = refs.iter().find(|r| r.name == "feat").unwrap();
        assert_eq!((feat.ahead, feat.behind), (Some(2), Some(3)));
    }

    // FR-017
    #[tokio::test]
    async fn fallback_gives_same_counts() {
        let dir = diverged().await;
        let repo = dir.path().to_str().unwrap();
        let mut a = list_refs(repo, Some("main"), false).await.unwrap();
        for r in &mut a {
            r.ahead = None;
            r.behind = None;
        }
        let mut b = a.clone();
        ahead_behind_for_each_ref(repo, "main", &mut a)
            .await
            .unwrap();
        ahead_behind_fallback(repo, "main", &mut b).await.unwrap();
        assert_eq!(a, b);
        let feat = a.iter().find(|r| r.name == "feat").unwrap();
        assert_eq!((feat.ahead, feat.behind), (Some(2), Some(3)));
    }

    // Review Focus 3
    #[tokio::test]
    async fn no_base_ref_leaves_counters_empty() {
        let dir = diverged().await;
        let refs = list_refs(dir.path().to_str().unwrap(), None, false)
            .await
            .unwrap();
        assert_eq!(refs.len(), 2);
        assert!(
            refs.iter()
                .all(|r| !r.is_base && r.ahead.is_none() && r.behind.is_none())
        );
    }

    // FR-007 FR-017
    #[tokio::test]
    async fn unresolvable_base_is_ignored() {
        let dir = diverged().await;
        let refs = list_refs(dir.path().to_str().unwrap(), Some("nope"), false)
            .await
            .unwrap();
        assert_eq!(refs.len(), 2);
        assert!(
            refs.iter()
                .all(|r| !r.is_base && r.ahead.is_none() && r.behind.is_none())
        );
    }
}
