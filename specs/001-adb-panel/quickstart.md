# Quickstart: valider le volet ADB

## Prérequis

- Android SDK avec `platform-tools` (adb) ; au moins un émulateur, idéalement deux.
- Un dépôt Android ajouté dans Claudette, avec deux workspaces A et B.
- Pour le scénario émulateur dédié : un émulateur nommé `task-<dépôt>-<branche de A>`
  (par exemple créé par l'outillage émulateur par branche), démarré.

## Contrôles automatiques

```bash
cargo test -p claudette adb                       # nommage, analyse devices/logcat, résolution
cargo clippy -p claudette -p claudette-server -p claudette-cli --all-targets --all-features
cd src/ui && bun run test -- adb && bunx tsc -b && bun run lint:css
```

Attendu : tout passe, zéro avertissement.

## Scénarios manuels (`./scripts/dev.sh`)

| # | Étapes | Attendu | Spec |
|---|---|---|---|
| 1 | Dépôt sans mode Android, ouvrir un workspace | pas de bouton ADB, raccourci sans effet | FR-001a |
| 2 | Settings > Repository > Android mode ; revenir au workspace A | bouton ADB visible à côté du terminal | FR-001 |
| 3 | Ouvrir le volet ADB (bouton ou ⌘⇧A) | logs de l'émulateur dédié en < 3 s, nom de l'AVD et source « émulateur dédié » dans l'en-tête | FR-002, FR-005, FR-006, SC-001 |
| 4 | Ouvrir aussi le terminal | terminal à gauche, ADB à droite, séparateur déplaçable ; onglets du terminal intacts | FR-001b, FR-010 |
| 5 | ⌘F dans le volet, chercher un texte, Entrée / Maj+Entrée | recherche du volet (pas celle du chat), occurrences trouvées, navigation | FR-006c |
| 5b | Remonter pendant un flux, puis « derniers logs » | vue figée, puis suivi repris | FR-006a |
| 6 | Taper dans le volet | rien n'est envoyé | US1 sc. 5 |
| 7 | Basculer sur B (autre appareil), attendre, puis revenir sur A | B montre son appareil en < 1 s ; A montre aussi les logs arrivés pendant l'absence | FR-003, FR-004, FR-004a, SC-002 |
| 8 | Sur B avec deux appareils et sans émulateur dédié | liste des appareils à choisir ; choisir → logs | US3 sc. 5 |
| 9 | Relancer l'app, rouvrir B | même appareil associé | FR-007a |
| 10 | Effacer le choix de B | association automatique | US3 sc. 7 |
| 11 | `adb emu kill` sur l'émulateur de A, puis le redémarrer | « appareil déconnecté », puis reprise seule, sans doublons | FR-008, FR-009 |
| 11b | B avec un choix manuel, débrancher cet appareil, un autre restant connecté | « déconnecté », pas de bascule | FR-007c |
| 12 | PATH sans adb et `ANDROID_HOME` vide | « adb introuvable » ; reste de l'app normal | FR-008 |
| 13 | Flux d'environ 2 000 lignes/s pendant 60 s (`adb shell 'while true; do log -t spam x; done'`), taper dans le chat | caractère affiché en < 100 ms, défilement fluide | SC-004 |
| 13b | Volet ouvert, alterner 20 fois entre A et B (appareils distincts) | jamais l'appareil de l'autre workspace | SC-003 |
| 13c | Volet ouvert sur A, sélectionner un workspace d'un dépôt sans mode Android, revenir sur A | volet masqué puis réaffiché | FR-003a |
| 13d | Brancher un téléphone sans autoriser le débogage USB, le choisir | « Autorise le débogage USB sur l'appareil », puis logs après autorisation | FR-005 |
| 13e | Changer de branche dans le worktree de A (`git switch`), l'émulateur `task-…-<nouvelle branche>` démarré | l'émulateur de la nouvelle branche est retenu | FR-007d |
| 14 | Fermer le volet ADB | `adb logcat` de A toujours actif (`ps`) | FR-004a |
| 14b | Archiver A ; supprimer B | plus de processus `adb logcat` pour A ni B ; choix manuel de B effacé | FR-011, FR-007a |
| 15 | Créer un workspace | aucun émulateur créé ni démarré | FR-007b |
