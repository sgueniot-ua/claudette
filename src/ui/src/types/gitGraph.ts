// Mirror of src/model/git_graph.rs (serialized snake_case).

export interface GraphCommit {
  hash: string;
  short_hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
}

export type RefKind = "local" | "remote";

export interface GraphRef {
  name: string;
  kind: RefKind;
  target: string;
  is_base: boolean;
  ahead: number | null;
  behind: number | null;
}

export type WorktreeState = "clean" | "dirty" | "missing" | "unknown";

export interface GraphWorktree {
  path: string;
  is_main: boolean;
  branch: string | null;
  head: string;
  state: WorktreeState;
  workspace_id: string | null;
  workspace_name: string | null;
}

export interface GitGraph {
  commits: GraphCommit[];
  refs: GraphRef[];
  worktrees: GraphWorktree[];
  base_ref: string | null;
  has_more: boolean;
  limit: number;
  target_beyond_cap: boolean;
  fingerprint: string;
}

export type CommitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed";

export interface CommitFile {
  path: string;
  old_path: string | null;
  status: CommitFileStatus;
}

export interface CommitDetail {
  hash: string;
  short_hash: string;
  parents: string[];
  author: string;
  author_email: string;
  date: string;
  message: string;
  files: CommitFile[];
  containing_refs: string[];
  containing_worktrees: string[];
}

export interface WorktreeStateEntry {
  path: string;
  state: WorktreeState;
}

export interface GraphFingerprint {
  fingerprint: string;
}
