# Research: Chats de projet sans worktree

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-20

Constat de départ : tout le chat est rattaché à un workspace. Les onglets (`chat_sessions.workspace_id`
NOT NULL, ON DELETE CASCADE), le cwd de l'agent (`send.rs:1121`), les routines (`db/scheduling.rs:193`),
le terminal, l'env et les checkpoints sont indexés par workspace. Plusieurs sessions par workspace
tournent déjà en parallèle (`AppState.agents` indexé par `chat_session_id`).

## R1. Représentation d'un chat de projet

- **Decision**: une colonne `workspaces.kind` (`'worktree'` par défaut, `'repository'`). Un seul
  workspace `kind = 'repository'` par dépôt, créé à la demande, avec `worktree_path = Repository.path`.
  Chaque chat de projet est une `chat_session` de ce workspace. Choix tranché par l'utilisateur le
  2026-11-20 (option A).
- **Rationale**: c'est le changement minimal. Le cwd de l'agent, les routines, le terminal, l'env, MCP,
  l'explorateur de fichiers et la concurrence entre sessions fonctionnent sans modification. Le
  renommage et l'archivage d'une session ne touchent que la base et l'agent vivant
  (`chat/session.rs:91`, `:153`), ce qui couvre FR-007.
- **Alternatives considered**:
  - Un workspace `repository` par chat : plus de lignes à filtrer partout, conflit de nommage
    `UNIQUE(repository_id, name)`, archivage au niveau workspace à garder.
  - `chat_sessions.workspace_id` optionnel + `repository_id` : refonte du store, de ChatPanel, des
    routines, de l'IPC, du serveur distant et du mobile.

## R2. Garde-fous sur le checkout principal

- **Decision**: une méthode `Workspace::is_repository_rooted()` sur le modèle, et une garde explicite
  dans chaque chemin qui suppose une worktree :

  | Chemin | Effet actuel si appliqué au checkout | Garde |
  |---|---|---|
  | `ops/workspace.rs:887` archive | `git worktree remove` + `branch_delete` + script d'archivage | archivage du workspace `repository` refusé (on archive des chats, pas le workspace) |
  | `commands/workspace.rs:1033` delete, `:1428` bulk delete | `remove_worktree --force` + `branch_delete` | refusés pour `repository` ; seule la suppression du dépôt supprime la ligne |
  | `commands/repository.rs:270` remove repository | `remove_worktree --force` sur chaque workspace | sauter worktree et branche pour `repository`, ne supprimer que la ligne |
  | `commands/workspace.rs:885` restore | `git worktree add` | sans objet (jamais archivé) : refus explicite |
  | `commands/workspace.rs:238`, `:510` setup script | script utilisateur dans le checkout | jamais lancé (FR-003) |
  | `chat/naming.rs:84` auto-rename | `git branch -m` de la branche extraite de l'utilisateur | `branch_auto_rename_claimed = 1` à la création, plus une garde par kind |
  | `fork.rs` | crée une worktree depuis le workspace source ; nom demandé `format!("{}-fork", source_ws.name)` (`fork.rs:180`) | conservé (FR-016) : le fork produit un workspace `worktree`, nommé `<nom du dépôt>-fork` pour une source `repository` (`@project-fork` serait refusé) |
| `rename_workspace` (`commands/workspace.rs:1510`) | renommerait le nom réservé `@project` | refusé pour `repository` |
| `clear_conversation` restore (`checkpoint.rs:231`) | `reset --hard` + `clean -fd` vers le merge-base | remplacé par la restauration du snapshot de référence (R9) |
  | `env_watcher.unregister` dans les chemins de suppression | désenregistre la surveillance env du dépôt (même chemin) | sautée pour `repository` |
  | `storage.rs:115` taille | compterait tout le dépôt comme « workspace » | exclu des stats de stockage |
  | `relink_repository` (`repository.rs:226`) | `worktree_path` du workspace `repository` resterait sur l'ancien chemin | mise à jour du `worktree_path` dans la même opération |

- **Rationale**: git refuse de supprimer le working tree principal ou la branche extraite, mais
  l'analyse montre qu'on ne peut pas compter sur ces refus (la suppression de branche s'exécute quand
  même sur `branch_name`, et `remove_repository` pourrait échouer à mi-chemin). Les gardes sont dans le
  crate `claudette` (`ops/`), ce qui protège à la fois l'interface, la CLI et le serveur distant.

## R3. Branche affichée et synchronisation

- **Decision**: `branch_name` du workspace `repository` = branche extraite au moment de la création.
  La synchronisation existante (`workspace_sync.rs:60`, `:129`) la remet à jour depuis `git rev-parse`
  sans changement, ce qui couvre le cas limite « l'utilisateur change de branche ».
- **Rationale**: la branche affichée (FR-008) et les forks (FR-016) partent de la branche réelle.
  `clear_conversation` n'utilise plus `branch_name` pour un workspace `repository` (voir R9).

## R4. Diff

- **Decision**: pour `repository`, la base du diff est `HEAD` au lieu du merge-base avec la branche par
  défaut. Le panneau montre donc les modifications non commitées du dossier (hypothèse de la spec).
- **Alternatives considered**: le merge-base avec la branche par défaut, rejeté parce que sur `main`
  il ne montre rien de plus que les modifications non commitées, et que sur une branche il mélange
  les commits passés de l'utilisateur au travail du chat.

## R5. Archivage du dernier chat

- **Decision**: pour `repository`, l'archivage d'une session utilise `archive_chat_session_only`
  (zéro session active autorisée) au lieu de `archive_chat_session_ensuring_active`, qui recrée un
  « New chat » vide.
