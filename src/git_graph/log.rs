//! Topological commit log reader.

use crate::git::GitError;
use crate::git_graph::{MAX_COMMITS, run_git};
use crate::model::git_graph::GraphCommit;

/// Read up to `limit` commits reachable from `tips`, children before parents.
/// The boolean is `true` when more history remains beyond `limit`.
pub async fn read_commits(
    repo: &str,
    tips: &[String],
    limit: u32,
) -> Result<(Vec<GraphCommit>, bool), GitError> {
    if tips.is_empty() {
        return Ok((vec![], false));
    }
    let max_count = format!("--max-count={}", u64::from(limit) + 1);
    let mut args = vec![
        "log",
        "--topo-order",
        max_count.as_str(),
        "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e",
    ];
    args.extend(tips.iter().map(String::as_str));
    args.push("--");
    let out = run_git(repo, &args).await?;

    // Records end with 0x1e; git separates them with a newline, and `run_git`
    // trims the output, so only the leading newline of each record is dropped.
    let mut commits: Vec<GraphCommit> = out
        .split('\x1e')
        .filter_map(|record| parse_record(record.trim_start_matches(['\n', '\r'])))
        .collect();
    let has_more = commits.len() > limit as usize;
    commits.truncate(limit as usize);
    Ok((commits, has_more))
}

fn parse_record(record: &str) -> Option<GraphCommit> {
    if record.is_empty() {
        return None;
    }
    let mut fields = record.splitn(5, '\x1f');
    let hash = fields.next()?.to_string();
    let parents = fields.next()?;
    let author = fields.next()?.to_string();
    let date = fields.next()?.to_string();
    let subject = fields.next()?.to_string();
    Some(GraphCommit {
        short_hash: hash.chars().take(7).collect(),
        hash,
        parents: parents.split_whitespace().map(String::from).collect(),
        author,
        date,
        subject,
    })
}

/// 0-based index of `hash` (full hash or prefix of 4+ chars) within the first
/// `MAX_COMMITS` commits reachable from `tips`, or `None`.
pub async fn position_of(
    repo: &str,
    tips: &[String],
    hash: &str,
) -> Result<Option<usize>, GitError> {
    if tips.is_empty() || hash.len() < 4 {
        return Ok(None);
    }
    let max_count = format!("--max-count={MAX_COMMITS}");
    let mut args = vec!["log", "--topo-order", "--format=%H", max_count.as_str()];
    args.extend(tips.iter().map(String::as_str));
    args.push("--");
    let out = run_git(repo, &args).await?;
    Ok(out.lines().position(|line| line.starts_with(hash)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_graph::test_support::{commit, git, repo};

    fn p(dir: &tempfile::TempDir) -> &str {
        dir.path().to_str().unwrap()
    }

    // FR-001 FR-002
    #[tokio::test]
    async fn reads_commits_in_topo_order_with_fields() {
        let dir = repo().await;
        let d = dir.path();
        let init = git(d, &["rev-parse", "HEAD"]).await;
        git(d, &["checkout", "-b", "feat"]).await;
        let f1 = commit(d, "f1").await;
        git(d, &["checkout", "main"]).await;
        let c1 = commit(d, "c1").await;
        git(d, &["merge", "--no-ff", "feat", "-m", "merge feat"]).await;
        let merge = git(d, &["rev-parse", "HEAD"]).await;

        let (commits, has_more) = read_commits(p(&dir), &["main".to_string()], 50)
            .await
            .unwrap();
        assert!(!has_more);
        assert_eq!(commits.len(), 4);
        assert_eq!(commits[0].hash, merge);
        assert_eq!(commits[0].parents.len(), 2);
        assert_eq!(commits[0].parents[0], c1);
        assert_eq!(commits[0].parents[1], f1);
        assert_eq!(commits[0].subject, "merge feat");
        assert_eq!(commits[0].short_hash.len(), 7);
        assert_eq!(commits[0].short_hash, merge[..7]);
        assert_eq!(commits[0].author, "Test");
        assert!(commits[0].date.contains('T'));
        let root = commits.iter().find(|c| c.hash == init).unwrap();
        assert!(root.parents.is_empty());
        for (i, c) in commits.iter().enumerate() {
            for parent in &c.parents {
                let pi = commits.iter().position(|x| &x.hash == parent).unwrap();
                assert!(pi > i, "parent must come after child");
            }
        }
    }

    // FR-011
    #[tokio::test]
    async fn has_more_only_when_history_remains() {
        let dir = repo().await;
        for i in 0..4 {
            commit(dir.path(), &format!("c{i}")).await;
        }
        let tips = ["main".to_string()];
        let (all, more) = read_commits(p(&dir), &tips, 5).await.unwrap();
        assert_eq!(all.len(), 5);
        assert!(!more);
        let (some, more) = read_commits(p(&dir), &tips, 3).await.unwrap();
        assert_eq!(some.len(), 3);
        assert!(more);
        let (none, more) = read_commits(p(&dir), &[], 3).await.unwrap();
        assert!(none.is_empty());
        assert!(!more);
    }

    // Review Focus 2
    #[tokio::test]
    async fn subject_with_separators_and_empty_subject() {
        let dir = repo().await;
        let d = dir.path();
        let weird = "a|b\tc 🚀";
        commit(d, weird).await;
        git(
            d,
            &["commit", "--allow-empty", "--allow-empty-message", "-m", ""],
        )
        .await;
        let (commits, _) = read_commits(p(&dir), &["main".to_string()], 10)
            .await
            .unwrap();
        assert_eq!(commits[0].subject, "");
        assert_eq!(commits[1].subject, weird);
        assert_eq!(commits[2].subject, "initial");
        assert_eq!(commits[1].parents, vec![commits[2].hash.clone()]);
    }

    // FR-011
    #[tokio::test]
    async fn position_of_finds_commit_or_none() {
        let dir = repo().await;
        let d = dir.path();
        let oldest = git(d, &["rev-parse", "HEAD"]).await;
        for i in 0..3 {
            commit(d, &format!("c{i}")).await;
        }
        let tips = ["main".to_string()];
        assert_eq!(position_of(p(&dir), &tips, &oldest).await.unwrap(), Some(3));
        assert_eq!(
            position_of(p(&dir), &tips, &oldest[..8]).await.unwrap(),
            Some(3)
        );
        let unknown = "f".repeat(40);
        assert_eq!(position_of(p(&dir), &tips, &unknown).await.unwrap(), None);
    }

    // FR-004 SC-003
    #[tokio::test]
    async fn detached_head_tip_is_included() {
        let dir = repo().await;
        let d = dir.path();
        git(d, &["checkout", "--detach"]).await;
        let detached = commit(d, "detached work").await;
        git(d, &["checkout", "main"]).await;
        let (without, _) = read_commits(p(&dir), &["main".to_string()], 10)
            .await
            .unwrap();
        assert!(without.iter().all(|c| c.hash != detached));
        let tips = ["main".to_string(), detached.clone()];
        let (with, _) = read_commits(p(&dir), &tips, 10).await.unwrap();
        assert!(with.iter().any(|c| c.hash == detached));
    }
}
