# Contrats d'interface : Chats de projet sans worktree

## 1. Commande Tauri `open_project_chat` (nouvelle)

Fichier : `src-tauri/src/commands/workspace.rs` (wrapper fin), logique dans `src/ops/workspace.rs`.

```text
invoke("open_project_chat", { repositoryId: string })
  -> { workspace: Workspace, session: ChatSession }
```

- Récupère le workspace `kind = repository` du dépôt, ou le crée : `worktree_path = repo.path`,
  `branch_name = branche extraite`, `name = "@project"`, `branch_auto_rename_claimed = 1`.
- Crée toujours une nouvelle session active et la retourne.
- N'exécute aucune commande git d'écriture, aucun script de setup, et ne crée aucun dossier
  (FR-001, FR-003, SC-002).
- Erreurs : dépôt inconnu ; dossier du dépôt absent (« Le dossier du projet est introuvable : <path> »).
- Service TS : `openProjectChat(repositoryId)` dans `src/ui/src/services/tauri/workspace.ts`.

## 2. Commandes existantes : comportement pour `kind = repository`

| Commande | Contrat |
|---|---|
| `archive_workspace`, `restore_workspace`, `delete_workspace`, `delete_workspaces_bulk`, `run_workspace_setup` | erreur « Opération non disponible pour un chat de projet », sans effet de bord |
| `remove_repository` | supprime la ligne `repository` et ses sessions, sans `git worktree remove` ni `branch_delete` |
| `relink_repository` | met aussi à jour `worktree_path` du workspace `repository` |
| `archive_chat_session` | archive sans recréer de session vide |
| `rollback_to_checkpoint`, `clear_conversation` (`restore_files`) | inchangés : les confirmations sont côté UI (R6) |
| `load_diff_files` et merge-base | base = `HEAD` (modifications non commitées) |
| `fork_workspace_at_checkpoint` | inchangé : crée un workspace `worktree` |
| `create_workspace`, `rename_workspace` et toutes les commandes pour `kind = worktree` | inchangés (FR-012) |

## 3. Payload `Workspace` (IPC, serveur WSS, mobile)

Ajout du champ `"kind": "worktree" | "repository"`. Aucun champ retiré ou renommé.

## 4. CLI `claudette workspace list`

- Le tableau exclut les workspaces `repository` : la sortie actuelle est identique.
- `--json` : mêmes lignes filtrées, plus le champ `kind`.
- Les commandes `chat` ciblant un workspace par id fonctionnent sur le workspace `repository`.

## 5. Contrat UI (desktop)

- **Vue du projet** (`Dashboard.tsx`, branche `scopedRepo`) :
  - section « Chats » qui liste les sessions actives du workspace `repository` (nom, statut de l'agent) ;
  - bouton « Nouveau chat » qui appelle `openProjectChat`, sélectionne le workspace et la session ;
  - au premier chat, mention que tous les chats du projet travaillent dans le dossier du projet, sans
    isolation (FR-005).
- **Sidebar, raccourcis ⌘1–9, Dashboard global, FuzzyFinder** : le workspace `repository` n'y apparaît
  jamais (FR-013).
- **En-tête du chat** : badge « Projet » et nom du dépôt au lieu du nom de workspace ; branche live
  affichée (FR-008).
- **RollbackModal** : avec `kind = repository` et « restaurer les fichiers » coché, avertissement
  « dossier partagé » (FR-014, FR-015). Si une autre session du même workspace est en cours,
  avertissement supplémentaire avec leur nombre (FR-017).
- **Chaînes** : nouvelles clés i18n dans les 6 langues (`en`, `de`, `es`, `ja`, `pt-BR`, `zh-CN`).

## 6. Mobile

Affichage du nom du dépôt à la place de `@project` quand `kind = repository`
(`WorkspacesScreen.tsx`, `ChatListScreen.tsx`, `ChatScreen.tsx`). Pas de création depuis le mobile.
