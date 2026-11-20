// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../types/repository";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

const relinkRepository = vi.fn();

vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  relinkRepository: (...args: unknown[]) => relinkRepository(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

import { RelinkRepoModal } from "./RelinkRepoModal";
import { RemoveRepoModal } from "./RemoveRepoModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    repository_id: "r1",
    name: "feature",
    branch_name: "feature",
    worktree_path: "/wt/feature",
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind: "worktree",
    ...overrides,
  };
}

const repo: Repository = {
  id: "r1",
  path: "/old/repo",
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
  path_valid: false,
  remote_connection_id: null,
};

const project = makeWorkspace({
  id: "p1",
  name: "@project",
  branch_name: "main",
  worktree_path: "/old/repo",
  kind: "repository",
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(node);
  });
  return document.body;
}

beforeEach(() => {
  relinkRepository.mockReset();
  relinkRepository.mockResolvedValue(undefined);
  useAppStore.setState({
    repositories: [repo],
    workspaces: [],
    modalData: { repoId: "r1", repoName: "repo" },
  });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  for (const c of mountedContainers.splice(0)) c.remove();
});

describe("RemoveRepoModal", () => {
  it("does not count the project chat workspace as destroyed", async () => {
    useAppStore.setState({ workspaces: [project, makeWorkspace()] });
    const body = await render(<RemoveRepoModal />);
    expect(body.textContent).toContain("remove_repo_active:1");
    expect(body.textContent).toContain("remove_repo_workspace.");
  });

  it("shows no destroy warning when only project chats exist", async () => {
    useAppStore.setState({ workspaces: [project] });
    const body = await render(<RemoveRepoModal />);
    expect(body.textContent).not.toContain("remove_repo_will_destroy_pre");
  });
});

describe("RelinkRepoModal", () => {
  it("moves the project chat workspace with the repository", async () => {
    // FR-013
    const wt = makeWorkspace();
    useAppStore.setState({ workspaces: [project, wt] });
    const body = await render(<RelinkRepoModal />);
    const input = body.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "/new/repo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(relinkRepository).toHaveBeenCalledWith("r1", "/new/repo");
    const ws = useAppStore.getState().workspaces;
    expect(ws.find((w) => w.id === "p1")?.worktree_path).toBe("/new/repo");
    expect(ws.find((w) => w.id === "w1")?.worktree_path).toBe("/wt/feature");
  });
});
