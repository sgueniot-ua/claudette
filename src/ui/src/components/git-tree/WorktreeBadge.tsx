import { useTranslation } from "react-i18next";
import type { GraphWorktree, WorktreeState } from "../../types/gitGraph";
import styles from "./GitTree.module.css";

interface WorktreeBadgeProps {
  worktree: GraphWorktree;
  /** Live state (polled); falls back to the graph's own snapshot. */
  state: WorktreeState;
  onSelectWorkspace: (workspaceId: string) => void;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function WorktreeBadge({ worktree, state, onSelectWorkspace }: WorktreeBadgeProps) {
  const { t } = useTranslation("sidebar");
  const missing = state === "missing";
  const isClaudette = worktree.workspace_id !== null;
  const name = worktree.is_main
    ? t("gitTree.mainCheckout")
    : (worktree.workspace_name ?? folderName(worktree.path));
  const detached = worktree.branch === null;
  const kind = isClaudette || worktree.is_main ? "claudette" : "external";
  const title = missing
    ? t("gitTree.folderNotFound")
    : kind === "external"
      ? t("gitTree.notClaudette", { path: worktree.path })
      : undefined;
  const className = [
    styles.worktreeBadge,
    kind === "external" ? styles.worktreeExternal : styles.worktreeClaudette,
    missing ? styles.worktreeMissing : "",
  ].join(" ");
  const content = (
    <>
      {name}
      {detached && <span className={styles.worktreeSuffix}> ({t("gitTree.detached")})</span>}
      {missing && <span className={styles.srOnly}> — {t("gitTree.folderNotFound")}</span>}
      {state === "dirty" && (
        <span
          className={styles.dirtyDot}
          data-testid="worktree-dirty"
          title={t("gitTree.uncommitted")}
        >
          <span className={styles.srOnly}>{t("gitTree.uncommitted")}</span>
        </span>
      )}
    </>
  );
  const common = {
    className,
    title,
    "data-worktree-kind": kind,
    "data-worktree-state": state,
  };
  const workspaceId = worktree.workspace_id;
  if (!missing && workspaceId !== null) {
    return (
      <button
        type="button"
        {...common}
        onClick={(e) => {
          e.stopPropagation();
          onSelectWorkspace(workspaceId);
        }}
      >
        {content}
      </button>
    );
  }
  return <span {...common}>{content}</span>;
}
