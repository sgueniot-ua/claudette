import { beforeEach, describe, expect, it, vi } from "vitest";

const sendRemoteCommand = vi.fn();
const invoke = vi.fn();

vi.mock("./remote", () => ({
  sendRemoteCommand: (...args: unknown[]) => sendRemoteCommand(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { setRemoteRoutingResolver } from "./remoteRouting";
import {
  isUnsupportedHostError,
  loadCommitDetail,
  loadCommitFileDiffFirstParent,
  loadGitGraph,
  loadGitGraphFingerprint,
  loadWorktreeStates,
} from "./gitGraph";

describe("git graph service", () => {
  beforeEach(() => {
    sendRemoteCommand.mockReset();
    invoke.mockReset();
    setRemoteRoutingResolver({
      connectionForWorkspace: (id) => (id === "w" ? "conn-1" : null),
      connectionForSession: () => null,
    });
  });

  // FR-015
  it("routes loadGitGraph to the paired server with snake_case params", async () => {
    sendRemoteCommand.mockResolvedValue({});
    await loadGitGraph("w", false, 200);
    expect(invoke).not.toHaveBeenCalled();
    expect(sendRemoteCommand).toHaveBeenCalledWith("conn-1", "load_git_graph", {
      workspace_id: "w",
      include_remotes: false,
      limit: 200,
      until_hash: null,
    });
  });

  // FR-015
  it("invokes the local command when the workspace is local", async () => {
    invoke.mockResolvedValue({});
    await loadGitGraph("local-ws", false, 200);
    expect(sendRemoteCommand).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("load_git_graph", {
      workspaceId: "local-ws",
      includeRemotes: false,
      limit: 200,
      untilHash: null,
    });
  });

  // FR-015
  it("passes untilHash through when paging", async () => {
    invoke.mockResolvedValue({});
    await loadGitGraph("local-ws", true, 200, "abc123");
    expect(invoke).toHaveBeenCalledWith("load_git_graph", {
      workspaceId: "local-ws",
      includeRemotes: true,
      limit: 200,
      untilHash: "abc123",
    });
  });

  // FR-015
  it("routes the fingerprint, worktree states and commit detail", async () => {
    sendRemoteCommand.mockResolvedValue({});
    await loadGitGraphFingerprint("w", true);
    expect(sendRemoteCommand).toHaveBeenLastCalledWith(
      "conn-1",
      "load_git_graph_fingerprint",
      { workspace_id: "w", include_remotes: true },
    );

    await loadWorktreeStates("w");
    expect(sendRemoteCommand).toHaveBeenLastCalledWith(
      "conn-1",
      "load_worktree_states",
      { workspace_id: "w" },
    );

    await loadCommitDetail("w", "abc123", false);
    expect(sendRemoteCommand).toHaveBeenLastCalledWith(
      "conn-1",
      "load_commit_detail",
      { workspace_id: "w", commit_hash: "abc123", include_remotes: false },
    );
  });

  // FR-015
  it("invokes the local fingerprint, worktree states and commit detail commands", async () => {
    invoke.mockResolvedValue({});
    await loadGitGraphFingerprint("local-ws", false);
    expect(invoke).toHaveBeenLastCalledWith("load_git_graph_fingerprint", {
      workspaceId: "local-ws",
      includeRemotes: false,
    });

    await loadWorktreeStates("local-ws");
    expect(invoke).toHaveBeenLastCalledWith("load_worktree_states", {
      workspaceId: "local-ws",
    });

    await loadCommitDetail("local-ws", "abc123", true);
    expect(invoke).toHaveBeenLastCalledWith("load_commit_detail", {
      workspaceId: "local-ws",
      commitHash: "abc123",
      includeRemotes: true,
    });
  });

  // FR-015
  it("routes the first-parent file diff to the paired server", async () => {
    sendRemoteCommand.mockResolvedValue({ path: "a.ts", hunks: [], is_binary: false });
    await expect(
      loadCommitFileDiffFirstParent("w", "abc123", "a.ts"),
    ).resolves.toEqual({ path: "a.ts", hunks: [], is_binary: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(sendRemoteCommand).toHaveBeenCalledWith(
      "conn-1",
      "load_commit_file_diff_first_parent",
      { workspace_id: "w", commit_hash: "abc123", file_path: "a.ts" },
    );
  });

  // FR-015
  it("invokes the local first-parent file diff command", async () => {
    invoke.mockResolvedValue({ path: "a.ts", hunks: [], is_binary: false });
    await loadCommitFileDiffFirstParent("local-ws", "abc123", "a.ts");
    expect(sendRemoteCommand).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("load_commit_file_diff_first_parent", {
      workspaceId: "local-ws",
      commitHash: "abc123",
      filePath: "a.ts",
    });
  });

  // FR-015
  it("detects an older host", () => {
    expect(isUnsupportedHostError("Unknown method: load_git_graph")).toBe(true);
    expect(isUnsupportedHostError(new Error("Unknown method: load_git_graph"))).toBe(
      true,
    );
    expect(isUnsupportedHostError("git failed")).toBe(false);
    expect(isUnsupportedHostError(new Error("git failed"))).toBe(false);
    expect(isUnsupportedHostError(undefined)).toBe(false);
  });
});
