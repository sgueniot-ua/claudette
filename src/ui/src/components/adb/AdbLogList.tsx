import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LogcatLine, LogLevel } from "../../types/adb";
import { adbLogBuffer, type AdbLogBuffer } from "./adbLogBuffer";
import { computeWindow } from "./virtualWindow";
import styles from "./AdbPanel.module.css";

export const ADB_ROW_HEIGHT = 20;
const OVERSCAN = 20;

const LEVEL_CLASS: Record<LogLevel, string> = {
  v: styles.levelV,
  d: styles.levelD,
  i: styles.levelI,
  w: styles.levelW,
  e: styles.levelE,
  f: styles.levelE,
  a: styles.levelE,
};

interface Props {
  workspaceId: string;
  // Re-render tick bumped when the buffer changes.
  version: number;
  // Absolute indexes of lines to highlight (search matches).
  highlight?: readonly number[];
  buffer?: AdbLogBuffer;
}

function LogRow({ line, top, highlighted }: { line: LogcatLine; top: number; highlighted: boolean }) {
  const levelClass = line.level ? LEVEL_CLASS[line.level] : styles.levelD;
  return (
    <div
      data-testid="adb-log-row"
      className={highlighted ? `${styles.row} ${styles.highlight}` : styles.row}
      style={{ top, height: ADB_ROW_HEIGHT, lineHeight: `${ADB_ROW_HEIGHT}px` }}
    >
      <span className={styles.meta}>
        {line.ts ?? ""} {line.pid ?? ""}/{line.tid ?? ""}{" "}
      </span>
      <span className={`${styles.level} ${levelClass}`}>{line.level?.toUpperCase() ?? ""}</span>{" "}
      <span className={styles.tag}>{line.tag ?? ""}</span>
      {": "}
      <span className={levelClass}>{line.message}</span>
    </div>
  );
}

export function AdbLogList({ workspaceId, version, highlight, buffer = adbLogBuffer }: Props) {
  const { t } = useTranslation("common");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  // Absolute index of the first fully-or-partly visible row while frozen.
  const anchorRef = useRef(0);
  const lastSpanRef = useRef({ first: 0, end: 0 });

  const first = buffer.firstIndex(workspaceId);
  const count = buffer.size(workspaceId);
  const highlighted = useMemo(() => new Set(highlight ?? []), [highlight]);

  const setFollow = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);

  const scrollToOffset = useCallback((el: HTMLDivElement, offset: number) => {
    el.scrollTop = offset;
    setScrollTop(el.scrollTop);
  }, []);

  // version is a re-render tick: it makes this effect re-sync with the buffer.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setViewport(el.clientHeight);
    const last = lastSpanRef.current;
    const end = first + count;
    // Absolute indexes restart at 0 on clear/reset: a new session resumes following.
    if (end < last.end || first < last.first) {
      followingRef.current = true;
      setFollowing(true);
    }
    lastSpanRef.current = { first, end };
    if (followingRef.current) {
      scrollToOffset(el, count * ADB_ROW_HEIGHT);
    } else {
      // Anchor on the absolute index so eviction does not shift the content.
      const offset = Math.max(0, anchorRef.current - first) * ADB_ROW_HEIGHT;
      scrollToOffset(el, offset);
    }
  }, [version, workspaceId, first, count, scrollToOffset]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const top = el.scrollTop;
    setScrollTop(top);
    const atBottom = count * ADB_ROW_HEIGHT - top - el.clientHeight <= ADB_ROW_HEIGHT;
    if (atBottom) {
      setFollow(true);
    } else {
      anchorRef.current = first + Math.floor(top / ADB_ROW_HEIGHT);
      setFollow(false);
    }
  };

  const resumeFollow = () => {
    const el = scrollRef.current;
    setFollow(true);
    if (el) {
      scrollToOffset(el, count * ADB_ROW_HEIGHT);
    }
  };

  const { start, end } = computeWindow({
    scrollTop,
    viewport,
    rowHeight: ADB_ROW_HEIGHT,
    total: count,
    overscan: OVERSCAN,
  });

  const rows = [];
  for (let offset = start; offset < end; offset += 1) {
    const absolute = first + offset;
    const line = buffer.get(workspaceId, absolute);
    if (line) {
      rows.push(
        <LogRow
          key={absolute}
          line={line}
          top={offset * ADB_ROW_HEIGHT}
          highlighted={highlighted.has(absolute)}
        />,
      );
    }
  }

  return (
    <div className={styles.logWrap}>
      <div ref={scrollRef} className={styles.logScroll} onScroll={onScroll} data-testid="adb-log-scroll">
        <div className={styles.logContent} style={{ height: count * ADB_ROW_HEIGHT }}>
          {rows}
        </div>
      </div>
      {!following && (
        <button type="button" className={styles.latest} onClick={resumeFollow}>
          {t("adb_latest_logs")}
        </button>
      )}
    </div>
  );
}
