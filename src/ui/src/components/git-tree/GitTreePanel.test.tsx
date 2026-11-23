// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { useAppStore } from "../../stores/useAppStore";
import type {
  CommitDetail,
  GitGraph,
  GraphCommit,
  GraphRef,
  GraphWorktree,
} from "../../types/gitGraph";

const hookMock = vi.hoisted(() => ({ useGitGraph: vi.fn() }));
vi.mock("./useGitGraph", () => hookMock);

const tauriMock = vi.hoisted(() => ({ loadCommitDetail: vi.fn() }));
vi.mock("../../services/tauri", () => tauriMock);

const clipboardMock = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboardMock);

import { GitTreePanel } from "./GitTreePanel";

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

function commit(n: number, parents: string[] = [`h${n + 1}`]): GraphCommit {
  return {
    hash: `h${n}`,
    short_hash: `s${n}`,
    parents,
    author: `Author ${n}`,
    date: new Date().toISOString(),
    subject: `Subject ${n}`,
  };
}

function ref(name: string, target: string, extra: Partial<GraphRef> = {}): GraphRef {
  return {
    name,
    kind: "local",
    target,
    is_base: false,
    ahead: null,
    behind: null,
    ...extra,
  };
}

function worktree(extra: Partial<GraphWorktree>): GraphWorktree {
  return {
    path: "/repo/wt",
    is_main: false,
    branch: null,
    head: "h1",
    state: "clean",
    workspace_id: null,
    workspace_name: null,
    ...extra,
  };
}

function makeGraph(extra: Partial<GitGraph> = {}): GitGraph {
  return {
    commits: [commit(1), commit(2), commit(3, [])],
    refs: [
      ref("feature", "h1", { ahead: 3, behind: 2 }),
      ref("main", "h2", { is_base: true }),
    ],
    worktrees: [],
    base_ref: "main",
    has_more: false,
    limit: 200,
    target_beyond_cap: false,
    fingerprint: "fp",
    ...extra,
  };
}

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    graph: makeGraph(),
    error: null,
    includeRemotes: false,
    setIncludeRemotes: vi.fn(),
    canLoadMore: false,
    atCap: false,
    loadMore: vi.fn(),
    goToCommit: vi.fn(),
    tooOldTarget: null,
    dismissTooOld: vi.fn(),
    retry: vi.fn(),
    selectedCommit: null,
    selectCommit: vi.fn(),
    worktreeStates: [],
    ...overrides,
  };
}

function setHook(overrides: Record<string, unknown> = {}) {
  const state = hookState(overrides);
  hookMock.useGitGraph.mockReturnValue(state);
  return state;
}

const selectWorkspace = vi.fn();
const openDiffTab = vi.fn();
const setDiffSelectedCommitHash = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    selectedWorkspaceId: "w1",
    selectWorkspace,
    openDiffTab,
    setDiffSelectedCommitHash,
    rightSidebarVisible: true,
  } as never);
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  for (const c of mountedContainers.splice(0)) c.remove();
});

