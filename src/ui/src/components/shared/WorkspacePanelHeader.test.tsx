// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../types/repository";
import type { Workspace } from "../../types/workspace";
import { useAppStore } from "../../stores/useAppStore";

vi.mock("../../services/tauri", () => ({
  openUrl: vi.fn(),
}));
vi.mock("../chat/WorkspaceActions", () => ({ WorkspaceActions: () => null }));
vi.mock("./PanelToggles", () => ({ PanelToggles: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { WorkspacePanelHeader } from "./WorkspacePanelHeader";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

const repo = {
  id: "r1",
  name: "my-repo",
  path: "/repo",
} as Repository;

function makeWorkspace(kind: Workspace["kind"]): Workspace {
  return {
    id: "w1",
    repository_id: "r1",
    name: kind === "repository" ? "@project" : "feature",
    branch_name: "main",
    worktree_path: "/repo",
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind,
  };
}

async function renderHeader(kind: Workspace["kind"]): Promise<HTMLElement> {
  useAppStore.setState({
    repositories: [repo],
    workspaces: [makeWorkspace(kind)],
    selectedWorkspaceId: "w1",
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(<WorkspacePanelHeader />);
  });
  return container;
}

beforeEach(() => {
  useAppStore.setState({ workspaceScmLinks: {} });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  for (const c of mountedContainers.splice(0)) c.remove();
});

describe("WorkspacePanelHeader project badge", () => {
  it("shows the project badge for repository workspaces", async () => {
    // FR-008
    const c = await renderHeader("repository");
    expect(c.textContent).toContain("project_chat_badge");
  });

  it("shows no badge for worktree workspaces", async () => {
    // FR-012
    const c = await renderHeader("worktree");
    expect(c.textContent).not.toContain("project_chat_badge");
  });
});
