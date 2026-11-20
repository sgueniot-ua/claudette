ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'worktree';
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_repository_kind ON workspaces(repository_id) WHERE kind = 'repository';
ALTER TABLE conversation_checkpoints ADD COLUMN is_session_baseline INTEGER NOT NULL DEFAULT 0;
