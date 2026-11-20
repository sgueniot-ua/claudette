# Implementation Plan: Chats de projet sans worktree

**Branch**: `sgueniot-ua/feat-multi-chat-no-worktree` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-chat-without-worktree/spec.md`

## Summary

L'utilisateur lance un ou plusieurs chats d'agent directement dans le dossier d'un dépôt, depuis la vue
du projet, sans worktree, sans branche et sans script. Approche (choix utilisateur, option A) : une
colonne `workspaces.kind`. Un seul workspace `repository` par dépôt, avec
`worktree_path = Repository.path`. Chaque chat de projet est une session (onglet) de ce workspace.

Toute la mécanique existante (cwd de l'agent, sessions concurrentes, routines, terminal, env, MCP,
checkpoints) fonctionne telle quelle. Des gardes explicites, dans le crate `claudette`, protègent le
checkout principal des chemins pensés pour une worktree : archive, suppression, scripts, renommage
automatique de branche. Voir [research.md](./research.md).

## Technical Context

**Language/Version**: Rust 1.94, édition 2024 ; TypeScript strict (React 19, Vite)

**Primary Dependencies**: Tauri 2, rusqlite (bundled), Tokio, Zustand, react-i18next. Aucune nouvelle dépendance.

**Storage**: SQLite. Une migration additive (`workspaces.kind` + index unique partiel).

**Testing**: `cargo test` (dépôts `tempfile::tempdir()`, `#[tokio::test]`) ; vitest + `bunx tsc -b`

**Target Platform**: desktop macOS, Linux, Windows ; client mobile (affichage seulement)

**Project Type**: desktop-app (workspace Cargo à 5 crates + frontend React) plus client mobile

**Performance Goals**: ouverture d'un chat de projet en moins de 2 s (US1-1) ; aucun coût au démarrage

**Constraints**: aucune opération git d'écriture ni script sur le checkout principal à la création ;
contrats existants inchangés pour `kind = worktree`

**Scale/Scope**: au moins 3 chats de projet simultanés par dépôt (SC-003)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principe | Statut | Justification |
|---|---|---|
| I. Layered Crates, Thin Shells | ✅ | logique dans `src/ops/workspace.rs` et `src/db/` ; la commande Tauri `open_project_chat` est un wrapper ; gardes dans le core, donc valables pour l'interface, la CLI et le WSS |
| II. Pure Data Model | ✅ | `WorkspaceKind` dans `model/workspace.rs` avec `Serialize` ; l'état d'interface (section ouverte) n'est pas persisté |
| III. Contract Stability (NON-NEGOTIABLE) | ✅ | ajout seulement (champ `kind`, commande) ; `kind = worktree` inchangé ; tableau CLI identique ; changements de comportement listés dans contracts §2 et couverts par des tests |
| IV. Forward-Only Migrations | ✅ | nouveau fichier `<UTC>_workspace_kind.sql`, `ADD COLUMN … DEFAULT`, `CREATE UNIQUE INDEX IF NOT EXISTS` |
| V. Design Tokens Only | ✅ | badge et avertissements avec les `var(--…)` existants ; `lint:css` |
| VI. Platform Safety | ✅ | aucun nouveau spawn de processus ; aucune invite TCC |
| VII. Surgical Changes to God Files | ✅ avec attention | filtre dans `utils/sidebarJumpTargets.ts` (pas dans `Sidebar.tsx`) ; section « Chats » extraite en composant `ProjectChatsSection.tsx`, branché dans `Dashboard.tsx` ; `ChatPanel.tsx` : seul le badge d'en-tête passe par `WorkspacePanelHeader.tsx` |
| Workflow : documentation | ✅ | `site/src/content/docs/features/project-chats.mdx` (nouveau, ajouté à la sidebar `astro.config.mjs`) + mention dans `parallel-agents.mdx` et `cli-client.mdx` |

**Re-check post-design** : ✅. Aucune violation, la Complexity Tracking est vide.

## Project Structure

### Documentation (this feature)

```text
specs/001-chat-without-worktree/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── migrations/<UTC>_workspace_kind.sql      # nouveau
├── migrations/mod.rs                        # + entrée MIGRATIONS
├── model/workspace.rs                       # WorkspaceKind, is_repository_rooted()
├── db/workspace.rs                          # kind en lecture/écriture, get_repository_workspace()
├── db/chat.rs                               # (réutilise archive_chat_session_only)
├── ops/workspace.rs                         # open_project_chat ; gardes archive/restore/delete
└── diff.rs                                  # base HEAD pour repository (changement minimal)
src-tauri/src/commands/
├── workspace.rs                             # open_project_chat (wrapper) ; gardes delete/bulk/setup
├── repository.rs                            # remove_repository / relink_repository
├── chat/session.rs                          # archive sans recréation pour repository
├── chat/naming.rs                           # garde auto-rename
└── storage.rs                               # exclusion des stats
src-cli/src/commands/workspace.rs            # filtre du tableau
src/ui/src/
├── types/workspace.ts                       # kind
├── services/tauri/workspace.ts              # openProjectChat
├── utils/sidebarJumpTargets.ts              # exclusion de kind repository
├── components/layout/ProjectChatsSection.tsx  # nouveau
├── components/layout/Dashboard.tsx          # branchement de la section ; exclusion de la liste globale
├── components/shared/WorkspacePanelHeader.tsx # badge Projet
├── components/modals/RollbackModal.tsx      # avertissements FR-014/015/017
└── locales/*/{chat,modals,sidebar}.json     # nouvelles clés (6 langues)
src/ui-mobile/src/screens/*.tsx              # nom affiché
site/src/content/docs/features/project-chats.mdx  # nouveau
```

**Structure Decision**: structure existante du workspace Cargo et du frontend. Aucun nouveau crate ni
module de premier niveau. Le seul nouveau composant est `ProjectChatsSection.tsx`, à côté de
`Dashboard.tsx`.

## Complexity Tracking

Aucune violation de la constitution.
