// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { useAppStore } from "../../stores/useAppStore";
import type { Workspace } from "../../types";
import { DiffViewer } from "./DiffViewer";

const tauriMock = vi.hoisted(() => ({
  loadCommitFileDiff: vi.fn(),
  loadCommitFileDiffFirstParent: vi.fn(),
  loadFileDiff: vi.fn(),
  readWorkspaceFile: vi.fn(),
  readWorkspaceFileForViewer: vi.fn(),
}));
vi.mock("../../services/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/tauri")>()),
  ...tauriMock,
}));

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function render(node: React.ReactNode): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(node);
  });
}

function makeWorkspace(id: string): Workspace {
  return {
    id,
    repository_id: "repo-1",
    name: id,
    branch_name: "main",
    worktree_path: `/tmp/${id}`,
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-05-17T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pending forever: the test only cares which loader was called.
  tauriMock.loadCommitFileDiffFirstParent.mockReturnValue(new Promise(() => {}));
  tauriMock.loadCommitFileDiff.mockReturnValue(new Promise(() => {}));
  useAppStore.setState({
    workspaces: [makeWorkspace("w1")],
    selectedWorkspaceId: "w1",
    diffSelectedFile: "a.ts",
    diffSelectedLayer: null,
    diffSelectedCommitHash: "abc123",
    diffCommitParentMode: "default",
    diffMergeBase: null,
    diffContent: null,
  } as never);
});

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) {
    await act(async () => root.unmount());
  }
  for (const container of containers.splice(0)) container.remove();
});

describe("DiffViewer commit diff", () => {
  // FR-016
  it("loads the first-parent file diff when the parent mode is first-parent", async () => {
    useAppStore.setState({ diffCommitParentMode: "first-parent" } as never);

    await render(<DiffViewer />);

    expect(tauriMock.loadCommitFileDiffFirstParent).toHaveBeenCalledWith("w1", "abc123", "a.ts");
    expect(tauriMock.loadCommitFileDiff).not.toHaveBeenCalled();
  });
});
