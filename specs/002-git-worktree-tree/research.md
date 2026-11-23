# Research: Arbre git avec les worktrees de chaque branche

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-11-22

Chaque section : Décision, Justification, Alternatives écartées. Les références de code pointent l'état de `main` au 2026-11-22.

## R1. Où vit la logique git

**Décision** : nouveau module `src/git_graph.rs` dans la crate `claudette`. Il expose des fonctions `async` pures (chemin du dépôt en entrée, structures `Serialize` en sortie) et réutilise `git::list_worktrees` et `git::default_branch`. Un petit helper `run_git` local au module (même forme que `src/git.rs:207`, construit par `crate::process::command`) évite d'élargir la visibilité de celui de `git.rs`.

**Justification** : `src/git.rs` et `src/diff.rs` sont des god files (CLAUDE.md). Placer la logique dans la crate `claudette` la rend utilisable par les deux hôtes (desktop et serveur autonome) sans dupliquer.

**Alternatives écartées** : ajouter les fonctions à `git.rs` (god file) ; implémenter dans `src-tauri` (le serveur autonome ne pourrait pas s'en servir).

## R2. Lecture du graphe de commits

**Décision** : `git log --topo-order --format=<champs séparés par \x1f, enregistrements par \x1e> --max-count=<limit> <tips…>` avec les champs `%H %P %an %aI %s`. Les tips sont : les branches locales, la branche de base (FR-007), les HEAD de tous les worktrees (y compris détachés) et, si l'option est active, les branches distantes. Pagination : la vue redemande avec une `limit` plus grande (200, 400, 600…) plutôt qu'un `--skip`. Un rechargement complet depuis le haut suit tout changement de références.

**Aller à un commit (FR-011)** : `load_git_graph` accepte un `until_hash` facultatif. L'hôte lance d'abord `git log --topo-order --format=%H --max-count=10000 <tips…>`, ce qui ne lit que les hash, et cherche la position du commit.
- S'il le trouve, la limite effective est cette position arrondie à la tranche de 200 supérieure, puis l'hôte lit les commits complets.
- S'il ne le trouve pas, l'hôte renvoie le graphe avec la limite demandée et `target_beyond_cap: true`. La vue affiche alors le message « Ce commit est trop ancien pour être affiché dans l'arbre », avec l'identifiant copiable (spec, clarification du 2026-11-22).
- Le plafond de 10 000 vaut pour toutes les limites, demandées ou calculées.

**Justification** :
- `--topo-order` garantit qu'un enfant précède ses parents. C'est la condition pour attribuer les colonnes (lanes) en une passe.
- Ajouter les HEAD des worktrees comme tips rend visibles les worktrees détachés, qu'un log lancé depuis les seules branches n'atteint pas (FR-004, SC-003).
- `--skip` décale la fenêtre quand un commit arrive entre deux pages. Relire avec une limite croissante donne un résultat cohérent ; c'est un coût linéaire acceptable jusqu'à quelques milliers de commits.

**Alternatives écartées** : `--date-order` (casse l'ordre parent/enfant si les horloges divergent) ; `git log --graph` (sortie ASCII à re-parser) ; bibliothèque git2/gix (nouvelle dépendance lourde, contraire à la cible de taille du binaire).

## R3. Disposition du graphe (lanes)

**Décision** : calcul côté frontend, dans une fonction TypeScript pure `layoutGitGraph(commits) → rows` (colonne de chaque commit, segments vers ses parents). Testée unitairement avec vitest. Rendu en SVG fait main, une ligne par commit, hauteur fixe, fenêtrage manuel (seules les lignes visibles sont montées).

**Justification** : aucune bibliothèque de graphe ni de virtualisation n'est présente dans `src/ui/package.json`, et le besoin (lanes + hauteur fixe) tient en peu de code. Une fonction pure se teste sans DOM. Le backend reste agnostique de l'affichage.

**Alternatives écartées** : layout en Rust (couple le format d'affichage au protocole distant) ; ajout de `@tanstack/react-virtual` ou d'une lib de graphe (dépendance pour un besoin simple).

## R4. Branche principale (FR-007, FR-017)

**Décision** : la branche principale est résolue comme dans `diff.rs:107-160` : `Repository.base_branch` si défini, sinon `git::default_branch(repo.path, repo.default_remote)`. Elle est toujours ajoutée aux tips et aux références affichées, marquée `is_base`, même si c'est une branche distante et que les distantes sont masquées.

**Justification** : réponse utilisateur du 2026-11-22 (spec, Clarifications). C'est la même base que celle déjà utilisée par l'onglet Changes, donc les compteurs concordent avec le reste de l'application.

**Alternatives écartées** : la branche locale homonyme (écartée par l'utilisateur).

## R5. Avance et retard

**Décision** : une seule commande `git for-each-ref --format='%(refname)%00%(ahead-behind:<base>)' refs/heads`. Si git la refuse (git < 2.41, possible sur une machine appairée), repli sur un `git rev-list --left-right --count <base>...<branche>` par branche, lancés en parallèle et bornés à 8 simultanés.

**Justification** : `%(ahead-behind:)` calcule tout en un processus. La version de git de l'hôte distant n'est pas maîtrisée, d'où le repli.

**Alternatives écartées** : `rev-list` seul (N sous-processus à chaque rafraîchissement) ; calcul côté frontend à partir des commits chargés (faux quand la base est hors fenêtre).

## R6. Worktrees : état, rattachement, gestion par Claudette

**Décision** :
- La liste vient de `git worktree list --porcelain`. Un nouveau parseur dans `git_graph.rs` lit en plus `detached` et `prunable`. `git::list_worktrees` et `WorktreeInfo` restent inchangés.
- Un dossier introuvable (`prunable` ou `!Path::is_dir()`) donne l'état `missing`, sans `git status`.
- L'état modifié (`dirty`) vient de `git -C <worktree> status --porcelain --untracked-files=normal`, sortie non vide = modifié.
- L'appartenance à Claudette se calcule côté hôte. Le chemin canonique du worktree est comparé aux `worktree_path` canoniques des espaces de travail du dépôt en base. L'identifiant de l'espace de travail est renvoyé.

**Justification** :
- Pour un espace de travail distant, seul l'hôte connaît ses chemins disques et sa base : le calcul doit se faire là-bas (FR-005, FR-008).
- La canonicalisation évite les faux négatifs (liens symboliques comme `/private/var` sur macOS).
- `git status` est la seule source fiable de l'état modifié ; il est coûteux, d'où une cadence séparée (R8).

**Alternatives écartées** : comparer côté frontend avec les espaces de travail du store (chemins non canoniques ; ambigu à distance) ; modifier `WorktreeInfo` (utilisé par `discover_worktrees`, risque de régression).

## R7. Détail d'un commit et diff (FR-016)

**Décision** :
- Nouvelle fonction `commit_detail(repo, hash)`. Elle lance `git show -m --first-parent --no-color --format=<champs> --name-status <hash>` et renvoie le message complet, l'auteur, la date, les parents et les fichiers modifiés par rapport au premier parent.
- Nouvelle fonction `commit_file_diff_first_parent(repo, hash, file)`, qui lance `git show -m --first-parent --format= --no-color <hash> -- <file>`. Le hash est validé comme dans `diff::commit_file_diff`.
- `load_commit_file_diff` et `diff::commit_file_diff` restent inchangés pour l'onglet Changes.
- Le diff s'ouvre dans le visualiseur existant, comme l'onglet Changes : `openDiffTab(ws, path, "committed")` puis `setDiffSelectedCommitHash(hash)`. Un nouveau champ de store `diffCommitParentMode: "default" | "first-parent"` est remis à `"default"` partout où `diffSelectedCommitHash` est remis à `null`. Il fait appeler la nouvelle commande à `DiffViewer.tsx:157`.
- Les branches et worktrees qui contiennent le commit (FR-016) sont calculés **côté hôte**, une seule source, dans `commit_detail` :
  - pour les branches : `git for-each-ref --contains <hash> refs/heads` (plus `refs/remotes` si l'option est active, et toujours la branche de base) ;
  - pour les worktrees : `git merge-base --is-ancestor <hash> <head>` sur la HEAD de chaque worktree non `missing`, en parallèle borné à 8 ; c'est indispensable pour les worktrees détachés, que `for-each-ref` ne voit pas.

**Justification** :
- `-m --first-parent` est disponible depuis longtemps dans git, donc sans risque de version sur un hôte distant.
- Pour un commit non fusion, le résultat est identique à `git show`.
- La fusion par rapport au premier parent est le choix de l'utilisateur du 2026-11-22.
- Laisser l'ancienne commande intacte protège l'onglet Changes.

**Alternatives écartées** :
- `--diff-merges=first-parent` : exige git 2.31.
- Changer `commit_file_diff` : cela modifierait aussi le comportement de l'onglet Changes.
- Un visualiseur de diff propre à l'onglet : il dupliquerait `DiffViewer`.

**Limite connue, héritée de l'onglet Changes** : `diffSelectedCommitHash` est global et la clé d'onglet de diff ne contient pas le commit. Ouvrir le même fichier à deux commits réutilise donc le même onglet. Nous ne la corrigeons pas ici.

## R8. Rafraîchissement (FR-012, SC-004)

**Décision** : sondage en deux vitesses, actif seulement quand l'onglet « Arbre git » est affiché et la fenêtre visible (`workspaceRefreshPollingAllowed()`).
- Toutes les 3 s, une empreinte bon marché `load_git_graph_fingerprint`. C'est un hash de `for-each-ref` (refs affichées et HEAD) et de `worktree list --porcelain`. Si elle change, l'arbre est rechargé depuis le haut, avec la même limite qu'avant.
- Toutes les 10 s, l'état modifié des worktrees (`git status`) est relu. C'est le délai exigé par SC-006, qui vaut aussi pour la disparition de la marque. Un premier relevé est lancé dès l'ouverture de l'onglet, sans attendre le premier tick.

**Justification** :
- Le commit peut venir de l'agent d'un autre espace de travail. La cadence existante (10 s au repos, liée à l'agent de l'espace sélectionné) ne tient donc pas les 5 s de SC-004.
- Les événements ne passent pas de façon fiable depuis un hôte distant (`FORWARDED_EVENTS`).
- L'empreinte coûte deux commandes git rapides.

**Alternatives écartées** :
- Un watcher `notify` sur `.git/refs` et `.git/worktrees` : il ne marche pas à distance, et les refs empaquetées compliquent la surveillance.
- Recharger tout le graphe à chaque tick : trop coûteux sur un gros dépôt.

## R9. Machines appairées et compatibilité

**Décision** : chaque nouvelle méthode prend `workspace_id` et résout le dépôt côté hôte. Elle est câblée à trois endroits :
- la commande Tauri dans `src-tauri/src/commands/git_graph.rs`, enregistrée dans `main.rs` ;
- un bras dans `RpcHost::dispatch` de `src-tauri/src/remote_host.rs` ;
- un bras et un `handle_*` dans `src-server/src/handler.rs`.

Côté frontend, les wrappers passent par `viaWorkspace` (`services/tauri/remoteRouting.ts`). Une réponse « méthode inconnue » d'un hôte plus ancien donne un état explicite « non pris en charge par cette machine », et non une erreur générique.

**Justification** : c'est le modèle de `load_commit_file_diff` (`remote_host.rs:178`, `handler.rs:291`). Un hôte non mis à jour est un cas réel, pas une hypothèse.

**Alternatives écartées** : passer par la liste blanche CLI `ipc.rs` `METHODS` (inutile pour des méthodes gérées explicitement par l'hôte).

## R10. Onglet du panneau droit

**Décision** :
- Un alias de type partagé `RightSidebarTab = "files" | "changes" | "tasks" | "git-tree"` remplace les trois unions littérales (`uiSlice.ts:33`, `:46`, `RightSidebar.tsx:~117`). `contextActions.ts:177` se compile sans changement.
- `RightSidebar.tsx` reçoit seulement le bouton d'onglet et la ligne `{activeTab === "git-tree" && <GitTreePanel />}`.
- Tout le reste vit dans `src/ui/src/components/git-tree/`.

**Justification** : `RightSidebar.tsx` est volumineux ; la règle « god files » demande un diff minimal et un foyer dédié.

## R11. Libellés et couleurs

**Décision** :
- Les nouveaux libellés passent par `t()` avec des clés `gitTree.*` dans `src/ui/src/locales/en/sidebar.json`. Les autres langues retombent sur l'anglais (`fallbackLng: "en"`, `src/ui/src/i18n.ts:49`). Aucun test de parité de traduction n'existe.
- Les couleurs des lanes sont une palette cyclique de 6 tokens existants de `theme.css`, accent et couleurs sémantiques présentes dans chaque thème, référencés en `var(--…)`. Aucun nouveau token.
- Le CSS module est contrôlé par `bun run lint:css`.

**Justification** :
- Les règles de CLAUDE.md : couleurs uniquement en `var(--token)`, et `lint:css` bloque en CI.
- Réutiliser des tokens déjà définis dans tous les thèmes évite de toucher chaque thème.

**Note** : la branche `feat/i18n-fr` touche 304 fichiers. Les nouvelles clés de `sidebar.json` y créeront un petit conflit de fusion attendu.

## R12. Performance (SC-002 : 2 s pour 50 000 commits)

**Décision** : la limite initiale de 200 commits borne le coût de `git log`, qui ne lit pas tout l'historique avec `--max-count`. `--topo-order` force cependant un parcours complet des commits atteignables. On mesure donc sur un dépôt de 50 000 commits (quickstart, scénario 10), et la mesure est **scriptée** pour pouvoir être relancée :
- un test Rust `#[ignore]`, `git_graph_perf_50k`, lit le chemin d'un gros dépôt dans `CLAUDETTE_GIT_GRAPH_BENCH_REPO` ; sans ce chemin, il est sauté ;
- il chronomètre `load_git_graph(limit = 200)` puis `until_hash` vers un commit ancien, et échoue au-delà de 1,5 s côté hôte, ce qui laisse 0,5 s pour le transport et le rendu ;
- il est lancé tôt dans l'exécution, juste après la lecture du graphe, pour trancher sur le repli avant d'écrire l'interface.

Si la cible n'est pas tenue, le repli prévu est `--date-order` avec un tri topologique local des 200 commits reçus.

**Justification** : `--topo-order` a un coût proportionnel au nombre de commits atteignables ; c'est le seul point du design dont la performance n'est pas évidente.
