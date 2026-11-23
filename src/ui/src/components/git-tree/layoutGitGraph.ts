import type { GraphCommit } from "../../types/gitGraph";

export interface GraphRow {
  hash: string;
  column: number;
  incoming: number[];
  passThrough: number[];
  outgoing: number[];
  laneCount: number;
}

/** First free lane index; appends a new free lane when all are taken. */
function firstFree(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  if (free >= 0) return free;
  lanes.push(null);
  return lanes.length - 1;
}

/**
 * Assigns a column to each commit (topological order, newest first) using
 * active lanes without compaction. A parent that is not in `commits` keeps
 * its lane open to the last row.
 */
export function layoutGitGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const incoming = lanes.flatMap((h, i) => (h === c.hash ? [i] : []));
    const column = incoming[0] ?? firstFree(lanes);
    for (const i of incoming) lanes[i] = null;
    const passThrough = lanes.flatMap((h, i) => (h !== null ? [i] : []));
    const outgoing: number[] = [];
    c.parents.forEach((p, k) => {
      // First parent always continues the commit's own lane (lanes that
      // reach the same commit converge there); other parents reuse an
      // existing lane when one already waits for them.
      const existing = k === 0 ? -1 : lanes.indexOf(p);
      const lane = k === 0 ? column : existing >= 0 ? existing : firstFree(lanes);
      lanes[lane] = p;
      outgoing.push(lane);
    });
    rows.push({ hash: c.hash, column, incoming, passThrough, outgoing, laneCount: lanes.length });
  }
  return rows;
}
