import { useCallback, useEffect, useRef, useState } from "react";
import {
  isUnsupportedHostError,
  loadGitGraph,
  loadGitGraphFingerprint,
  loadWorktreeStates,
} from "../../services/tauri";
import type { GitGraph, WorktreeStateEntry } from "../../types/gitGraph";
import { workspaceRefreshPollingAllowed } from "../../utils/pollingIntervals";
import {
  FINGERPRINT_INTERVAL_MS,
  MAX_COMMITS,
  PAGE_SIZE,
  WORKTREE_STATE_INTERVAL_MS,
} from "./constants";

export type GitGraphStatus = "loading" | "ready" | "empty" | "error" | "unsupported";

export function useGitGraph(workspaceId: string | null, active: boolean) {
  const [graph, setGraph] = useState<GitGraph | null>(null);
  const [status, setStatus] = useState<GitGraphStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [includeRemotes, setIncludeRemotes] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [tooOldTarget, setTooOldTarget] = useState<string | null>(null);
  const [worktreeStates, setWorktreeStates] = useState<WorktreeStateEntry[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  // Monotonic version token: every graph request bumps it so a stale
  // in-flight response (workspace switched, newer reload) is dropped.
  const versionRef = useRef(0);
  const graphRef = useRef<GitGraph | null>(null);
  graphRef.current = graph;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const unsupportedRef = useRef(false);
  // Count of user-initiated fetches (loadMore / goToCommit) still in flight;
  // the fingerprint poll must not supersede them.
  const userFetchesRef = useRef(0);
  // Latest user fetch still in flight: a reload of the same workspace (remotes
  // toggle, retry) supersedes it, so the reload carries its request instead.
  const pendingUserFetchRef = useRef<{
    workspaceId: string;
    limit: number;
    untilHash?: string;
    onLoaded?: (g: GitGraph) => void;
  } | null>(null);

  const applyGraph = useCallback((g: GitGraph) => {
    setGraph(g);
    setLimit(g.limit);
    setStatus(g.commits.length === 0 ? "empty" : "ready");
    setError(null);
    setSelectedCommit((prev) =>
      prev !== null && g.commits.some((c) => c.hash === prev) ? prev : null,
    );
  }, []);

  const fail = useCallback((e: unknown) => {
    if (isUnsupportedHostError(e)) {
      unsupportedRef.current = true;
      setStatus("unsupported");
    } else {
      setStatus("error");
    }
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  // Reset and load when the workspace or the remotes toggle changes (or retry).
  useEffect(() => {
    const version = ++versionRef.current;
    unsupportedRef.current = false;
    setGraph(null);
    setSelectedCommit(null);
    setTooOldTarget(null);
    setWorktreeStates([]);
    setLimit(PAGE_SIZE);
    setError(null);
    if (!workspaceId) {
      setStatus("loading");
      return;
    }
    setStatus("loading");
    const carried =
      pendingUserFetchRef.current?.workspaceId === workspaceId
        ? pendingUserFetchRef.current
        : null;
    pendingUserFetchRef.current = null;
    loadGitGraph(
      workspaceId,
      includeRemotes,
      carried?.limit ?? PAGE_SIZE,
      carried?.untilHash,
    )
      .then((g) => {
        if (version !== versionRef.current) return;
        applyGraph(g);
        carried?.onLoaded?.(g);
      })
      .catch((e) => {
        if (version !== versionRef.current) return;
        fail(e);
      });
  }, [workspaceId, includeRemotes, reloadToken, applyGraph, fail]);

  const fetchGraph = useCallback(
    (
      nextLimit: number,
      untilHash?: string,
      onLoaded?: (g: GitGraph) => void,
      userInitiated = false,
    ) => {
      if (!workspaceId) return;
      const version = ++versionRef.current;
      const pending = userInitiated
        ? { workspaceId, limit: nextLimit, untilHash, onLoaded }
        : null;
      if (pending) {
        userFetchesRef.current++;
        pendingUserFetchRef.current = pending;
      }
      loadGitGraph(workspaceId, includeRemotes, nextLimit, untilHash)
        .then((g) => {
          if (version !== versionRef.current) return;
          applyGraph(g);
          onLoaded?.(g);
        })
        .catch((e) => {
          if (version !== versionRef.current) return;
          // A failed background reload keeps the tree on screen: its
          // fingerprint is unchanged, so the next poll tick retries.
          if (!userInitiated && graphRef.current) return;
          fail(e);
        })
        .finally(() => {
          if (!pending) return;
          userFetchesRef.current--;
          if (pendingUserFetchRef.current === pending) pendingUserFetchRef.current = null;
        });
    },
    [workspaceId, includeRemotes, applyGraph, fail],
  );

  const atCap = Math.max(limit, graph?.limit ?? 0) >= MAX_COMMITS;
  const canLoadMore = !!graph && graph.has_more && !atCap;

  const loadMore = useCallback(() => {
    if (!canLoadMore) return;
    fetchGraph(
      Math.min(limitRef.current + PAGE_SIZE, MAX_COMMITS),
      undefined,
      undefined,
      true,
    );
  }, [canLoadMore, fetchGraph]);

  const goToCommit = useCallback(
    (hash: string) => {
      setTooOldTarget(null);
      if (graphRef.current?.commits.some((c) => c.hash === hash)) {
        setSelectedCommit(hash);
        return;
      }
      fetchGraph(
        limitRef.current,
        hash,
        (g) => {
          if (g.target_beyond_cap) {
            setTooOldTarget(hash);
            setSelectedCommit(null);
          } else {
            setSelectedCommit(hash);
          }
        },
        true,
      );
    },
    [fetchGraph],
  );

  const dismissTooOld = useCallback(() => setTooOldTarget(null), []);
  const retry = useCallback(() => setReloadToken((t) => t + 1), []);
  const selectCommit = useCallback((hash: string | null) => setSelectedCommit(hash), []);

  // Fingerprint poll: full reload (same limit) only when it changes.
  const hasGraph = graph !== null;
  useEffect(() => {
    if (!active || !workspaceId || !hasGraph || unsupportedRef.current) return;
    const id = setInterval(() => {
      if (!workspaceRefreshPollingAllowed()) return;
      if (userFetchesRef.current > 0) return;
      const requestVersion = versionRef.current;
      loadGitGraphFingerprint(workspaceId, includeRemotes)
        .then(({ fingerprint }) => {
          if (requestVersion !== versionRef.current) return;
          if (userFetchesRef.current > 0) return;
          if (fingerprint !== graphRef.current?.fingerprint) {
            fetchGraph(limitRef.current);
          }
        })
        .catch(() => {
          // Transient poll failures are ignored; the next tick retries.
        });
    }, FINGERPRINT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, workspaceId, includeRemotes, hasGraph, fetchGraph]);

  // Worktree states: on mount, then every 10 s (not on a host without the
  // git tree methods).
  const unsupported = status === "unsupported";
  useEffect(() => {
    if (!active || !workspaceId || unsupported) return;
    let cancelled = false;
    const read = () => {
      if (!workspaceRefreshPollingAllowed()) return;
      loadWorktreeStates(workspaceId)
        .then((states) => {
          if (!cancelled) setWorktreeStates(states);
        })
        .catch(() => {
          // Keep the previous states; the next tick retries.
        });
    };
    read();
    const id = setInterval(read, WORKTREE_STATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, workspaceId, unsupported]);

  return {
    status,
    graph,
    error,
    includeRemotes,
    setIncludeRemotes,
    canLoadMore,
    atCap,
    loadMore,
    goToCommit,
    tooOldTarget,
    dismissTooOld,
    retry,
    selectedCommit,
    selectCommit,
    worktreeStates,
  };
}
