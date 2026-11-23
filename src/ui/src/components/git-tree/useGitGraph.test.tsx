// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraph, GraphCommit } from "../../types/gitGraph";

vi.mock("../../services/tauri", () => ({
  loadGitGraph: vi.fn(),
  loadGitGraphFingerprint: vi.fn(),
  loadWorktreeStates: vi.fn(),
  isUnsupportedHostError: (e: unknown) =>
    (e instanceof Error ? e.message : String(e)).startsWith("Unknown method:"),
}));

import * as svc from "../../services/tauri";
import { useGitGraph } from "./useGitGraph";

const loadGitGraph = vi.mocked(svc.loadGitGraph);
const loadFingerprint = vi.mocked(svc.loadGitGraphFingerprint);
const loadStates = vi.mocked(svc.loadWorktreeStates);

function commit(i: number): GraphCommit {
  return {
    hash: `h${i}`,
    short_hash: `h${i}`,
    parents: [],
    author: "a",
    date: "2026-01-01",
    subject: `s${i}`,
  };
}

function makeGraph(over: Partial<GitGraph> & { count?: number } = {}): GitGraph {
  const { count = 3, ...rest } = over;
  return {
    commits: Array.from({ length: count }, (_, i) => commit(i)),
    refs: [],
    worktrees: [],
    base_ref: null,
    has_more: true,
    limit: 200,
    target_beyond_cap: false,
    fingerprint: "fp1",
    ...rest,
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useGitGraph>;
const roots: Array<() => void> = [];

function renderHook<P>(useHook: (props: P) => HookResult, opts?: { initialProps: P }) {
  const result = { current: undefined as unknown as HookResult };
  function Probe({ props }: { props: P }) {
    result.current = useHook(props);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (props: P) =>
    act(() => root.render(createElement(Probe, { props })));
  render(opts?.initialProps as P);
  roots.push(() => act(() => root.unmount()));
  return { result, rerender: render };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useGitGraph", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadGitGraph.mockReset();
    loadFingerprint.mockReset();
    loadStates.mockReset();
    loadStates.mockResolvedValue([]);
    loadFingerprint.mockResolvedValue({ fingerprint: "fp1" });
    loadGitGraph.mockImplementation(async (_w, _r, limit) =>
      makeGraph({ limit }),
    );
  });
  afterEach(() => {
    roots.splice(0).forEach((unmount) => unmount());
    vi.useRealTimers();
  });

  // FR-011
  it("loads more by 200 and stops at 10 000", async () => {
    const { result } = renderHook(() => useGitGraph("w1", true));
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.atCap).toBe(false);
    act(() => result.current.loadMore());
    await flush();
    expect(loadGitGraph).toHaveBeenLastCalledWith("w1", true, 400, undefined);
    for (let i = 0; i < 60; i++) {
      act(() => result.current.loadMore());
      await flush();
    }
    expect(loadGitGraph).toHaveBeenLastCalledWith("w1", true, 10_000, undefined);
    expect(result.current.atCap).toBe(true);
    expect(result.current.canLoadMore).toBe(false);
    const calls = loadGitGraph.mock.calls.length;
    act(() => result.current.loadMore());
    await flush();
    expect(loadGitGraph.mock.calls.length).toBe(calls);
  });

  // FR-011
  it("goToCommit widens the graph or flags a too-old commit", async () => {
    const { result } = renderHook(() => useGitGraph("w1", true));
    await flush();
    loadGitGraph.mockResolvedValueOnce(
      makeGraph({ count: 5, limit: 600, fingerprint: "fp1" }),
    );
    act(() => result.current.goToCommit("h4"));
    await flush();
    expect(loadGitGraph).toHaveBeenLastCalledWith("w1", true, 200, "h4");
    expect(result.current.selectedCommit).toBe("h4");
    expect(result.current.tooOldTarget).toBeNull();

    loadGitGraph.mockResolvedValueOnce(
      makeGraph({ limit: 10_000, target_beyond_cap: true }),
    );
    act(() => result.current.goToCommit("deadbeef"));
    await flush();
    expect(result.current.tooOldTarget).toBe("deadbeef");
    expect(result.current.selectedCommit).toBeNull();
    act(() => result.current.dismissTooOld());
    expect(result.current.tooOldTarget).toBeNull();
  });

  // FR-012 SC-004
  it("reloads only when the fingerprint changes", async () => {
    renderHook(() => useGitGraph("w1", true));
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(1);
    loadFingerprint.mockResolvedValue({ fingerprint: "fp2" });
    loadGitGraph.mockResolvedValueOnce(makeGraph({ fingerprint: "fp2" }));
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(2);
  });

  // FR-011 FR-012
  it("keeps a pending loadMore or goToCommit when the fingerprint changes", async () => {
    const { result } = renderHook(() => useGitGraph("w1", true));
    await flush();
    loadFingerprint.mockResolvedValue({ fingerprint: "fp2" });

    let resolveMore: (g: GitGraph) => void = () => {};
    loadGitGraph.mockImplementationOnce(
      () => new Promise<GitGraph>((r) => (resolveMore = r)),
    );
    act(() => result.current.loadMore());
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveMore(makeGraph({ limit: 400, fingerprint: "fp1" }));
    });
    await flush();
    expect(result.current.graph?.limit).toBe(400);

    let resolveGo: (g: GitGraph) => void = () => {};
    loadGitGraph.mockImplementationOnce(
      () => new Promise<GitGraph>((r) => (resolveGo = r)),
    );
    act(() => result.current.goToCommit("zzz"));
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(3);
    await act(async () => {
      resolveGo(makeGraph({ limit: 400, target_beyond_cap: true }));
    });
    await flush();
    expect(result.current.tooOldTarget).toBe("zzz");
  });

  // FR-009 SC-006
  it("reads worktree states on mount then every 10 s", async () => {
    loadStates.mockResolvedValue([{ path: "/a", state: "dirty" }]);
    const { result, rerender } = renderHook(
      ({ active }) => useGitGraph("w1", active),
      { initialProps: { active: true } },
    );
    await flush();
    expect(loadStates).toHaveBeenCalledTimes(1);
    expect(result.current.worktreeStates).toEqual([{ path: "/a", state: "dirty" }]);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(loadStates).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(loadStates).toHaveBeenCalledTimes(2);
  });

  // Review Focus 4
  it("stale response for previous workspace is dropped", async () => {
    let resolveOld: (g: GitGraph) => void = () => {};
    loadGitGraph.mockImplementationOnce(
      () => new Promise<GitGraph>((r) => (resolveOld = r)),
    );
    const { result, rerender } = renderHook(
      ({ id }) => useGitGraph(id, true),
      { initialProps: { id: "w1" } },
    );
    rerender({ id: "w2" });
    await flush();
    expect(result.current.graph?.fingerprint).toBe("fp1");
    await act(async () => {
      resolveOld(makeGraph({ fingerprint: "old" }));
    });
    await flush();
    expect(result.current.graph?.fingerprint).toBe("fp1");
  });

  // FR-015
  it("goes unsupported on Unknown method", async () => {
    loadGitGraph.mockRejectedValue(new Error("Unknown method: load_git_graph"));
    const { result } = renderHook(() => useGitGraph("w1", true));
    await flush();
    expect(result.current.status).toBe("unsupported");
    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    await flush();
    expect(loadGitGraph).toHaveBeenCalledTimes(1);
    expect(loadFingerprint).not.toHaveBeenCalled();
  });

  // Edge : dépôt vide / erreur
  it("reports empty and error states, retry reloads", async () => {
    loadGitGraph.mockResolvedValueOnce(makeGraph({ count: 0, has_more: false }));
    const { result } = renderHook(() => useGitGraph("w1", true));
    await flush();
    expect(result.current.status).toBe("empty");

    loadGitGraph.mockRejectedValueOnce(new Error("boom"));
    act(() => result.current.setIncludeRemotes(false));
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("boom");
    act(() => result.current.retry());
    await flush();
    expect(result.current.status).toBe("ready");
  });
});
