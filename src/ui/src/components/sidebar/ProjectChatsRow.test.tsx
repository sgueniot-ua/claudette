// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../types/repository";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

const openProjectChat = vi.fn();

vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  notifyWorkspaceSelected: () => Promise.resolve(),
  openProjectChat: (...args: unknown[]) => openProjectChat(...args),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ProjectChatsRow } from "./ProjectChatsRow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "r1",
    path: "/repo",
    name: "repo",
    path_slug: "repo",
    icon: null,
    created_at: "2026-01-01T00:00:00Z",
    setup_script: null,
    custom_instructions: null,
    sort_order: 0,
    branch_rename_preferences: null,
    setup_script_auto_run: false,
    archive_script: null,
    archive_script_auto_run: false,
    base_branch: null,
    default_remote: null,
    required_inputs: null,
    path_valid: true,
    remote_connection_id: null,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w-project",
    repository_id: "r1",
    name: "@project",
    branch_name: "feature/x",
    worktree_path: "/repo",
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind: "repository",
    ...overrides,
  };
}

async function render(
  repo: Repository = makeRepo(),
  showRepoName = false,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<ProjectChatsRow repo={repo} showRepoName={showRepoName} />);
  });
  return container;
}

beforeEach(() => {
  openProjectChat.mockReset();
  useAppStore.setState({
    workspaces: [],
    sessionsByWorkspace: {},
    sessionsLoadedByWorkspace: {},
    repositoryBranches: {},
    selectedWorkspaceId: null,
    unreadCompletions: new Set(),
    toasts: [],
  });
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const c of containers.splice(0)) c.remove();
});

describe("ProjectChatsRow", () => {
  it("row shows the checked-out branch and agent status", async () => {
    // FR-013
    useAppStore.setState({
      workspaces: [makeWorkspace({ agent_status: "Running" })],
    });
    const c = await render();
    expect(c.textContent).toContain("project_chats_row");
    expect(c.textContent).toContain("feature/x");
    expect(c.querySelector('[title="status_running"]')).not.toBeNull();
  });

  it("shows the checked-out branch before the project workspace exists", async () => {
    // FR-013
    useAppStore.setState({ repositoryBranches: { r1: "develop" } });
    const c = await render();
    expect(c.textContent).toContain("develop");
    const withName = await render(makeRepo({ name: "my-repo" }), true);
    expect(withName.textContent).toContain("my-repo · develop");
    // Once the workspace exists, its own (polled) branch wins.
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    const withWs = await render();
    expect(withWs.textContent).toContain("feature/x");
    expect(withWs.textContent).not.toContain("develop");
  });

  it("aria-label includes the repository name", async () => {
    const c = await render(makeRepo({ name: "my-repo" }));
    expect(c.firstElementChild?.getAttribute("aria-label")).toContain("my-repo");
  });

  it("ignores a repository workspace that belongs to a remote connection", async () => {
    useAppStore.setState({
      workspaces: [makeWorkspace({ remote_connection_id: "conn" })],
    });
    const c = await render();
    expect(c.textContent).not.toContain("feature/x");
  });

  it("status section rows show the repository name", async () => { // FR-013
    const repo = makeRepo({ name: "my-repo" });
    const withoutWs = await render(repo, true);
    expect(withoutWs.textContent).toContain("my-repo");
    useAppStore.setState({ workspaces: [makeWorkspace()] });
    const withWs = await render(repo, true);
    expect(withWs.textContent).toContain("my-repo · feature/x");
  });

  it("shows the attention indicator from the project sessions", async () => {
    // FR-013
    useAppStore.setState({
      workspaces: [makeWorkspace()],
      sessionsByWorkspace: {
        "w-project": [
          {
            id: "s1",
            workspace_id: "w-project",
            status: "Active",
            needs_attention: true,
            attention_kind: "Ask",
          } as never,
        ],
      },
    });
    const c = await render();
    expect(c.querySelector('[aria-label="status_badge_ask_aria"]')).not.toBeNull();
  });

  it("is selected when its workspace is selected", async () => {
    useAppStore.setState({
      workspaces: [makeWorkspace()],
      selectedWorkspaceId: "w-project",
    });
    const c = await render();
    expect(c.firstElementChild?.className).toMatch(/wsSelected/);
  });

  it("click selects the existing project workspace without creating a chat", async () => {
    // FR-013
    useAppStore.setState({
      workspaces: [makeWorkspace()],
      sessionsByWorkspace: {
        "w-project": [{ id: "s1", status: "Active" } as never],
      },
      sessionsLoadedByWorkspace: { "w-project": true },
    });
    const c = await render();
    await act(async () => {
      (c.firstElementChild as HTMLElement).click();
    });
    expect(openProjectChat).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedWorkspaceId).toBe("w-project");
  });

  it("click without a project workspace creates it", async () => {
    // FR-001
    openProjectChat.mockResolvedValue({
      workspace: makeWorkspace(),
      session: { id: "s9", workspace_id: "w-project" },
    });
    const c = await render();
    expect(c.textContent).not.toContain("feature/x");
    await act(async () => {
      (c.firstElementChild as HTMLElement).click();
    });
    expect(openProjectChat).toHaveBeenCalledWith("r1");
  });
});
