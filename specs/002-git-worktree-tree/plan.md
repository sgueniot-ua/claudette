# Implementation Plan: Arbre git avec les worktrees de chaque branche

**Branch**: `002-git-worktree-tree` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-git-worktree-tree/spec.md`

## Summary

Ajouter au panneau latéral droit de l'application desktop un onglet « Arbre git ». Il montre l'historique du dépôt de l'espace de travail sélectionné sous forme de graphe, avec :
- les branches locales (et les distantes en option), la branche de base toujours visible ;
- les compteurs d'avance et de retard sur la base ;
- chaque worktree rattaché à sa branche ou à son commit (espace de travail Claudette ou externe, modifié, détaché, introuvable) ;
- le détail d'un commit avec ses fichiers et leur diff par rapport au premier parent.

Approche :
- **Backend** : un nouveau module en lecture seule `src/git_graph/` dans la crate `claudette`, exposé par 5 nouvelles méthodes câblées en local (Tauri), sur l'hôte desktop partagé et sur le serveur autonome.
- **Frontend** : un dossier `components/git-tree/` avec un layout de lanes en TypeScript pur et un rendu SVG fenêtré.
- **Rafraîchissement** : par empreinte sondée toutes les 3 s.

Le détail des choix est dans [research.md](./research.md).

## Technical Context

**Language/Version**: Rust édition 2024 (toolchain 1.94, `mise.toml`) ; TypeScript strict, React

**Primary Dependencies**: Tauri 2, Tokio, serde ; React, Zustand, i18next, lucide-react. **Aucune nouvelle dépendance.**

**Storage**: N/A, rien n'est persisté : pas de migration ni de réglage (voir [data-model.md](./data-model.md)).

**Testing**: `cargo test` (dépôts git éphémères via `tempfile::tempdir()`, `#[tokio::test]`) ; vitest + happy-dom ; `bunx tsc -b` ; `bun run lint:css`

**Target Platform**: application desktop macOS, Linux et Windows ; hôte distant = desktop « Share this machine » ou `claudette-server`. Le mobile est hors périmètre (FR-015).

**Project Type**: application desktop (Tauri) avec un serveur distant embarqué ou autonome

**Performance Goals**: premier affichage < 2 s sur 50 000 commits (SC-002) ; changement de refs visible en < 5 s (SC-004) ; état « modifié » à jour en < 10 s (SC-006) ; défilement fluide de 1 000 lignes chargées

**Constraints**:
- lecture seule (FR-013) ;
- git de l'hôte distant de version inconnue (repli sans `%(ahead-behind)`, pas de `--diff-merges`) ;
- aucun `Command::new` brut (`clippy.toml`) ;
- couleurs en `var(--token)` uniquement ;
- `RUSTFLAGS=-Dwarnings`.

**Scale/Scope**: dépôts jusqu'à ~100 branches et ~20 worktrees ; 200 commits par tranche

Aucun point « NEEDS CLARIFICATION » ne reste : les inconnues techniques sont tranchées dans research.md (R1 à R12), et les six choix de comportement ont été validés par l'utilisateur et intégrés à la spec le 2026-11-22. **Révision du 2026-11-22**, après `/speckit-analyze` : `until_hash` et le plafond de 10 000 (R2), les worktrees qui contiennent un commit calculés côté hôte (R7), SC-006 (R8) et une mesure scriptée de SC-002 (R12).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` est encore le **modèle vierge** : il ne contient aucun principe ratifié. À défaut, les portes ci-dessous sont les règles de `CLAUDE.md` du dépôt. Les remplacer par une vraie constitution passe par `/speckit-constitution`, avec l'accord de l'équipe.

| Porte (source : CLAUDE.md) | Avant Phase 0 | Après Phase 1 |
|---|---|---|
| Logique métier dans la crate `claudette`, commandes Tauri minces | ✅ | ✅ `src/git_graph/` ; `commands/git_graph.rs` ne fait que résoudre le workspace et appeler |
| Types de données dans `model/`, tous `Serialize` | ✅ | ✅ `src/model/git_graph.rs` |
| God files : diff chirurgical (`git.rs`, `diff.rs`, `RightSidebar.tsx`, `services/tauri.ts`, `ipc.rs`) | ✅ | ✅ `git.rs` inchangé ; `diff.rs` : `validate_file_path` passe en `pub(crate)` ; `RightSidebar.tsx` gagne un bouton et une ligne ; wrappers dans `services/tauri/gitGraph.ts` |
| Régression : aucun contrat existant modifié | ✅ | ✅ `load_commit_file_diff`, `WorktreeInfo`, `list_worktrees` intacts ; une nouvelle valeur d'onglet, additive |
| Pas de `Command::new` brut | ✅ | ✅ `crate::process::command` |
| Couleurs en tokens, `lint:css` | ✅ | ✅ palette de tokens existants (R11) |
| Libellés localisés | ✅ | ✅ `t("gitTree.*")`, `sidebar.json` en anglais |
| Docs dans la même PR | ✅ | ✅ nouvelle page `site/src/content/docs/features/git-tree.mdx` + entrée dans `site/astro.config.mjs` |
| Dépendances avec parcimonie (< 30 Mo) | ✅ | ✅ aucune ajoutée |
| Accès distant : méthode câblée sur les deux hôtes | ✅ | ✅ `remote_host.rs` + `src-server/src/handler.rs` (R9) |

