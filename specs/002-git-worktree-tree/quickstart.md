# Quickstart : valider l'arbre git

Ce guide de validation de bout en bout renvoie à [contracts/](./contracts/) et à [data-model.md](./data-model.md) pour les détails.

## Prérequis

- La branche de la feature est construite. `./scripts/dev.sh` lance l'application en mode dev.
- Un dépôt de test est ajouté dans Claudette. Le script ci-dessous le crée dans `/tmp/gt-demo` :

```bash
set -e
rm -rf /tmp/gt-demo /tmp/gt-ext && mkdir /tmp/gt-demo && cd /tmp/gt-demo
git init -b main -q && git commit -q --allow-empty -m "init"
for i in 1 2 3; do git commit -q --allow-empty -m "main $i"; done
git switch -q -c feat/a && git commit -q --allow-empty -m "a1" && git commit -q --allow-empty -m "a2"
git switch -q main && git commit -q --allow-empty -m "main 4"
git switch -q -c feat/merged && git commit -q --allow-empty -m "m1" && echo x > f.txt && git add f.txt && git commit -q -m "add f"
git switch -q main && git merge -q --no-ff feat/merged -m "merge feat/merged"
git branch feat/orphan-wt main~2
git worktree add -q /tmp/gt-ext feat/orphan-wt     # worktree externe à Claudette
git worktree add -q --detach /tmp/gt-detached main~1
```

Dans Claudette, ajouter `/tmp/gt-demo` comme dépôt, puis créer un espace de travail sur la branche `feat/a`, ou en créer un nouveau.

## Tests automatisés

```bash
cargo test -p claudette git_graph          # parsing, refs, avance/retard, worktrees, détail, fusions, until_hash
CLAUDETTE_GIT_GRAPH_BENCH_REPO=/chemin/vers/git \
  cargo test -p claudette --release git_graph_perf_50k -- --ignored   # SC-002, côté hôte < 1,5 s
cargo test -p claudette-server git_graph   # bras du serveur autonome
cd src/ui && bun run test -- git-tree      # layout des lanes, panneau, états, routage distant
cd src/ui && bunx tsc -b && bun run lint:css
cargo clippy -p claudette -p claudette-server -p claudette-cli --all-targets --all-features
```

Attendu : tout passe, sans avertissement.

## Scénarios manuels

| # | Action | Résultat attendu | Exigences |
|---|---|---|---|
| 1 | Ouvrir l'onglet « Git tree » du panneau droit. | L'arbre montre `main`, `feat/a`, `feat/merged`, `feat/orphan-wt`. La fusion apparaît comme une ligne qui rejoint `main`. `main` est marquée « base ». | FR-001→003, FR-007 |
| 2 | Regarder les marques de worktree. | L'espace de travail Claudette est sur sa branche, en style plein. `/tmp/gt-ext` est sur `feat/orphan-wt`, en style contour. `/tmp/gt-detached` est sur `main~1`, marqué « detached ». Le dépôt principal est sur `main`. | FR-004→006, FR-010, SC-003 |
| 3 | Regarder l'étiquette de `feat/a`. | Elle affiche `↑2 ↓4` (main a reçu « main 4 », « m1 », « add f » et la fusion). | FR-017 |
| 4 | Cliquer sur la marque de l'espace de travail Claudette. | Cet espace de travail est sélectionné. | FR-008, SC-005 |
| 5 | Cliquer sur le commit « merge feat/merged », puis sur `f.txt`. | Le détail liste `f.txt` (ajouté, par rapport au premier parent) et la ref `main` qui contient le commit. Le diff de `f.txt` s'ouvre dans le visualiseur. | FR-016 |
| 6 | Dans `/tmp/gt-ext` : `echo y > g.txt`, puis `rm g.txt`. | En 10 s au plus, la marque de `/tmp/gt-ext` affiche « Uncommitted changes », puis la perd dans le même délai. | FR-009, SC-006 |
| 7 | Dans `/tmp/gt-demo` : `git commit --allow-empty -m live` sur `main`. | En 5 s au plus, le commit apparaît en tête, sans perdre la sélection. | FR-012, SC-004 |
| 8 | Cocher « Show remote branches » sur un dépôt qui a un `origin`. | Les branches `origin/*` apparaissent, distinguées des locales. Décocher les masque, sauf la base si elle est distante. | FR-014, FR-007 |
| 9 | `rm -rf /tmp/gt-detached` (sans `git worktree remove`). | La marque passe en « Folder not found ». La vue ne casse pas. | FR-010 |
| 10 | Sur un dépôt de ≥ 50 000 commits (ex. un clone de `git/git`), ouvrir l'onglet. | Premier affichage en moins de 2 s. « Load more » ajoute 200 commits ; arrivé à 10 000, le bouton laisse place à « Tree limit reached (10,000 commits) ». Une branche ancienne de la liste en tête s'affiche dans l'arbre après un clic. | FR-011, SC-002 |
| 11 | Ouvrir l'onglet sur un espace de travail d'une machine appairée à jour, puis sur une machine non mise à jour. | Machine à jour : comme en local. Machine non mise à jour : message « does not support the git tree yet ». | FR-015 |
| 12 | Créer un dépôt vide (`git init` sans commit) et l'ouvrir. | « This repository has no commits yet. » | Edge cases |
| 13 | Cliquer sur le commit « main 4 ». | Le détail liste dans les worktrees qui le contiennent `/tmp/gt-detached` (détaché sur `main~1`) et le dépôt principal. | FR-016 |
| 14 | Sur le dépôt de ≥ 50 000 commits, cliquer dans la liste sur une branche créée sur un commit à plus de 10 000 commits de la tête (`git branch vieille HEAD~12000`). | L'arbre ne bouge pas ; bandeau « too old to show in the tree » avec le hash copiable. | FR-011 |

## Vérification lecture seule

Pendant les scénarios 1 à 9, `git reflog` et `git status` dans `/tmp/gt-demo` ne montrent aucun changement venu de l'application (FR-013).
