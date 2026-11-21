import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/useAppStore";
import { adbSetAndroidMode } from "../../../services/adb";
import type { Repository } from "../../../types/repository";
import styles from "../Settings.module.css";

interface AndroidModeSettingProps {
  repo: Repository;
}

export function AndroidModeSetting({ repo }: AndroidModeSettingProps) {
  const { t } = useTranslation("settings");
  const enabled = useAppStore((s) => s.androidModeByRepo[repo.id] ?? false);
  const loadAndroidMode = useAppStore((s) => s.loadAndroidMode);
  const setAndroidMode = useAppStore((s) => s.setAndroidMode);
  const isRemote = repo.remote_connection_id !== null;

  useEffect(() => {
    if (isRemote) return;
    loadAndroidMode(repo.id).catch((err) => {
      console.error("Failed to load Android mode", err);
    });
  }, [isRemote, repo.id, loadAndroidMode]);

  if (isRemote) return null;

  const toggle = async (next: boolean) => {
    try {
      await adbSetAndroidMode(repo.id, next);
      setAndroidMode(repo.id, next);
    } catch (err) {
      console.error("Failed to save Android mode", err);
    }
  };

  return (
    <div className={styles.settingRow}>
      <div className={styles.settingInfo}>
        <div className={styles.settingLabel}>{t("repo_android_mode_label")}</div>
        <div className={styles.settingDescription}>
          {t("repo_android_mode_description")}
        </div>
      </div>
      <div className={styles.settingControl}>
        <input
          type="checkbox"
          checked={enabled}
          aria-label={t("repo_android_mode_label")}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </div>
    </div>
  );
}
