# Contrat : commandes de l'arbre git

Les commandes existent sous la même forme en trois endroits :
- **Tauri** : `invoke("<nom>", {camelCase})`, dans `src-tauri/src/commands/git_graph.rs`, enregistrées dans `main.rs` ;
- **hôte desktop partagé** : `RpcHost::dispatch` dans `src-tauri/src/remote_host.rs` ;
- **serveur autonome** : `src-server/src/handler.rs`.

Sur le réseau, les paramètres sont en snake_case. Le frontend appelle ces commandes par `viaWorkspace(workspaceId, "<nom>", params, localFn)`.

Toutes les commandes sont **en lecture seule** (FR-013). Elles résolvent le dépôt, la branche de base et les espaces de travail à partir de `workspace_id`, côté hôte. Les types sont décrits dans [data-model.md](../data-model.md).

## `load_git_graph`

| Paramètre | Type | Règle |
|---|---|---|
| `workspace_id` | string | Obligatoire. |
| `include_remotes` | bool | `false` : refs locales et branche de base. `true` : en plus, toutes les refs distantes (sauf `*/HEAD`). |
| `limit` | u32 | 1 ≤ limit ≤ 10 000 ; au-delà, l'hôte ramène la valeur à 10 000. |
| `until_hash` | string, facultatif | Commit à inclure (FR-011). Même validation que `commit_hash`. L'hôte élargit la limite jusqu'à le contenir (tranche de 200 supérieure), sans dépasser 10 000 ; sinon il garde `limit` et renvoie `target_beyond_cap: true`. |

**Retour** : `GitGraph`.

**Erreurs** (chaîne d'erreur, comme les commandes existantes) :
- `workspace not found` ;
- `repository path not found` ;
- `git failed: <stderr>`.

Un dépôt sans commit n'est **pas** une erreur : il renvoie `commits: []`, `refs: []`, et ses worktrees.

## `load_git_graph_fingerprint`

| Paramètre | Type |
|---|---|
| `workspace_id` | string |
| `include_remotes` | bool |

**Retour** : `{ fingerprint: string }`. La valeur est égale à `GitGraph.fingerprint` tant qu'aucune ref, aucune HEAD de worktree ni aucun worktree n'a changé. Elle ne lance ni `git log` ni `git status`.

## `load_worktree_states`

| Paramètre | Type |
|---|---|
| `workspace_id` | string |

**Retour** : `{ path: string, state: "clean" | "dirty" | "missing" | "unknown" }[]`, un élément par worktree du dépôt. Chaque `git status` a un délai de 5 s ; un délai dépassé donne `unknown`.

## `load_commit_detail`

| Paramètre | Type | Règle |
|---|---|---|
| `workspace_id` | string | |
| `commit_hash` | string | 4 à 40 caractères hexadécimaux ; sinon l'erreur `Invalid commit hash`. |
| `include_remotes` | bool | Ajoute les distantes à `containing_refs`. |

**Retour** : `CommitDetail`. Les fichiers sont comparés au premier parent ; `containing_worktrees` liste les worktrees dont la HEAD contient le commit.

## `load_commit_file_diff_first_parent`

| Paramètre | Type | Règle |
|---|---|---|
| `workspace_id` | string | |
| `commit_hash` | string | Même validation que ci-dessus. |
| `file_path` | string | Même validation que `diff::commit_file_diff` (pas de chemin absolu ni de `..`). |

**Retour** : `FileDiff`, la même structure que `load_commit_file_diff` (diff analysé par `diff::parse_unified_diff`), calculé par rapport au premier parent.

## Compatibilité

- `load_commit_file_diff` existe déjà et **ne change pas**.
- Un hôte plus ancien qui ne connaît pas ces méthodes renvoie une erreur de méthode inconnue. Le frontend la traduit en état `unsupported` : message « Cette machine ne prend pas encore en charge l'arbre git », sans nouvelle tentative automatique.
