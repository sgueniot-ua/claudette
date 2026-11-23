import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import type { GitGraph, WorktreeState, WorktreeStateEntry } from "../../types/gitGraph";
import styles from "./GitTree.module.css";
import { WorktreeBadge } from "./WorktreeBadge";

export function CopyHashButton({ hash }: { hash: string }) {
  const { t } = useTranslation("sidebar");
  return (
    <button
      type="button"
      className={styles.copyButton}
      title={t("gitTree.copyHash")}
      aria-label={t("gitTree.copyHash")}
      onClick={() => {
        void writeText(hash).catch(() => {});
      }}
    >
      ⧉
    </button>
  );
}

export function worktreeStateOf(
  path: string,
  fallback: WorktreeState,
  states: WorktreeStateEntry[],
): WorktreeState {
  return states.find((s) => s.path === path)?.state ?? fallback;
}

interface RefListProps {
  graph: GitGraph;
  worktreeStates: WorktreeStateEntry[];
  tooOldTarget: string | null;
  onGoToCommit: (hash: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function RefList({
  graph,
  worktreeStates,
  tooOldTarget,
  onGoToCommit,
  onSelectWorkspace,
}: RefListProps) {
  const { t } = useTranslation("sidebar");
  const refs = [...graph.refs].sort((a, b) => Number(b.is_base) - Number(a.is_base));
  const detachedWorktrees = graph.worktrees.filter((w) => w.branch === null);
  const badge = (w: (typeof graph.worktrees)[number]) => (
    <WorktreeBadge
      key={w.path}
      worktree={w}
      state={worktreeStateOf(w.path, w.state, worktreeStates)}
      onSelectWorkspace={onSelectWorkspace}
    />
  );
  return (
    <div className={styles.refList} data-testid="git-ref-list">
      {tooOldTarget !== null && (
        <div className={styles.banner} role="alert" data-testid="too-old-banner">
          <span>{t("gitTree.tooOld")}</span>
          <code className={styles.hashFull}>{tooOldTarget}</code>
          <CopyHashButton hash={tooOldTarget} />
        </div>
      )}
      {refs.map((r) => (
        <div key={`${r.kind}:${r.name}`} className={styles.refEntry} data-ref-entry>
          <button
            type="button"
            className={styles.refButton}
            onClick={() => onGoToCommit(r.target)}
          >
            <span className={r.kind === "remote" ? styles.refRemote : undefined}>{r.name}</span>
            {r.is_base && <span className={styles.baseTag}>{t("gitTree.base")}</span>}
            {(r.ahead !== null || r.behind !== null) && (
              <span className={styles.counters}>
                ↑{r.ahead ?? 0} ↓{r.behind ?? 0}
              </span>
            )}
          </button>
          {r.kind === "local" &&
            graph.worktrees.filter((w) => w.branch === r.name).map(badge)}
        </div>
      ))}
      {detachedWorktrees.map((w) => (
        <div key={w.path} className={styles.refEntry} data-ref-entry>
          <button
            type="button"
            className={styles.refButton}
            onClick={() => onGoToCommit(w.head)}
          >
            <span className={styles.counters}>{w.head.slice(0, 7)}</span>
          </button>
          {badge(w)}
        </div>
      ))}
    </div>
  );
}
