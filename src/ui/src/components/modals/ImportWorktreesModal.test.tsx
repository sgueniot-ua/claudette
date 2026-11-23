// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../stores/useAppStore";
import { ImportWorktreesModal } from "./ImportWorktreesModal";

const services = vi.hoisted(() => ({
  discoverWorktrees: vi.fn(),
  importWorktrees: vi.fn(),
  purgeStrayWorktree: vi.fn(),
}));

vi.mock("../../services/tauri", () => services);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  services.discoverWorktrees.mockResolvedValue([
    {
      path: "/tmp/repo-wt",
      branch_name: "feature",
      head_sha: "abc",
      suggested_name: "feature",
      name_valid: true,
      size_bytes: null,
    },
  ]);
  // The Rust `Workspace` model has no `remote_connection_id` field, so
  // the IPC payload arrives without it.
  services.importWorktrees.mockResolvedValue([
    {
      id: "ws-imported",
      repository_id: "repo-1",
      name: "feature",
      branch_name: "feature",
      worktree_path: "/tmp/repo-wt",
      status: "Active",
      agent_status: "Idle",
      status_line: "",
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      input_values: null,
    },
  ]);
  useAppStore.setState({
    workspaces: [],
    modalData: { repoId: "repo-1" },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("ImportWorktreesModal", () => {
  it("stamps imported workspaces as local (remote_connection_id: null)", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ImportWorktreesModal />);
    });

    const importButton = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "import_worktrees_confirm_singular",
    );
    expect(importButton).toBeDefined();
    await act(async () => {
      importButton!.click();
    });

    const ws = useAppStore
      .getState()
      .workspaces.find((w) => w.id === "ws-imported");
    expect(ws).toBeDefined();
    // `undefined` here makes useWorkspaceEnvironmentPreparation bail
    // out forever, leaving the chat stuck on "Preparing workspace
    // environment…".
    expect(ws!.remote_connection_id).toBeNull();
  });
});
