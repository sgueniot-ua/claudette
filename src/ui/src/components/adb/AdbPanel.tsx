import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { resolveHotkeyAction } from "../../hotkeys/bindings";
import { adbGetWorkspaceDevice, adbSetWorkspaceDevice } from "../../services/adb";
import { useAppStore } from "../../stores/useAppStore";
import type { AdbDevice, DeviceKey, ResolutionSource } from "../../types/adb";
import { adbLogBuffer } from "./adbLogBuffer";
import { findMatches, nextMatch, prevMatch } from "./adbLogSearch";
import { AdbLogList } from "./AdbLogList";
import styles from "./AdbPanel.module.css";

const SOURCE_KEY = {
  manual: "adb_source_manual",
  dedicated_emulator: "adb_source_dedicated_emulator",
  only_device: "adb_source_only_device",
} as const satisfies Record<ResolutionSource, string>;

function displayName(device: AdbDevice): string {
  return device.avd_name ?? device.model ?? device.serial;
}

// An emulator is chosen by AVD name when known, anything else by serial.
function keyForDevice(device: AdbDevice): DeviceKey {
  return device.avd_name
    ? { kind: "avd", value: device.avd_name }
    : { kind: "serial", value: device.serial };
}

function encodeKey(key: DeviceKey): string {
  return `${key.kind}:${key.value}`;
}

export function AdbPanel() {
  const { t } = useTranslation("common");
  const workspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const status = useAppStore((s) => (workspaceId ? s.adbSessions[workspaceId] : undefined));
  const devices = useAppStore((s) => s.adbDevices);
  const version = useAppStore((s) => (workspaceId ? (s.adbLogVersion[workspaceId] ?? 0) : 0));
  const keybindings = useAppStore((s) => s.keybindings);
  const setAdbSessionStatus = useAppStore((s) => s.setAdbSessionStatus);

  const [manualKey, setManualKey] = useState<DeviceKey | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<number | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const choiceMadeRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    choiceMadeRef.current = false;
    setManualKey(null);
    setSearchOpen(false);
    setQuery("");
    setCurrent(null);
    if (!workspaceId) {
      return;
    }
    let cancelled = false;
    adbGetWorkspaceDevice(workspaceId)
      .then((key) => {
        // A choice made meanwhile wins over this (stale) read.
        if (!cancelled && !choiceMadeRef.current) {
          setManualKey(key);
        }
      })
      .catch((e) => console.error("Failed to read the ADB device choice:", e));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const matches = useMemo(
    () => (workspaceId && searchOpen ? findMatches(adbLogBuffer, workspaceId, query) : []),
    // version is a tick: the buffer changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, searchOpen, query, version],
  );

  const reveal = useMemo(
    () => (current === null ? null : { index: current, tick: revealTick }),
    [current, revealTick],
  );

  if (!workspaceId) {
    return null;
  }

  const chooseDevice = (encoded: string) => {
    const key =
      encoded === ""
        ? null
        : (devices.map(keyForDevice).find((k) => encodeKey(k) === encoded) ?? null);
    if (encoded !== "" && !key) {
      return;
    }
    const previous = manualKey;
    choiceMadeRef.current = true;
    setManualKey(key);
    adbSetWorkspaceDevice(workspaceId, key)
      .then((next) => setAdbSessionStatus(workspaceId, next))
      .catch((e) => {
        console.error("Failed to set the ADB device:", e);
        setManualKey(previous);
      });
  };

  const openSearch = () => {
    setSearchOpen(true);
    searchRef.current?.focus();
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setCurrent(null);
    panelRef.current?.focus();
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (resolveHotkeyAction(e.nativeEvent, "adb", keybindings) === "adb.open-search") {
      e.preventDefault();
      e.stopPropagation();
      openSearch();
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = e.shiftKey ? prevMatch(matches, current) : nextMatch(matches, current);
      setCurrent(target ?? null);
      setRevealTick((n) => n + 1);
    }
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    setCurrent(findMatches(adbLogBuffer, workspaceId, value)[0] ?? null);
    setRevealTick((n) => n + 1);
  };

  const streamingName = status?.kind === "streaming" ? displayName(status.device) : null;
  const waitingDevice =
    status?.kind === "waiting"
      ? devices.find((d) => encodeKey(keyForDevice(d)) === encodeKey(status.device))
      : undefined;
  const waitingName =
    status?.kind === "waiting"
      ? waitingDevice
        ? displayName(waitingDevice)
        : status.device.value
      : null;
  const source = status?.kind === "streaming" ? status.source : null;

  let message: string | null = null;
  switch (status?.kind) {
    case "adb_missing":
      message = t("adb_missing");
      break;
    case "no_device":
      message = t("adb_no_device");
      break;
    case "needs_choice":
      message = t("adb_needs_choice");
      break;
    case "waiting":
      message =
        status.reason === "unauthorized"
          ? t("adb_waiting_unauthorized")
          : t("adb_waiting_disconnected", { device: waitingName });
      break;
    case "stopped":
      message = t("adb_stopped");
      break;
  }

  const selected = manualKey ? encodeKey(manualKey) : "";
  const missingChoice =
    manualKey && !devices.some((d) => encodeKey(keyForDevice(d)) === selected) ? manualKey : null;
  const showLogs = status?.kind === "streaming" || status?.kind === "waiting" || status?.kind === "stopped";

  return (
    <div ref={panelRef} className={styles.panel} tabIndex={-1} onKeyDown={onPanelKeyDown} data-testid="adb-panel">
      <div className={styles.header}>
        <span className={styles.deviceName}>{streamingName ?? waitingName ?? ""}</span>
        {source && <span className={styles.source}>{t(SOURCE_KEY[source])}</span>}
        {status && status.kind !== "adb_missing" && (
          <label className={styles.pickerLabel}>
            {t("adb_device_label")}
            <select
              className={styles.picker}
              value={selected}
              onChange={(e) => chooseDevice(e.target.value)}
            >
              <option value="">{t("adb_device_automatic")}</option>
              {missingChoice && (
                <option value={selected} disabled>
                  {t("adb_device_missing", { device: missingChoice.value })}
                </option>
              )}
              {devices.map((device) => (
                <option
                  key={device.serial}
                  value={encodeKey(keyForDevice(device))}
                  disabled={device.state.kind !== "device"}
                >
                  {displayName(device)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {message && <div className={styles.message}>{message}</div>}
      {searchOpen && (
        <div className={styles.search}>
          <input
            ref={searchRef}
            className={styles.searchInput}
            type="text"
            autoFocus
            value={query}
            placeholder={t("adb_search_placeholder")}
            aria-label={t("adb_search_placeholder")}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      )}
      {showLogs && (
        <AdbLogList workspaceId={workspaceId} version={version} highlight={matches} reveal={reveal} />
      )}
    </div>
  );
}
