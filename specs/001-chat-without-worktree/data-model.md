# Data Model: Chats de projet sans worktree

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Workspace (existant, étendu)

Table `workspaces`, struct `src/model/workspace.rs` (`derive(Serialize)`), type TS
`src/ui/src/types/workspace.ts`.

| Champ | Type | Changement |
|---|---|---|
| `kind` | `WorkspaceKind` : `Worktree` \| `Repository` (sérialisé `"worktree"` / `"repository"`) | **nouveau**, défaut `worktree` |
| `name` | string | pour `repository` : nom réservé `@project` (non saisissable), affiché sous le nom du dépôt |
| `branch_name` | string | pour `repository` : branche extraite du dépôt, resynchronisée par `workspace_sync` |
| `worktree_path` | string? | pour `repository` : toujours `Some(Repository.path)` ; mis à jour par `relink_repository` |
| `status` | `Active` \| `Archived` | pour `repository` : toujours `Active` |
| `branch_auto_rename_claimed` | bool (colonne) | pour `repository` : `1` dès la création |

Méthode modèle : `Workspace::is_repository_rooted(&self) -> bool` (`kind == Repository`).

**Règles de validation**
- Au plus un workspace `repository` par dépôt : index unique partiel
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_repository_kind ON workspaces(repository_id) WHERE kind = 'repository'`.
- Les lignes existantes prennent `kind = 'worktree'` : comportement inchangé (FR-012, SC-005).
- `archive`, `restore`, `delete`, `delete_bulk`, `run_workspace_setup` et `try_auto_rename` refusent un
  workspace `repository` avec une erreur explicite. `remove_repository` supprime sa ligne sans opération
  git.

**Migration** : `src/migrations/<UTC>_workspace_kind.sql`, additive :
```sql
ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'worktree';
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_repository_kind
  ON workspaces(repository_id) WHERE kind = 'repository';
ALTER TABLE conversation_checkpoints ADD COLUMN is_session_baseline INTEGER NOT NULL DEFAULT 0;
```

## Chat de projet = ChatSession (existant, inchangé)

Table `chat_sessions`, struct `src/model/chat_session.rs`. Un chat de projet est une session dont le
workspace est `repository`. Aucun nouveau champ.

| Opération | Comportement pour un workspace `repository` |
|---|---|
| créer | `open_project_chat` : nouvelle session, nom par défaut « New chat » |
| renommer | `rename_chat_session` existant (base de données seulement) |
| archiver | `archive_chat_session_only` : zéro session active autorisée (R5) |
| lister | sessions `active` du workspace, dans la vue du projet |

## Snapshot de référence de session (nouveau, R9)

Un checkpoint marqué référence (`conversation_checkpoints`, nouveau booléen `is_session_baseline`,
défaut `0`, ajouté par la même migration). Il est créé avant le premier tour d'une session de workspace
`repository`, au plus un par session, exclu de l'élagage par rétention et du fil de la conversation
(non affiché comme tour). Il est supprimé avec la session archivée ou le dépôt retiré.

## Checkpoints (existants, inchangés)

`conversation_checkpoints` reste rattaché au workspace et à la session. Les snapshots de fichiers
capturent le dossier du dépôt, comme pour une worktree. La restauration passe par `RollbackModal`, avec
les avertissements de R6.

## Transitions d'état

```text
Dépôt sans workspace repository
   └─ open_project_chat ─► workspace repository Active (1 session)
         ├─ open_project_chat ─► +1 session
         ├─ archive session ─► session Archived (le workspace reste Active, 0..n sessions)
         └─ remove_repository ─► ligne supprimée (cascade sessions), aucun fichier touché
```
