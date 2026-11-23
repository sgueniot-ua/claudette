import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTimeAgo } from "../project/timeAgo";
import type {
  GitGraph,
  GraphCommit,
  GraphWorktree,
  WorktreeStateEntry,
} from "../../types/gitGraph";
import styles from "./GitTree.module.css";
import { layoutGitGraph, type GraphRow } from "./layoutGitGraph";
import { worktreeStateOf } from "./RefList";
import { WorktreeBadge } from "./WorktreeBadge";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const OVERSCAN = 6;
const FALLBACK_VIEWPORT = 400;
const MAX_INLINE_LABELS = 3;
const LANE_COLORS = [
  "var(--accent-primary)",
  "var(--purple-text)",
  "var(--status-running)",
  "var(--context-meter-warn)",
  "var(--mascot-pink)",
  "var(--status-idle)",
];
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

function LaneSvg({ row }: { row: GraphRow }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const mid = ROW_HEIGHT / 2;
  const width = Math.max(row.laneCount, row.column + 1) * LANE_WIDTH;
  return (
    <svg
      aria-hidden="true"
      className={styles.laneSvg}
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
    >
      {row.passThrough.map((lane) => (
        <g key={`p${lane}`} stroke={laneColor(lane)} strokeWidth={2} fill="none">
          <line x1={x(lane)} y1={0} x2={x(lane)} y2={mid} />
          <line x1={x(lane)} y1={mid} x2={x(lane)} y2={ROW_HEIGHT} />
        </g>
      ))}
      {row.incoming.map((lane) => (
        <line
          key={`i${lane}`}
          x1={x(lane)}
          y1={0}
          x2={x(row.column)}
          y2={mid}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {row.outgoing.map((lane) => (
        <line
          key={`o${lane}`}
          x1={x(row.column)}
          y1={mid}
          x2={x(lane)}
          y2={ROW_HEIGHT}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      <circle cx={x(row.column)} cy={mid} r={4} fill={laneColor(row.column)} />
    </svg>
  );
}

type Label =
  | { kind: "ref"; key: string; name: string; remote: boolean }
  | { kind: "worktree"; key: string; worktree: GraphWorktree };

function RowLabels({
  labels,
  worktreeStates,
  onSelectWorkspace,
}: {
  labels: Label[];
  worktreeStates: WorktreeStateEntry[];
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const { t } = useTranslation("sidebar");
  const [expanded, setExpanded] = useState(false);
  const hidden = labels.length - MAX_INLINE_LABELS;
  const renderLabel = (l: Label) =>
    l.kind === "ref" ? (
      <span
        key={l.key}
        data-ref-label
        className={l.remote ? styles.refLabelRemote : styles.refLabel}
      >
        {l.name}
      </span>
    ) : (
      <span key={l.key} data-ref-label>
        <WorktreeBadge
          worktree={l.worktree}
          state={worktreeStateOf(l.worktree.path, l.worktree.state, worktreeStates)}
          onSelectWorkspace={onSelectWorkspace}
        />
      </span>
    );
  return (
    <span className={styles.labels}>
      {labels.slice(0, MAX_INLINE_LABELS).map(renderLabel)}
      {hidden > 0 && (
        <button
          type="button"
          className={styles.moreLabels}
          data-testid="more-labels"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("gitTree.hideMoreLabels")
              : t("gitTree.showMoreLabels", { count: hidden })
          }
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "−" : t("gitTree.more", { count: hidden })}
        </button>
      )}
      {expanded && (
        <span className={styles.labelsPopover} data-testid="labels-popover">
          {labels.map(renderLabel)}
        </span>
      )}
    </span>
  );
}

interface GitGraphRowsProps {
  graph: GitGraph;
  selectedCommit: string | null;
  worktreeStates: WorktreeStateEntry[];
  onSelectCommit: (hash: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function GitGraphRows({
  graph,
  selectedCommit,
  worktreeStates,
  onSelectCommit,
  onSelectWorkspace,
}: GitGraphRowsProps) {
  const { commits } = graph;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const layout = useMemo(() => layoutGitGraph(commits), [commits]);
  const labelsByHash = useMemo(() => {
    const map = new Map<string, Label[]>();
    const push = (hash: string, label: Label) => {
      const list = map.get(hash);
      if (list) list.push(label);
      else map.set(hash, [label]);
    };
    for (const r of graph.refs) {
      push(r.target, {
        kind: "ref",
        key: `r:${r.kind}:${r.name}`,
        name: r.name,
        remote: r.kind === "remote",
      });
    }
    for (const w of graph.worktrees) {
      push(w.head, { kind: "worktree", key: `w:${w.path}`, worktree: w });
    }
    return map;
  }, [graph.refs, graph.worktrees]);

  useLayoutEffect(() => {
    const h = scrollRef.current?.clientHeight;
    if (h) setViewport(h);
  }, [commits]);

  // Bring a programmatically selected commit (ref click) into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || selectedCommit === null) return;
    const index = commits.findIndex((c) => c.hash === selectedCommit);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + viewport) {
      el.scrollTop = Math.max(0, top - ROW_HEIGHT);
      setScrollTop(el.scrollTop);
    }
  }, [selectedCommit, commits, viewport]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(commits.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

  const renderRow = (index: number) => {
    const c: GraphCommit = commits[index];
    const labels = labelsByHash.get(c.hash) ?? [];
    return (
      <div
        key={c.hash}
        role="listitem"
        tabIndex={0}
        data-commit-row={c.hash}
        aria-current={selectedCommit === c.hash ? "true" : undefined}
        className={`${styles.row} ${selectedCommit === c.hash ? styles.rowSelected : ""}`}
        style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
        onClick={() => onSelectCommit(c.hash)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) onSelectCommit(c.hash);
        }}
      >
        <LaneSvg row={layout[index]} />
        <RowLabels
          labels={labels}
          worktreeStates={worktreeStates}
          onSelectWorkspace={onSelectWorkspace}
        />
        <span className={styles.subject}>{c.subject}</span>
        <span className={styles.meta}>{c.author}</span>
        <span className={styles.meta}>{formatTimeAgo(c.date)}</span>
        <code className={styles.shortHash}>{c.short_hash}</code>
      </div>
    );
  };

  const rows = [];
  for (let i = start; i < end; i++) rows.push(renderRow(i));
  return (
    <div
      ref={scrollRef}
      className={styles.treeScroll}
      data-testid="git-graph-rows"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div
        role="list"
        className={styles.treeInner}
        style={{ height: commits.length * ROW_HEIGHT }}
      >
        {rows}
      </div>
    </div>
  );
}
