import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/useAppStore";
import { listWorkspaceBranches } from "../../services/tauri";
import { createWorkspaceOrchestrated } from "../../hooks/useCreateWorkspace";
import type { BranchRef, WorkspaceBranch } from "../../types/workspace";
import { Modal } from "./Modal";
import shared from "./shared.module.css";
import styles from "./NewWorkspaceModal.module.css";

type Tab = "new" | "existing";

/** Display form of a branch: `remote/name` for remote branches. */
function label(ref: BranchRef): string {
  return ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
}

/** Stable option value for a branch (a remote name can't contain `:`). */
function key(ref: BranchRef): string {
  return `${ref.remote ?? "local"}:${ref.name}`;
}

export function NewWorkspaceModal() {
  const { t } = useTranslation("modals");
  const { t: tCommon } = useTranslation("common");
  const closeModal = useAppStore((s) => s.closeModal);
  const addToast = useAppStore((s) => s.addToast);
  const modalData = useAppStore((s) => s.modalData);
  const repoId = modalData.repoId as string;
  const baseBranch = useAppStore(
    (s) => s.repositories.find((r) => r.id === repoId)?.base_branch ?? null,
  );

  const [tab, setTab] = useState<Tab>("new");
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [baseKey, setBaseKey] = useState<string | null>(null);
  // The settings branch prefix is not exposed to the frontend, so the
  // new-branch name starts empty.
  const [newName, setNewName] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let fetchedLanded = false;
    // Fast local listing first, then a fetching pass that replaces it.
    listWorkspaceBranches(repoId, false)
      .then((list) => {
        // The fetched list may already have landed; never overwrite it.
        if (!cancelled && !fetchedLanded) setBranches(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    listWorkspaceBranches(repoId, true)
      .then((list) => {
        if (cancelled) return;
        fetchedLanded = true;
        setBranches(list);
        setLoading(false);
      })
      .catch(() => {
        // Offline or no remote: keep the local list.
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const defaultBaseKey = useMemo(() => {
    const match =
      branches.find((b) => baseBranch && label(b.branch) === baseBranch) ??
      branches.find((b) => baseBranch && b.branch.name === baseBranch) ??
      branches[0];
    return match ? key(match.branch) : null;
  }, [branches, baseBranch]);

  const effectiveBaseKey = baseKey ?? defaultBaseKey;
  const base = branches.find((b) => key(b.branch) === effectiveBaseKey);

  const needle = search.trim().toLowerCase();
  const visible = branches.filter(
    (b) => !needle || label(b.branch).toLowerCase().includes(needle),
  );
  const selected = branches.find(
    (b) => key(b.branch) === selectedKey && !b.checked_out_at,
  );

  const trimmedName = newName.trim();
  const canCreate =
    tab === "new" ? trimmedName !== "" && !!base : selected !== undefined;

  const handleCreate = () => {
    const source =
      tab === "new"
        ? base && {
            kind: "new_branch" as const,
            base: base.branch,
            branch: trimmedName,
          }
        : selected && {
            kind: "existing_branch" as const,
            branch: selected.branch,
          };
    if (!source) return;
    closeModal();
    createWorkspaceOrchestrated(repoId, { source }).catch((e) => {
      addToast(
        t("new_workspace_failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    });
  };

  return (
    <Modal title={t("new_workspace_title")} onClose={closeModal} wide>
      <div className={styles.tabs} role="tablist">
        {(["new", "existing"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab}
            onClick={() => setTab(id)}
          >
            {t(id === "new" ? "new_workspace_tab_new" : "new_workspace_tab_existing")}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <>
          <div className={shared.field}>
            <label className={shared.label}>{t("new_workspace_base")}</label>
            <select
              className={shared.input}
              value={effectiveBaseKey ?? ""}
              onChange={(e) => setBaseKey(e.target.value)}
            >
              {branches.map((b) => (
                <option key={key(b.branch)} value={key(b.branch)}>
                  {label(b.branch)}
                </option>
              ))}
            </select>
          </div>
          <div className={shared.field}>
            <label className={shared.label}>
              {t("new_workspace_branch_name")}
            </label>
            <input
              type="text"
              className={shared.input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("new_workspace_branch_placeholder")}
              autoFocus
            />
          </div>
        </>
      )}

      {tab === "existing" && (
        <>
          <input
            type="text"
            className={shared.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("new_workspace_search")}
          />
          <div className={styles.list}>
            {loading && (
              <div className={styles.empty}>{t("new_workspace_loading")}</div>
            )}
            {!loading && visible.length === 0 && (
              <div className={styles.empty}>{t("new_workspace_no_branches")}</div>
            )}
            {visible.map((b) => {
              const k = key(b.branch);
              const busy = b.checked_out_at !== null;
              return (
                <button
                  key={k}
                  type="button"
                  className={k === selectedKey ? styles.rowSelected : styles.row}
                  disabled={busy}
                  title={b.checked_out_at ?? undefined}
                  onClick={() => setSelectedKey(k)}
                >
                  <span className={styles.rowName}>{label(b.branch)}</span>
                  {busy && (
                    <span className={styles.badge}>
                      {t("new_workspace_already_open")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <div className={shared.error}>{error}</div>}

      <div className={shared.actions}>
        <button className={shared.btn} onClick={closeModal}>
          {tCommon("cancel")}
        </button>
        <button
          className={shared.btnPrimary}
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {t("new_workspace_create")}
        </button>
      </div>
    </Modal>
  );
}
