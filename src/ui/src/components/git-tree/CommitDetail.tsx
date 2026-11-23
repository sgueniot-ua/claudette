import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadCommitDetail } from "../../services/tauri";
import { useAppStore } from "../../stores/useAppStore";
import type { CommitDetail as CommitDetailData, GraphWorktree } from "../../types/gitGraph";
import styles from "./GitTree.module.css";
import { CopyHashButton } from "./RefList";

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  type_changed: "T",
};

interface CommitDetailProps {
  workspaceId: string;
  hash: string;
  includeRemotes: boolean;
  worktrees: GraphWorktree[];
}

export function CommitDetail({ workspaceId, hash, includeRemotes, worktrees }: CommitDetailProps) {
  const { t } = useTranslation("sidebar");
  const openDiffTab = useAppStore((s) => s.openDiffTab);
  const setDiffSelectedCommitHash = useAppStore((s) => s.setDiffSelectedCommitHash);
  const [detail, setDetail] = useState<CommitDetailData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    loadCommitDetail(workspaceId, hash, includeRemotes)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, hash, includeRemotes]);

  if (failed) {
    return (
      <div className={styles.detail} data-testid="commit-detail">
        <div className={styles.stateMessage}>{t("gitTree.readError")}</div>
      </div>
    );
  }
  if (!detail) return <div className={styles.detail} data-testid="commit-detail" />;

  const worktreeName = (path: string) => {
    const w = worktrees.find((x) => x.path === path);
    return w?.workspace_name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  };
  const containing = [
    ...detail.containing_refs,
    ...detail.containing_worktrees.map(worktreeName),
  ];

  return (
    <div className={styles.detail} data-testid="commit-detail">
      <pre className={styles.message}>{detail.message}</pre>
      <div className={styles.detailMeta}>
        <span>{detail.author}</span>
        <span>{detail.date}</span>
        <code className={styles.hashFull}>{detail.hash}</code>
        <CopyHashButton hash={detail.hash} />
      </div>
      {containing.length > 0 && (
        <div className={styles.detailMeta}>
          <span>{t("gitTree.containedIn")}</span>
          {containing.map((name) => (
            <span key={name} className={styles.refLabel}>
              {name}
            </span>
          ))}
        </div>
      )}
      <div className={styles.filesTitle}>{t("gitTree.files")}</div>
      <ul className={styles.fileList}>
        {detail.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className={styles.fileButton}
              data-file-path={f.path}
              onClick={() => {
                setDiffSelectedCommitHash(detail.hash, "first-parent");
                openDiffTab(workspaceId, f.path, "committed");
              }}
            >
              <span className={styles.fileStatus} aria-hidden="true">
                {STATUS_LETTER[f.status] ?? "?"}
              </span>
              <span className={styles.srOnly}>
                {t(`gitTree.status.${f.status}`, { defaultValue: f.status })}{" "}
              </span>
              {f.path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
