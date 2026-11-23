import { describe, it, expect } from "vitest";
import type { GraphCommit } from "../../types/gitGraph";
import { layoutGitGraph } from "./layoutGitGraph";

function c(hash: string, parents: string[] = []): GraphCommit {
  return {
    hash,
    short_hash: hash.slice(0, 7),
    parents,
    author: "a",
    date: "2026-01-01T00:00:00Z",
    subject: hash,
  };
}

describe("layoutGitGraph", () => {
  // FR-001
  it("puts a linear history in column 0", () => {
    const rows = layoutGitGraph([c("a", ["b"]), c("b", ["c"]), c("c")]);
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0]);
    expect(rows[0].outgoing).toEqual([0]);
    expect(rows[1].incoming).toEqual([0]);
    expect(rows[2].outgoing).toEqual([]);
  });

  // FR-001
  it("gives a merge commit two outgoing lanes", () => {
    const rows = layoutGitGraph([
      c("m", ["p1", "p2"]),
      c("p1", ["b"]),
      c("p2", ["b"]),
      c("b"),
    ]);
    expect(rows[0].outgoing).toHaveLength(2);
    expect(rows[0].outgoing).toEqual([0, 1]);
    expect(rows[1].column).toBe(0);
    expect(rows[1].passThrough).toEqual([1]);
    expect(rows[2].column).toBe(1);
  });

  // FR-001
  it("places a second head in column 1 and rejoins at the shared parent", () => {
    const rows = layoutGitGraph([c("h1", ["p"]), c("h2", ["p"]), c("p")]);
    expect(rows[0].column).toBe(0);
    expect(rows[1].column).toBe(1);
    expect(rows[2].column).toBe(0);
    expect(rows[2].incoming).toHaveLength(2);
  });

  // FR-011
  it("keeps the lane open to the bottom when a parent is not loaded", () => {
    const rows = layoutGitGraph([c("a", ["missing"]), c("b", ["c"]), c("c")]);
    expect(rows[0].outgoing).toEqual([0]);
    expect(rows[1].column).toBe(1);
    expect(rows[1].passThrough).toEqual([0]);
    expect(rows[2].passThrough).toEqual([0]);
    expect(rows[2].laneCount).toBe(2);
  });
});
