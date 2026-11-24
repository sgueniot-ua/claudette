export type WorkspaceStatus = "Active" | "Archived";

export type AgentStatus =
  | "Running"
  | "Idle"
  | "IdleWithBackground"
  | "Stopped"
  | "Compacting"
  | { Error: string };

export interface Workspace {
  id: string;
  repository_id: string;
  name: string;
  branch_name: string;
  worktree_path: string | null;
  status: WorkspaceStatus;
  agent_status: AgentStatus;
  status_line: string;
  created_at: string;
  /** Per-repository display order in the sidebar. Persisted via the
   *  `workspaces.sort_order` column; reassigned by `reorder_workspaces`. */
  sort_order: number;
  /** Values supplied at workspace-create time for the repo's declared
   *  `required_inputs`. Null when the repo had no inputs declared. */
  input_values: Record<string, string> | null;
  /** Non-null when this workspace belongs to a remote connection. */
  remote_connection_id: string | null;
}

/** A branch reference; `remote` is null for a local branch. Mirrors the Rust
 *  `BranchRef` (a remote entry's `name` excludes the remote prefix). */
export interface BranchRef {
  name: string;
  remote: string | null;
}

/** A selectable branch plus where it is already checked out, if anywhere.
 *  Mirrors the Rust `WorkspaceBranch`. */
export interface WorkspaceBranch {
  branch: BranchRef;
  checked_out_at: string | null;
}

/** Where a new workspace's branch comes from. Mirrors the Rust
 *  `WorkspaceSource` (snake_case `kind` tag). */
export type WorkspaceSource =
  | { kind: "default" }
  | { kind: "new_branch"; base: BranchRef; branch: string }
  | { kind: "existing_branch"; branch: BranchRef };