Aucune violation : la section Complexity Tracking est vide.

## Project Structure

### Documentation (this feature)

```text
specs/002-git-worktree-tree/
├── spec.md
├── plan.md              # ce fichier
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── git-graph-commands.md
│   └── git-tree-tab-ui.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── git_graph/                       # NOUVEAU module (dossier, un fichier par responsabilité) :
│   ├── mod.rs                       #   constantes, run_git, validate_hash, load_git_graph
│   ├── context.rs                   #   workspace → dépôt, base, espaces de travail
│   ├── log.rs                       #   lecture topo, has_more, position (until_hash)
│   ├── refs.rs                      #   refs, base, avance/retard
│   ├── worktrees.rs                 #   worktrees, état, rattachement Claudette
│   ├── detail.rs                    #   détail de commit, diff premier parent
│   └── fingerprint.rs               #   empreinte
├── diff.rs                          # validate_file_path passe en pub(crate) (un mot)
├── model/git_graph.rs               # NOUVEAU : GitGraph, GraphCommit, GraphRef, GraphWorktree, CommitDetail, CommitFile
├── model/mod.rs                     # + pub mod git_graph
└── lib.rs                           # + pub mod git_graph

src-tauri/src/
├── commands/git_graph.rs            # NOUVEAU : 5 #[tauri::command], résolution workspace → dépôt, base, espaces de travail
├── commands/mod.rs                  # + pub mod git_graph
├── main.rs                          # + enregistrement des 5 commandes
└── remote_host.rs                   # + 5 bras dans RpcHost::dispatch

src-server/src/handler.rs            # + 5 bras + handle_* (appellent claudette::git_graph)

src/ui/src/
├── types/gitGraph.ts                # NOUVEAU : miroir TS du modèle
├── services/tauri/gitGraph.ts       # NOUVEAU : wrappers viaWorkspace ; détection « méthode inconnue » → unsupported
├── services/tauri/index.ts          # + ré-export
├── components/git-tree/             # NOUVEAU
│   ├── GitTreePanel.tsx             #   conteneur : états, sondage, barre d'outils
│   ├── layoutGitGraph.ts            #   layout des lanes (pur) + tests
│   ├── GitGraphRows.tsx             #   SVG fenêtré + lignes
│   ├── RefList.tsx                  #   liste complète branches/worktrees (FR-011)
│   ├── WorktreeBadge.tsx            #   marque de worktree (états, navigation)
│   ├── CommitDetail.tsx             #   détail + fichiers → ouverture du diff
│   ├── useGitGraph.ts               #   chargement, limite, empreinte 3 s, états 10 s
│   └── GitTree.module.css
├── components/right-sidebar/RightSidebar.tsx   # + bouton d'onglet + panneau
├── components/diff/DiffViewer.tsx              # + choix de la commande selon diffCommitParentMode
├── stores/slices/uiSlice.ts                    # alias RightSidebarTab (+ "git-tree")
├── stores/slices/diffSlice.ts                  # + diffCommitParentMode, remis à "default" avec diffSelectedCommitHash
└── locales/en/sidebar.json                     # + clés gitTree.*

site/src/content/docs/features/git-tree.mdx     # NOUVEAU
site/astro.config.mjs                           # + entrée de navigation
```

**Structure Decision** : on garde la structure existante à cinq crates. La logique va dans la crate `claudette` (partagée par les deux hôtes), le transport dans `src-tauri` et `src-server`, et l'interface dans un dossier de composants dédié. Les seuls fichiers existants touchés sont des points d'enregistrement ; un seul comportement existant change : `DiffViewer` choisit sa commande selon le mode.

## Couverture de la spec

