# Data Model: Arbre git avec les worktrees de chaque branche

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Aucune donnée persistée : pas de migration, pas de nouveau réglage. Toutes les structures sont calculées à la demande par l'hôte, celui qui possède le dépôt (local ou machine appairée). Elles sont sérialisées en JSON snake_case. Côté Rust, elles vivent dans `src/model/git_graph.rs` et dérivent `Serialize` ; côté TypeScript, dans `src/ui/src/types/gitGraph.ts`.

## GitGraph

Réponse de `load_git_graph`, décrite dans [contracts/git-graph-commands.md](./contracts/git-graph-commands.md).

| Champ | Type | Règle |
|---|---|---|
| `commits` | `GraphCommit[]` | Ordre topologique : un enfant avant ses parents. Longueur ≤ `limit`. |
| `refs` | `GraphRef[]` | Toutes les références affichées, **indépendamment** des commits chargés (FR-011). |
| `worktrees` | `GraphWorktree[]` | Tous les worktrees du dépôt, y compris le dépôt principal (SC-003). |
| `base_ref` | `string \| null` | Nom court de la branche principale (FR-007) ; `null` si elle n'a pas pu être résolue. |
| `has_more` | `boolean` | `true` si l'historique contient des commits au-delà de la limite effective. |
| `limit` | `number` | Limite effective appliquée (≤ 10 000) ; plus grande que celle demandée quand `until_hash` l'a imposée. |
| `target_beyond_cap` | `boolean` | `true` si `until_hash` était fourni et que le commit n'est pas parmi les 10 000 premiers (FR-011). |
| `fingerprint` | `string` | Empreinte des références et des worktrees (R8), réutilisée par le sondage. |

## GraphCommit

| Champ | Type | Règle |
|---|---|---|
| `hash` | `string` | 40 caractères hexadécimaux, identité unique. |
| `short_hash` | `string` | 7 premiers caractères (FR-002). |
| `parents` | `string[]` | 0 pour une racine, 1 pour un commit ordinaire, au moins 2 pour une fusion ; premier parent en tête. |
| `author` | `string` | Nom de l'auteur. |
| `date` | `string` | ISO 8601 (date d'auteur). |
| `subject` | `string` | Première ligne du message. |

## GraphRef

| Champ | Type | Règle |
|---|---|---|
| `name` | `string` | Nom court (`main`, `feat/x`, `origin/main`). |
| `kind` | `"local" \| "remote"` | Les distantes ne sont présentes que si l'option est active, sauf la branche principale (FR-007, FR-014). |
| `target` | `string` | Hash du commit de tête. |
| `is_base` | `boolean` | Exactement une ref à `true` quand `base_ref` est non nul. |
| `ahead` | `number \| null` | Commits présents dans la ref et absents de la base. `null` pour la base elle-même, pour une ref distante ou si le calcul a échoué (FR-017). |
| `behind` | `number \| null` | Commits présents dans la base et absents de la ref ; mêmes règles que `ahead`. |

## GraphWorktree

| Champ | Type | Règle |
|---|---|---|
| `path` | `string` | Chemin canonique sur l'hôte. |
| `is_main` | `boolean` | `true` pour le dossier du dépôt lui-même. |
| `branch` | `string \| null` | Nom court de la branche extraite ; `null` si la HEAD est détachée. |
| `head` | `string` | Hash pointé ; c'est le point de rattachement dans l'arbre (FR-004). |
| `state` | `"clean" \| "dirty" \| "missing" \| "unknown"` | Voir les transitions ci-dessous (FR-009, FR-010). |
| `workspace_id` | `string \| null` | Identifiant de l'espace de travail Claudette dont le `worktree_path` canonique est égal à `path` ; `null` pour un worktree externe (FR-005, FR-008). |
| `workspace_name` | `string \| null` | Nom affiché de cet espace de travail (FR-004). |

**Rattachement** : un worktree est affiché sur la ref locale `branch` quand elle existe, sinon sur le commit `head` avec la mention « détaché ».

**Transitions de `state`** (réévaluées à chaque relecture, sans mémoire) :

```text
dossier absent ou marqué prunable  → missing   (pas de git status)
git status en échec / délai dépassé → unknown
git status vide                     → clean
git status non vide                 → dirty
```

`load_git_graph` renvoie `unknown` pour les worktrees existants ; l'état réel arrive par `load_worktree_states` (cadence lente, R8).

## CommitDetail

Réponse de `load_commit_detail` (FR-016).

| Champ | Type | Règle |
|---|---|---|
| `hash`, `short_hash`, `parents`, `author`, `date` | comme `GraphCommit` | |
| `author_email` | `string` | |
| `message` | `string` | Message complet. |
| `files` | `CommitFile[]` | Par rapport au **premier parent** ; pour une racine, par rapport à l'arbre vide. |
| `containing_refs` | `string[]` | Noms courts des refs qui contiennent le commit (`for-each-ref --contains`) : branches locales, la base, les distantes si l'option est active. |
| `containing_worktrees` | `string[]` | Chemins des worktrees dont la HEAD contient le commit, y compris détachés ; les `missing` sont exclus (FR-016). |

## CommitFile

| Champ | Type | Règle |
|---|---|---|
| `path` | `string` | Chemin dans le dépôt (nouveau chemin en cas de renommage). |
| `old_path` | `string \| null` | Renseigné pour un renommage ou une copie. |
| `status` | `"added" \| "modified" \| "deleted" \| "renamed" \| "copied" \| "type_changed"` | Tiré de `--name-status`. |

## État de vue (frontend, non persisté)

Conformément à CLAUDE.md, cet état d'interface vit dans un hook local du composant, pas dans la base :

- `includeRemotes: boolean`, `false` par défaut (FR-014) ;
- `limit: number`, 200 au départ, +200 par « charger plus » sans dépasser 10 000, remplacée par `GitGraph.limit` après un « aller à » ;
- `tooOldTarget: string | null`, le hash à afficher dans le message « trop ancien » ;
- `selectedCommit: string | null`, le commit dont le détail est ouvert ;
- `status: "loading" | "ready" | "empty" | "error" | "unsupported"`.

Seul ajout au store global : `diffCommitParentMode: "default" | "first-parent"` dans `diffSlice` (R7).
