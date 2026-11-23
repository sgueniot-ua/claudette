# Quickstart : valider les chats de projet sans worktree

Références : [contracts/interfaces.md](./contracts/interfaces.md), [data-model.md](./data-model.md).

## Prérequis

- Un dépôt git de test ajouté dans Claudette, avec la branche `main` extraite et un fichier `README.md`.
- `./scripts/dev.sh` lancé (build de dev, pour `/claudette-debug`).

## Vérifications automatiques

```bash
cargo test -p claudette -p claudette-server -p claudette-cli --all-features
cargo clippy -p claudette -p claudette-server -p claudette-cli --all-targets --all-features
cargo fmt --all --check
cd src/ui && bunx tsc -b && bun run test && bun run lint:css
cd src/ui-mobile && bunx tsc -b
```

## Scénarios manuels

| # | Action | Résultat attendu | Spec |
|---|---|---|---|
| 1 | Clic sur la ligne « Chats du projet » de la sidebar (en tête du projet) | chat ouvert en moins de 2 s ; `git worktree list` et `git branch` inchangés ; aucun dossier sous `~/.claudette/workspaces` | US1-1, FR-001, FR-003, SC-002 |
| 2 | Demander à l'agent `pwd` et `git branch --show-current` | dossier du dépôt, `main` | US1-2, FR-002 |
| 3 | Demander à l'agent de modifier `README.md` | fichier modifié dans le dépôt ; diff = modification non commitée | US1-4, FR-009 |
| 4 | Nouveau chat (+ ou ⌘T) deux fois de plus, puis un message dans chacun des 3 | 3 agents en parallèle, statuts et historiques distincts ; avertissement de dossier partagé visible | US2, FR-004, FR-005, SC-003 |
| 5 | Regarder la sidebar et appuyer sur ⌘1–9 | une ligne « Chats du projet » épinglée en tête de chaque projet local, avec la branche extraite ; aucun workspace `repository` ordinaire ; ⌘1–9 ouvre la ligne (mode statut) ou le projet | FR-013 |
| 6 | Redémarrer Claudette, ouvrir la ligne « Chats du projet » | les 3 chats et leur historique sont là | US1-3, FR-006, SC-004 |
| 7 | Renommer un chat, archiver le dernier chat actif | nom changé ; chat archivé disparu, aucun « New chat » recréé ; fichiers et branches inchangés | US3, FR-007 |
| 8 | Rollback d'un checkpoint avec « restaurer les fichiers » | avertissement « dossier partagé » ; « Annuler » ne change rien, « Confirmer » restaure | FR-014 |
| 9 | Même chose pendant qu'un autre chat du projet tourne | avertissement supplémentaire avec le nombre de chats en cours | FR-017 |
| 10 | Modifier un fichier à la main, envoyer 2 messages qui modifient des fichiers, puis « Effacer la conversation » avec restauration | confirmation « retour à l'état d'avant le premier message » ; fichiers revenus à l'état d'avant le 1er message (la modification manuelle faite avant est conservée) ; aucun commit retiré, `git log` inchangé | FR-015 |
| 10b | Fork depuis un checkpoint d'un chat de projet | workspace classique `<dépôt>-fork` avec worktree | FR-016 |
| 10c | Nouveau chat sans message, « Effacer la conversation » | option « restaurer les fichiers » absente | FR-015 |
| 16 | Ouvrir un terminal dans un chat de projet, `pwd` | dossier du dépôt | FR-010 |
| 17 | Renommer le dossier du dépôt hors de Claudette, envoyer un message | « Le dossier du projet est introuvable » ; historique lisible | cas limite |
| 11 | `git checkout -b autre` dans le dépôt, puis un message | le chat continue ; la branche affichée devient `autre` | cas limite |
| 12 | Créer une routine sur un chat de projet | elle s'exécute et n'est pas désactivée | FR-011 |
| 13 | Créer, archiver et supprimer un workspace classique | comportement identique à `main` | FR-012, SC-005 |
| 14 | Retirer le dépôt de Claudette | chats de projet retirés ; dossier et branches intacts | cas limite |
| 15 | `claudette workspace list` | sortie identique à avant, sans le workspace `@project` | contrat CLI |

## Tests automatisés attendus (à couvrir dans le plan d'exécution)

- `ops::workspace::open_project_chat` : création idempotente, un seul workspace `repository` par dépôt,
  aucune opération git d'écriture (dépôt `tempfile`).
- Gardes : archive, restore, delete, bulk delete, setup et auto-rename refusés pour `repository` ;
  `remove_repository` ne touche ni worktree ni branche.
- Migration : les lignes existantes valent `worktree` ; l'index unique partiel est respecté.
- Diff : base `HEAD` pour `repository`.
- Snapshot de référence : capturé avant le 1er tour, non élagué, restauré par `clear_conversation`.
- Fork depuis `repository` : nom `<dépôt>-fork`.
- `rename_workspace` refusé pour `repository` ; `open_project_chat` concurrent sans doublon.
- Front : filtre sidebar, ligne « Chats du projet » (branche, ouverture, concurrence), avertissements de `RollbackModal`.