const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("GitTreePanel", () => {
  // FR-002 FR-003 FR-007 FR-017
  it("renders commits, ref labels, base marker and counters", async () => {
    setHook();
    const c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("Subject 1");
    expect(c.textContent).toContain("Author 2");
    expect(c.textContent).toContain("s3");
    const refList = c.querySelector('[data-testid="git-ref-list"]')!;
    const entries = Array.from(refList.querySelectorAll("[data-ref-entry]"));
    expect(entries[0].textContent).toContain("main");
    expect(entries[0].textContent).toContain("base");
    const feature = entries.find((e) => e.textContent?.includes("feature"))!;
    expect(feature.textContent).toContain("↑3");
    expect(feature.textContent).toContain("↓2");
    expect(c.querySelector('[data-testid="git-graph-rows"] [data-commit-row="h1"]')!.textContent)
      .toContain("feature");
    expect(c.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThan(0);
  });

  // FR-004 FR-005 FR-006 FR-010
  it("renders worktree badges for claudette, external, detached and missing", async () => {
    setHook({
      graph: makeGraph({
        worktrees: [
          worktree({ path: "/repo", is_main: true, branch: "main", head: "h2" }),
          worktree({
            path: "/w/a",
            branch: "feature",
            head: "h1",
            workspace_id: "w2",
            workspace_name: "my-workspace",
          }),
          worktree({ path: "/ext/folder", head: "h3" }),
          worktree({ path: "/gone", branch: "x", head: "h3", state: "missing" }),
        ],
      }),
    });
    const c = await render(<GitTreePanel />);
    const text = c.textContent ?? "";
    expect(text).toContain("my-workspace");
    expect(text).toContain("main checkout");
    expect(text).toContain("folder");
    expect(text).toContain("detached");
    const missing = c.querySelector('[data-worktree-state="missing"]')!;
    expect(missing.getAttribute("title")).toBe("Folder not found");
    const external = c.querySelector('[data-worktree-kind="external"]')!;
    expect(external.textContent).toContain("Not a Claudette workspace");
    expect(external.getAttribute("title")).toBe(
      "Not a Claudette workspace — /ext/folder",
    );
  });

  // FR-008 SC-005
  it("selects the workspace on badge click, not for external or missing", async () => {
    setHook({
      graph: makeGraph({
        worktrees: [
          worktree({
            path: "/w/a",
            branch: "feature",
            head: "h1",
            workspace_id: "w2",
            workspace_name: "my-workspace",
          }),
          worktree({ path: "/ext/folder", head: "h3" }),
          worktree({ path: "/gone", branch: "x", head: "h3", state: "missing" }),
        ],
      }),
    });
    const c = await render(<GitTreePanel />);
    const rows = c.querySelector('[data-testid="git-graph-rows"]')!;
    await click(rows.querySelector('[data-worktree-kind="claudette"]'));
    expect(selectWorkspace).toHaveBeenCalledWith("w2");
    selectWorkspace.mockClear();
    const external = rows.querySelector('[data-worktree-kind="external"]')!;
    const missing = rows.querySelector('[data-worktree-state="missing"]')!;
    expect(external.tagName).not.toBe("BUTTON");
    expect(missing.tagName).not.toBe("BUTTON");
    await click(external);
    await click(missing);
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  // FR-009
  it("shows the uncommitted indicator", async () => {
    setHook({
      graph: makeGraph({
        worktrees: [
          worktree({ path: "/repo", is_main: true, branch: "main", head: "h2", state: "clean" }),
        ],
      }),
      worktreeStates: [{ path: "/repo", state: "dirty" }],
    });
    const c = await render(<GitTreePanel />);
    const dirty = c.querySelector('[data-testid="worktree-dirty"]')!;
    expect(dirty).not.toBeNull();
    expect(dirty.getAttribute("title")).toBe("Uncommitted changes");
    expect(dirty.textContent).toContain("Uncommitted changes");
  });

  // FR-011
  it("shows load more, the limit message at cap, and the too-old banner", async () => {
    const state = setHook({ canLoadMore: true });
    let c = await render(<GitTreePanel />);
    const more = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Load more",
    )!;
    await click(more);
    expect(state.loadMore).toHaveBeenCalled();

    setHook({
      canLoadMore: false,
      atCap: true,
      graph: makeGraph({ has_more: true, limit: 10_000 }),
    });
    c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("Tree limit reached (10,000 commits)");

    // The whole history fits in the cap: nothing was cut off.
    setHook({
      canLoadMore: false,
      atCap: true,
      graph: makeGraph({ has_more: false, limit: 10_000 }),
    });
    c = await render(<GitTreePanel />);
    expect(c.textContent).not.toContain("Tree limit reached");

    setHook({ tooOldTarget: "abcdef0123456789" });
    c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("This commit is too old to show in the tree");
    expect(c.textContent).toContain("abcdef0123456789");
    const copy = c.querySelector('[data-testid="too-old-banner"] button')!;
    await click(copy);
    expect(clipboardMock.writeText).toHaveBeenCalledWith("abcdef0123456789");

    // ref click goes to the commit
    const s2 = setHook();
    c = await render(<GitTreePanel />);
    await click(c.querySelector('[data-ref-entry] button'));
    expect(s2.goToCommit).toHaveBeenCalledWith("h2");
  });

  // FR-014
  it("toggles remote branches", async () => {
    const state = setHook();
    const c = await render(<GitTreePanel />);
    const box = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(c.textContent).toContain("Show remote branches");
    await click(box);
    expect(state.setIncludeRemotes).toHaveBeenCalledWith(true);
  });

  // FR-016
  it("opens commit detail and the first-parent diff of a file", async () => {
    const detail: CommitDetail = {
      hash: "h1",
      short_hash: "s1",
      parents: ["h2"],
      author: "Author 1",
      author_email: "a@b.c",
      date: new Date().toISOString(),
      message: "Subject 1\n\nLong body",
      files: [{ path: "src/a.ts", old_path: null, status: "modified" }],
      containing_refs: ["feature"],
      containing_worktrees: ["/w/a"],
    };
    tauriMock.loadCommitDetail.mockResolvedValue(detail);
    const state = setHook({ selectedCommit: "h1" });
    const c = await render(<GitTreePanel />);
    await click(c.querySelector('[data-commit-row="h2"]'));
    expect(state.selectCommit).toHaveBeenCalledWith("h2");
    expect(tauriMock.loadCommitDetail).toHaveBeenCalledWith("w1", "h1", false);
    const panel = c.querySelector('[data-testid="commit-detail"]')!;
    expect(panel.textContent).toContain("Long body");
    expect(panel.textContent).toContain("Author 1");
    expect(panel.textContent).toContain("feature");
    await click(panel.querySelector('[data-file-path="src/a.ts"]'));
    expect(openDiffTab).toHaveBeenCalledWith("w1", "src/a.ts", "committed");
    // Open first, then stamp the commit on the now-active tab.
    expect(openDiffTab.mock.invocationCallOrder[0]).toBeLessThan(
      setDiffSelectedCommitHash.mock.invocationCallOrder[0],
    );
    expect(panel.querySelector('[data-file-path="src/a.ts"]')!.textContent).toContain("Modified");
    expect(setDiffSelectedCommitHash).toHaveBeenCalledWith("h1", "first-parent");
  });

  // User story 1 scenario 5
  it("collapses more than 3 labels into +N", async () => {
    setHook({
      graph: makeGraph({
        refs: ["a", "b", "c", "d", "e"].map((n) => ref(n, "h1")),
      }),
    });
    const c = await render(<GitTreePanel />);
    const row = c.querySelector('[data-commit-row="h1"]')!;
    expect(row.querySelectorAll("[data-ref-label]").length).toBe(3);
    const more = row.querySelector('[data-testid="more-labels"]') as HTMLElement;
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("aria-label")).toBe("Show 2 more labels");
    await click(more);
    const popover = row.querySelector('[data-testid="labels-popover"]')!;
    expect(popover.querySelectorAll("[data-ref-label]").length).toBe(5);
    expect(more.getAttribute("aria-label")).toBe("Hide extra labels");
  });

  // Edge
  it("shows empty, error with retry, and unsupported states", async () => {
    setHook({ status: "empty", graph: makeGraph({ commits: [] }) });
    let c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("This repository has no commits yet.");

    const state = setHook({ status: "error", graph: null, error: "boom" });
    c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("Could not read the git history.");
    expect(c.textContent).toContain("boom");
    const retry = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry",
    )!;
    await click(retry);
    expect(state.retry).toHaveBeenCalled();

    setHook({ status: "unsupported", graph: null });
    c = await render(<GitTreePanel />);
    expect(c.textContent).toContain("This machine does not support the git tree yet.");

    setHook({ status: "loading", graph: null });
    c = await render(<GitTreePanel />);
    expect(c.querySelector('[data-testid="git-tree-skeleton"]')).not.toBeNull();
  });

  it("polls the graph only while the right sidebar is visible", async () => {
    setHook({ status: "empty", graph: null });
    await render(<GitTreePanel />);
    expect(hookMock.useGitGraph).toHaveBeenLastCalledWith("w1", true);

    useAppStore.setState({ rightSidebarVisible: false } as never);
    await render(<GitTreePanel />);
    expect(hookMock.useGitGraph).toHaveBeenLastCalledWith("w1", false);
  });
});
