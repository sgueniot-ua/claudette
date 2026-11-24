// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepoPullRequestsSection } from "./RepoPullRequestsSection";
import { useRepoOpenPullRequests } from "../../hooks/useRepoOpenPullRequests";
import { fetchWorkspaceBranch, openUrl } from "../../services/tauri";
import { createWorkspaceOrchestrated } from "../../hooks/useCreateWorkspace";
import { useAppStore } from "../../stores/useAppStore";
import type { PullRequest, RepoPullRequestsPayload } from "../../types/plugin";
import type { Workspace } from "../../types/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../hooks/useRepoOpenPullRequests", () => ({
  useRepoOpenPullRequests: vi.fn(),
}));
vi.mock("../../services/tauri", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  fetchWorkspaceBranch: vi.fn(),
}));
vi.mock("../../hooks/useCreateWorkspace", () => ({
  createWorkspaceOrchestrated: vi.fn().mockResolvedValue(null),
}));

const mockedHook = vi.mocked(useRepoOpenPullRequests);

function makePr(n: number): PullRequest {
  return {
    number: n,
    title: `PR ${n}`,
    url: `https://example.com/pull/${n}`,
    state: "open",
    author: "octocat",
    branch: `feat/${n}`,
    base: "main",
    draft: false,
    ci_status: null,
  };
}

function makePayload(
  over: Partial<RepoPullRequestsPayload>,
): RepoPullRequestsPayload {
  return {
    pull_requests: [],
    scope: "open",
    fetched_at: "2026-05-19T00:00:00Z",
    error: null,
    unsupported: false,
    provider: "scm-github",
    ...over,
  };
}

const roots: Root[] = [];

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<RepoPullRequestsSection repoId="repo-1" />);
  });
  return container;
}

function expand(container: HTMLElement) {
  const header = container.querySelector("button");
  act(() => {
    header?.click();
  });
}

beforeEach(() => {
  mockedHook.mockReset();
});

afterEach(() => {
  act(() => {
    roots.forEach((r) => r.unmount());
  });
  roots.length = 0;
  document.body.innerHTML = "";
});

describe("RepoPullRequestsSection error/cache handling", () => {
  it("keeps cached PR rows visible behind a non-destructive banner on refresh failure", () => {
    mockedHook.mockReturnValue({
      payload: makePayload({
        pull_requests: [makePr(10), makePr(11)],
        error: "rate limited",
      }),
      isStale: false,
      loading: false,
      refresh: vi.fn(),
    });
    const container = render();
    expand(container);

    expect(container.textContent).toContain("PR 10");
    expect(container.textContent).toContain("PR 11");
    expect(container.textContent).toContain("showing cached results");
    expect(container.textContent).not.toContain(
      "Could not load pull requests.",
    );
  });

  it("replaces the list with an error banner when nothing is cached", () => {
    mockedHook.mockReturnValue({
      payload: makePayload({ pull_requests: [], error: "boom" }),
      isStale: false,
      loading: false,
      refresh: vi.fn(),
    });
    const container = render();
    expand(container);
    expect(container.textContent).toContain("Could not load pull requests.");
  });

  it("activates a row on Space as well as Enter (role=button a11y)", () => {
    mockedHook.mockReturnValue({
      payload: makePayload({ pull_requests: [makePr(10)] }),
      isStale: false,
      loading: false,
      refresh: vi.fn(),
    });
    const container = render();
    expand(container);
    vi.mocked(openUrl).mockClear();

    const row = container.querySelector('[role="button"]');
    expect(row).toBeTruthy();
    act(() => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
      "https://example.com/pull/10",
    );
  });

  it("renders the honest 'New workspace in this repo' context-menu label", () => {
    mockedHook.mockReturnValue({
      payload: makePayload({ pull_requests: [makePr(10)] }),
      isStale: false,
      loading: false,
      refresh: vi.fn(),
    });
    const container = render();
    expand(container);

    // Right-click the PR row to open the context menu.
    const row = container.querySelector('[role="button"]');
    expect(row).toBeTruthy();
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }),
      );
    });
    const menuText = document.body.textContent ?? "";
    // The action no longer claims to check out the PR branch — it only
    // creates a workspace on the repo's default branch.
    expect(menuText).toContain("New workspace in this repo");
    expect(menuText).not.toContain("Create workspace for this branch");
  });
});

describe("RepoPullRequestsSection create workspace from a PR", () => {
  const addToast = vi.fn();
  const selectWorkspace = vi.fn();

  function makeWorkspace(over: Partial<Workspace>): Workspace {
    return {
      id: "ws-1",
      repository_id: "repo-1",
      name: "ws",
      branch_name: "feat/10",
      worktree_path: "/tmp/ws",
      status: "Active",
      agent_status: "Idle",
      status_line: "",
      created_at: "2026-11-24T00:00:00Z",
      sort_order: 0,
      input_values: null,
      remote_connection_id: null,
      ...over,
    } as Workspace;
  }

  async function createFromPr(container: HTMLElement) {
    const row = container.querySelector('[role="button"]');
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }),
      );
    });
    const item = Array.from(
      document.body.querySelectorAll('[role="menuitem"]'),
    ).find((el) => el.textContent?.includes("New workspace in this repo"));
    await act(async () => {
      (item as HTMLElement | undefined)?.click();
    });
  }

  beforeEach(() => {
    vi.mocked(fetchWorkspaceBranch).mockReset();
    vi.mocked(createWorkspaceOrchestrated).mockReset();
    vi.mocked(createWorkspaceOrchestrated).mockResolvedValue(null);
    addToast.mockReset();
    selectWorkspace.mockReset();
    useAppStore.setState({ workspaces: [], addToast, selectWorkspace });
    mockedHook.mockReturnValue({
      payload: makePayload({ pull_requests: [makePr(10)] }),
      isStale: false,
      loading: false,
      refresh: vi.fn(),
    });
  });

  it("opens the PR branch", async () => {
    const ref = { name: "feat/10", remote: "origin" };
    vi.mocked(fetchWorkspaceBranch).mockResolvedValue(ref);
    vi.mocked(createWorkspaceOrchestrated).mockResolvedValue({
      workspaceId: "ws-new",
      sessionId: "sess-new",
    });
    const container = render();
    expand(container);

    await createFromPr(container);

    expect(fetchWorkspaceBranch).toHaveBeenCalledWith("repo-1", "feat/10");
    expect(createWorkspaceOrchestrated).toHaveBeenCalledWith("repo-1", {
      source: { kind: "existing_branch", branch: ref },
    });
    expect(addToast).toHaveBeenCalledWith("Workspace ready on feat/10");
  });

  it("selects existing workspace on PR branch", async () => {
    useAppStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1", branch_name: "feat/10" })],
    });
    const container = render();
    expand(container);

    await createFromPr(container);

    expect(selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(fetchWorkspaceBranch).not.toHaveBeenCalled();
    expect(createWorkspaceOrchestrated).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("Workspace already open on feat/10");
  });

  it("falls back to default branch when PR branch is unknown", async () => {
    vi.mocked(fetchWorkspaceBranch).mockResolvedValue(null);
    vi.mocked(createWorkspaceOrchestrated).mockResolvedValue({
      workspaceId: "ws-new",
      sessionId: "sess-new",
    });
    const container = render();
    expand(container);

    await createFromPr(container);

    expect(createWorkspaceOrchestrated).toHaveBeenCalledWith("repo-1");
    expect(addToast).toHaveBeenCalledWith(
      "Workspace ready (default branch). PR head: feat/10",
    );
  });
});
