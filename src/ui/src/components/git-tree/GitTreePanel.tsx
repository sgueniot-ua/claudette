import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/useAppStore";
import { CommitDetail } from "./CommitDetail";
import { GitGraphRows } from "./GitGraphRows";
import styles from "./GitTree.module.css";
import { RefList } from "./RefList";
import { useGitGraph } from "./useGitGraph";

const SKELETON_ROWS = 8;

export function GitTreePanel() {
  const { t } = useTranslation("sidebar");
  const workspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const g = useGitGraph(workspaceId, true);
  const { graph } = g;

  return (
    <div className={styles.panel}>
      <label className={styles.toolbar}>
        <input
          type="checkbox"
          checked={g.includeRemotes}
          onChange={(e) => g.setIncludeRemotes(e.target.checked)}
        />
        {t("gitTree.showRemotes")}
      </label>
      {g.status === "loading" && (
        <div className={styles.skeleton} data-testid="git-tree-skeleton">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      )}
      {g.status === "empty" && <div className={styles.stateMessage}>{t("gitTree.noCommits")}</div>}
      {g.status === "unsupported" && (
        <div className={styles.stateMessage}>{t("gitTree.unsupported")}</div>
      )}
      {g.status === "error" && (
        <div className={styles.stateMessage} role="alert">
          <div>{t("gitTree.readError")}</div>
          {g.error && <div className={styles.errorDetail}>{g.error}</div>}
          <button type="button" className={styles.actionButton} onClick={g.retry}>
            {t("gitTree.retry")}
          </button>
        </div>
      )}
      {g.status === "ready" && graph && (
        <>
          <RefList
            graph={graph}
            worktreeStates={g.worktreeStates}
            tooOldTarget={g.tooOldTarget}
            onGoToCommit={g.goToCommit}
            onSelectWorkspace={selectWorkspace}
          />
          <GitGraphRows
            graph={graph}
            selectedCommit={g.selectedCommit}
            worktreeStates={g.worktreeStates}
            onSelectCommit={g.selectCommit}
            onSelectWorkspace={selectWorkspace}
          />
          <div className={styles.footer}>
            {g.canLoadMore && (
              <button type="button" className={styles.actionButton} onClick={g.loadMore}>
                {t("gitTree.loadMore")}
              </button>
            )}
            {!g.canLoadMore && g.atCap && <span>{t("gitTree.limitReached")}</span>}
          </div>
          {g.selectedCommit && workspaceId && (
            <CommitDetail
              workspaceId={workspaceId}
              hash={g.selectedCommit}
              includeRemotes={g.includeRemotes}
              worktrees={graph.worktrees}
            />
          )}
        </>
      )}
    </div>
  );
}