- **Rationale**: la spec autorise zéro chat de projet. Une session vide recréée apparaîtrait dans la
  liste de la vue du projet sans que l'utilisateur l'ait lancée.

## R6. Confirmations de restauration (FR-014, FR-015, FR-017)

- **Decision**: réutiliser `RollbackModal.tsx`, qui sert déjà au rollback de checkpoint et à
  l'effacement de la conversation, avec une case « restaurer les fichiers » décochée par défaut.
  Pour un workspace `repository`, quand la case est cochée, la modale affiche :
  - un avertissement « le dossier du projet, partagé avec vous et les autres chats, sera modifié ».
    Pour l'effacement, il précise « retour à l'état d'avant le premier message de ce chat ; les
    modifications faites depuis, y compris les vôtres et celles des autres chats, seront annulées » ;
  - en plus, si une autre session du même workspace est en cours, « N autres chats de ce projet
    travaillent en ce moment et peuvent être perturbés ».

  Le bouton de confirmation reste l'action explicite ; annuler ne restaure rien.
- **Rationale**: aucune nouvelle modale. Le statut des autres sessions est déjà dans le store
  (statut par session). Le backend garde son contrôle existant (pas de rollback si la session elle-même
  tourne).

## R7. Création et ouverture

- **Decision**: une commande Tauri `open_project_chat(repository_id)` appelle
  `ops::workspace::open_project_chat` dans le crate `claudette`. Celle-ci récupère ou crée le
  workspace `repository` (sans aucune opération git d'écriture ni script), crée une nouvelle session
  et retourne `{ workspace, session }`. Le workspace porte le nom réservé `@project`, invalide pour
  un nom saisi (`is_valid_workspace_name` n'accepte que `[A-Za-z0-9-]`), donc sans collision avec
  `UNIQUE(repository_id, name)`. Il est affiché sous le nom du dépôt.
- **Unicité**: index unique partiel `ON workspaces(repository_id) WHERE kind = 'repository'`.
- **Pas d'IPC de création**: la spec exclut la création depuis le mobile. La CLI et les clients
  distants pilotent les sessions existantes avec les méthodes actuelles (`list_chat_sessions`,
  `send_chat_message`…).

## R9. Restauration à l'effacement (FR-015)

- **Constat**: les checkpoints sont capturés **à la fin** de chaque tour (`send.rs:3311`,
  `create_turn_checkpoint`). La rétention (`checkpoint_retention_count`) garde les N derniers snapshots
  **par workspace**, donc partagés entre tous les chats du projet. L'état « avant le premier message »
  n'existe pas aujourd'hui, et le premier checkpoint peut perdre ses fichiers.
- **Decision**: pour un workspace `repository`, juste avant le premier tour d'une session, un snapshot
  de référence est capturé (même mécanisme `snapshot::save_snapshot`), marqué comme référence de
  session et exclu de l'élagage par rétention. `clear_conversation` avec `restore_files` restaure ce
  snapshot (`snapshot::restore_snapshot`) au lieu de `git::restore_to_commit(merge_base)`. Sans snapshot
  de référence (aucun message envoyé), l'option n'est pas proposée.
- **Coût**: un snapshot complet du dossier par chat de projet. Il est supprimé quand la session est
  archivée ou que le dépôt est retiré.
- **Alternatives considered**:
  - premier checkpoint existant : état *après* le premier tour, et élagable ;
  - commit `HEAD` au début de la conversation : ne capture pas les fichiers non commités de
    l'utilisateur.

## R10. Dossier du projet absent (cas limite)

- **Decision**: le chemin d'envoi (`send.rs:1121`, et steer `:969`) vérifie, pour un workspace
  `repository`, que `worktree_path` existe. Sinon il renvoie « Le dossier du projet est introuvable :
  <path> » avant de lancer l'agent. L'historique reste lisible (aucune écriture).

## R11. Création concurrente et chevauchements de chemins

- `open_project_chat` crée la ligne par `INSERT … ON CONFLICT DO NOTHING` puis la relit, dans une
  transaction, contre l'index unique partiel.
- `claude_teammate_bridge.rs:235` choisit déjà le préfixe de chemin le plus long. Un test vérifie
  qu'un cwd situé dans une worktree placée sous le dépôt reste attribué à cette worktree et pas au
  workspace `repository`.

## R12. Capacités de chat inchangées (FR-010)

- Le terminal (`pty.rs:132`, cwd = `worktree_path`), le mode plan, les questions de l'agent, les pièces
  jointes et le choix du modèle sont indexés par session ou par workspace et prennent le dossier du
  dépôt sans changement.

## R8. Visibilité (FR-013) et contrats existants

- **Decision**: le workspace `repository` est exclu de `filterSidebarWorkspaces`
  (`utils/sidebarJumpTargets.ts`), et donc des raccourcis ⌘1–9, de la liste « Active Workspaces » du
  Dashboard global, du FuzzyFinder et des groupes par statut. La vue du projet (`Dashboard.tsx`, branche
  `scopedRepo`) liste ses sessions actives dans une section « Chats ».
- **CLI**: le tableau de `claudette workspace list` exclut les workspaces `repository`, ce qui garde la
  sortie actuelle à l'identique. La sortie JSON gagne le champ `kind` (ajout seulement).
- **Mobile / distant**: `Workspace` est sérialisé tel quel, et le champ `kind` s'ajoute. Le mobile
  (`src/ui-mobile/src/screens/WorkspacesScreen.tsx:72`, `ChatListScreen.tsx:59`,
  `ChatScreen.tsx:303`) affiche `w.name`. Il faut un petit helper d'affichage pour montrer le nom du
  dépôt au lieu de `@project`. C'est le seul changement mobile.
