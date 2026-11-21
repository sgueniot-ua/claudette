import { describe, expect, it } from "vitest";

import type { LogcatLine } from "../../types/adb";
import { createAdbLogBuffer } from "./adbLogBuffer";

function line(message: string): LogcatLine {
  return { ts: null, pid: null, tid: null, level: null, tag: null, message };
}

function numbered(count: number, prefix = "line"): LogcatLine[] {
  return Array.from({ length: count }, (_, i) => line(`${prefix} ${i}`));
}

describe("createAdbLogBuffer", () => {
  // FR-006b: at most 50 000 lines per workspace, the oldest ones leave first.
  it("caps a workspace at 50 000 lines and evicts the oldest", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-1", numbered(50_010));

    expect(buf.size("ws-1")).toBe(50_000);
    expect(buf.evicted("ws-1")).toBe(10);
    expect(buf.firstIndex("ws-1")).toBe(10);
    // The first retained line is the 11th one appended (index 10).
    expect(buf.get("ws-1", 10)?.message).toBe("line 10");
    expect(buf.get("ws-1", 9)).toBeUndefined();
    expect(buf.get("ws-1", 50_009)?.message).toBe("line 50009");
    expect(buf.get("ws-1", 50_010)).toBeUndefined();
  });

  // FR-006b: the eviction counter is cumulative across several appends.
  it("accumulates the evicted counter across appends", () => {
    const buf = createAdbLogBuffer(3);
    buf.append("ws-1", numbered(2));
    expect(buf.evicted("ws-1")).toBe(0);

    buf.append("ws-1", numbered(4, "b"));
    expect(buf.size("ws-1")).toBe(3);
    expect(buf.evicted("ws-1")).toBe(3);
    expect(buf.get("ws-1", 3)?.message).toBe("b 1");
    expect(buf.get("ws-1", 5)?.message).toBe("b 3");
  });

  // FR-004: each workspace keeps its own buffer.
  it("keeps the buffers of two workspaces independent", () => {
    const buf = createAdbLogBuffer(2);
    buf.append("ws-a", [line("a0"), line("a1"), line("a2")]);
    buf.append("ws-b", [line("b0")]);

    expect(buf.size("ws-a")).toBe(2);
    expect(buf.evicted("ws-a")).toBe(1);
    expect(buf.size("ws-b")).toBe(1);
    expect(buf.evicted("ws-b")).toBe(0);
    expect(buf.get("ws-b", 0)?.message).toBe("b0");
    expect(buf.get("ws-a", 0)).toBeUndefined();
  });

  // FR-004: an unknown workspace reads as empty.
  it("reports an empty buffer for a workspace never appended to", () => {
    const buf = createAdbLogBuffer();
    expect(buf.size("unknown")).toBe(0);
    expect(buf.evicted("unknown")).toBe(0);
    expect(buf.firstIndex("unknown")).toBe(0);
    expect(buf.get("unknown", 0)).toBeUndefined();
  });

  // FR-006b: reset empties the workspace buffer before the new lines land.
  it("drops the previous lines when append is called with reset", () => {
    const buf = createAdbLogBuffer(3);
    buf.append("ws-1", numbered(5));
    buf.append("ws-1", [line("fresh")], true);

    expect(buf.size("ws-1")).toBe(1);
    expect(buf.evicted("ws-1")).toBe(0);
    expect(buf.get("ws-1", 0)?.message).toBe("fresh");
  });

  // FR-004: clear empties one workspace and leaves the others untouched.
  it("clears only the given workspace", () => {
    const buf = createAdbLogBuffer();
    buf.append("ws-a", numbered(3));
    buf.append("ws-b", numbered(2));

    buf.clear("ws-a");

    expect(buf.size("ws-a")).toBe(0);
    expect(buf.evicted("ws-a")).toBe(0);
    expect(buf.get("ws-a", 0)).toBeUndefined();
    expect(buf.size("ws-b")).toBe(2);
  });

  // FR-006b: absolute indexes stay stable after eviction, so a match index
  // recorded earlier still points at the same line while it is retained.
  it("keeps absolute indexes stable after eviction", () => {
    const buf = createAdbLogBuffer(2);
    buf.append("ws-1", [line("x0"), line("x1")]);
    buf.append("ws-1", [line("x2")]);

    expect(buf.firstIndex("ws-1")).toBe(1);
    expect(buf.get("ws-1", 1)?.message).toBe("x1");
    expect(buf.get("ws-1", 2)?.message).toBe("x2");
  });

  // FR-006b
  it("bumps the generation on clear and on reset append only", () => {
    const buf = createAdbLogBuffer(10);
    expect(buf.generation("ws-1")).toBe(0);
    buf.append("ws-1", [line("a")]);
    expect(buf.generation("ws-1")).toBe(0);
    buf.append("ws-1", [line("b")], true);
    expect(buf.generation("ws-1")).toBe(1);
    buf.clear("ws-1");
    expect(buf.generation("ws-1")).toBe(2);
    expect(buf.generation("ws-2")).toBe(0);
  });
});
