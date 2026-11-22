import { useTranslation } from "react-i18next";
import type { Repository } from "../../types/repository";
import { ProjectChatsRow } from "./ProjectChatsRow";
import styles from "./Sidebar.module.css";

/** Status-mode "Project chats" section, pinned above the status groups: one
 *  row per local repo. `jumpNumberByRepoId` carries the ⌘1–9 slots. */
export function StatusProjectChatsSection({
  repos,
  jumpNumberByRepoId,
}: {
  repos: readonly Repository[];
  jumpNumberByRepoId: ReadonlyMap<string, number>;
}) {
  const { t } = useTranslation("sidebar");
  if (repos.length === 0) return null;
  return (
    <div className={styles.statusGroup}>
      <div className={styles.statusGroupHeader}>
        <span className={styles.repoName}>{t("project_chats_row")}</span>
      </div>
      {repos.map((repo) => (
        <ProjectChatsRow
          key={repo.id}
          repo={repo}
          showRepoName
          jumpNumber={jumpNumberByRepoId.get(repo.id)}
        />
      ))}
    </div>
  );
}
