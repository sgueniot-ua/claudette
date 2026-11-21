import { describe, expect, it } from "vitest";

import type { LogcatLine } from "../../types/adb";
import { createAdbLogBuffer } from "./adbLogBuffer";
import { findMatches, nextMatch, prevMatch } from "./adbLogSearch";

function entry(tag: string | null, message: string): LogcatLine {
  return { ts: null, pid: null, tid: null, level: null, tag, message };
}

describe("findMatches", () => {
  // FR-006c: the search is case-insensitive and covers the tag as well as the message.
  it("matches tag and message case-insensitively", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", [
      entry("ActivityManager", "Start proc com.example"),
      entry("OkHttp", "call ended"),
      entry("SystemUI", "activitymanager says hi"),
    ]);

    expect(findMatches(buf, "ws-1", "activitymanager")).toEqual([0, 2]);
  });

  // FR-006c: a match on the tag alone is still found.
  it("finds a query that only appears in the tag", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", [entry("ActivityManager", "unrelated"), entry("Other", "x")]);

    expect(findMatches(buf, "ws-1", "activity")).toEqual([0]);
  });

  // FR-006c: tag and message are searched field by field, so a query spanning
  // the boundary between them does not produce a false match.
  it("does not match a query that spans the tag and message boundary", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", [entry("ActivityManager", "start proc com.example")]);

    expect(findMatches(buf, "ws-1", "manager start")).toEqual([]);
    expect(findMatches(buf, "ws-1", "manager")).toEqual([0]);
    expect(findMatches(buf, "ws-1", "start")).toEqual([0]);
  });

  // FR-006c: a line with no tag is searched by message only.
  it("ignores a null tag without failing", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", [entry(null, "no tag here"), entry(null, "other")]);

    expect(findMatches(buf, "ws-1", "tag")).toEqual([0]);
  });

  // FR-006c: an empty query matches nothing, so the search bar stays idle.
  it("returns no matches for an empty query", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", [entry("A", "anything")]);

    expect(findMatches(buf, "ws-1", "")).toEqual([]);
  });

  // FR-006b + FR-006c: returned indexes are absolute, so they stay valid after eviction.
  it("returns absolute indexes after the oldest lines were evicted", () => {
    const buf = createAdbLogBuffer(2);
    buf.append("ws-1", [entry("T", "miss"), entry("T", "hit one"), entry("T", "hit two")]);

    expect(buf.firstIndex("ws-1")).toBe(1);
    expect(findMatches(buf, "ws-1", "hit")).toEqual([1, 2]);
  });

  // FR-004: a search only looks at the given workspace.
  it("searches only the given workspace", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-a", [entry("T", "needle")]);
    buf.append("ws-b", [entry("T", "needle"), entry("T", "needle")]);

    expect(findMatches(buf, "ws-a", "needle")).toEqual([0]);
    expect(findMatches(buf, "ws-b", "needle")).toEqual([0, 1]);
  });
});

describe("nextMatch", () => {
  // FR-006c: next moves forward through the matches.
  it("returns the first match after the current index", () => {
    expect(nextMatch([2, 5, 9], 2)).toBe(5);
    expect(nextMatch([2, 5, 9], 4)).toBe(5);
  });

  // FR-006c: next wraps from the last match back to the first.
  it("wraps from the last match to the first", () => {
    expect(nextMatch([2, 5, 9], 9)).toBe(2);
    expect(nextMatch([2, 5, 9], 7)).toBe(9);
  });

  // FR-006c: with no current position, next starts at the first match.
  it("starts at the first match when there is no current position", () => {
    expect(nextMatch([2, 5, 9], null)).toBe(2);
  });

  // FR-006c: no matches means nothing to navigate to.
  it("returns undefined when there are no matches", () => {
    expect(nextMatch([], 3)).toBeUndefined();
    expect(nextMatch([], null)).toBeUndefined();
  });
});

describe("prevMatch", () => {
  // FR-006c: previous moves backward through the matches.
  it("returns the last match before the current index", () => {
    expect(prevMatch([2, 5, 9], 9)).toBe(5);
    expect(prevMatch([2, 5, 9], 6)).toBe(5);
  });

  // FR-006c: previous wraps from the first match back to the last.
  it("wraps from the first match to the last", () => {
    expect(prevMatch([2, 5, 9], 2)).toBe(9);
    expect(prevMatch([2, 5, 9], 0)).toBe(9);
  });

  // FR-006c: with no current position, previous starts at the last match.
  it("starts at the last match when there is no current position", () => {
    expect(prevMatch([2, 5, 9], null)).toBe(9);
  });

  // FR-006c: no matches means nothing to navigate to.
  it("returns undefined when there are no matches", () => {
    expect(prevMatch([], 3)).toBeUndefined();
    expect(prevMatch([], null)).toBeUndefined();
  });
});