| Exigence | Où dans le design | Tests prévus |
|---|---|---|
| FR-001 | onglet `git-tree`, `GitTreePanel` | vitest : l'onglet s'affiche et monte le panneau ; garde le dépôt de l'espace de travail sélectionné |
| FR-002 | `GraphCommit`, `GitGraphRows` | Rust : parsing du log (sujet, auteur, date, hash court) ; vitest : rendu d'une ligne |
| FR-003 | `GraphRef.target` | Rust : refs locales et leurs cibles ; vitest : étiquette sur le bon commit |
| FR-004 | `GraphWorktree.branch/head` | Rust : rattachement branche / détaché ; vitest : marque sur la branche ou sur le commit |
| FR-005 | `GraphWorktree.workspace_id` (chemins canoniques) | Rust : worktree géré vs externe, y compris un lien symbolique ; vitest : style plein / contour |
| FR-006 | `RefList`, étiquette sans marque | vitest : branche sans worktree visible et distinguée |
| FR-007 | résolution de la base (R4), `is_base`, toujours dans les tips | Rust : base distante présente même sans `include_remotes` ; vitest : marque « base » |
| FR-008 | `WorktreeBadge` → sélection de l'espace de travail | vitest : le clic appelle la sélection ; aucun appel pour un worktree externe |
| FR-009 | `load_worktree_states` | Rust : clean / dirty (fichier modifié, fichier non suivi) ; vitest : indicateur |
| FR-010 | états `missing`, détaché | Rust : dossier supprimé → missing sans erreur ; HEAD détachée ; vitest : libellés |
| FR-011 | `limit` croissante, `has_more`, `RefList` indépendante, `until_hash`, plafond 10 000 | Rust : `has_more` ; refs complètes au-delà de la limite ; `until_hash` trouvé → limite arrondie à 200 et commit présent ; introuvable sous 10 000 → `target_beyond_cap` ; vitest : « Load more » (+200), disparu à 10 000 au profit du message de limite, clic sur une ref hors fenêtre → arbre élargi et commit sélectionné, bandeau « too old » avec copie |
| FR-012 | empreinte 3 s, états 10 s (R8) | Rust : l'empreinte change sur commit, branche ou worktree, et reste stable sinon ; vitest (faux timers) : rechargement seulement si l'empreinte change |
| FR-013 | seulement des commandes git de lecture | Rust : après chaque fonction, `git status`, refs et reflog du dépôt de test sont inchangés |
| FR-014 | `include_remotes`, case à cocher | Rust : distantes absentes ou présentes ; vitest : bascule |
| FR-015 | wrappers `viaWorkspace`, câblage des deux hôtes, état `unsupported` | vitest : routage distant (modèle `remoteRouting.test.ts`) et méthode inconnue → unsupported ; Rust : bras du serveur autonome |
| FR-016 | `load_commit_detail`, `load_commit_file_diff_first_parent`, `diffCommitParentMode` | Rust : fichiers d'un commit ordinaire, d'une fusion (premier parent, liste non vide) et d'une racine ; diff premier parent ; refs qui contiennent le commit ; worktrees qui le contiennent, dont un détaché, sans les `missing` ; vitest : détail, copie du hash, ouverture du diff en mode first-parent ; le mode revient à `default` |
| FR-017 | `%(ahead-behind)` + repli `rev-list` | Rust : compteurs sur un dépôt divergent ; même résultat avec le repli forcé |
| SC-002 | limite de 200, mesure (R12) | Rust `#[ignore]` `git_graph_perf_50k` (hôte < 1,5 s, lancé tôt) ; quickstart, scénarios 10 et 14 |
| SC-003 | worktrees tous renvoyés, HEAD en tips | Rust : N worktrees créés → N renvoyés, dont les détachés |
| SC-004 | empreinte 3 s | quickstart, scénario 7 ; vitest (faux timers) |
| SC-006 | états toutes les 10 s, premier relevé à l'ouverture | vitest (faux timers) : relevé à l'ouverture puis toutes les 10 s, marque posée et retirée ; quickstart, scénario 6 |
| Edge : dépôt vide | `commits: []` sans erreur, état `empty` | Rust : dépôt sans commit → graphe vide, worktree principal présent ; vitest : message « no commits yet » |
| Edge : lecture impossible | erreur → état `error` + Retry | Rust : dossier qui n'est pas un dépôt → erreur `git failed` ; vitest : message, Retry relance le chargement, le reste de l'interface reste monté |
| Edge : hôte non compatible | méthode inconnue → `unsupported` | vitest (inclus dans FR-015) |

## Complexity Tracking

Aucune violation des portes, rien à justifier.
