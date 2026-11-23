# Quickstart: valider la barre des sous-agents et l'onglet Agents

## Prérequis

- Worktree de la branche `sgueniot-ua/running-agents-bar`, `cd src/ui && bun install`.
- Toolchain Rust 1.94 pour lancer l'app (`RUSTUP_TOOLCHAIN=1.94`).

## Vérifications automatiques

```bash
cd src/ui
bunx tsc -b          # types, tests compris
bun run test         # vitest
bun run lint:css     # tokens de design uniquement
```

Les tests de la feature couvrent les règles de la spec (voir la table « Couverture de la spec » du
plan d'exécution) : sélecteurs (`sessionAgents.test.ts`), barre (`RunningAgentsBar.test.tsx`),
onglet (`AgentsPanel.test.tsx`), store (`uiSlice` sélection / ouverture), stream (`task_started`
→ `starting`).

## Validation manuelle

Lancer l'app : `./scripts/dev.sh` depuis la racine du worktree.

1. **US1** — Dans un chat, envoyer : « Lance 2 agents en arrière-plan qui attendent 9 et 15 secondes
   avec Bash puis répondent fini, et termine ton tour sans les attendre. »
   - La barre apparaît au-dessus de la saisie avec 2 lignes (indicateur animé, `general-purpose` ou
     type choisi, description) dès le lancement.
   - Remonter la conversation : la barre reste visible.
   - ~9 s : une ligne disparaît ; ~15 s : la barre disparaît. La carte des agents du chat montre
     les mêmes états à chaque instant.
2. **US2** — Relancer l'essai ; cliquer une ligne de la barre.
   - La barre latérale droite s'ouvre sur l'onglet Agents, l'agent sélectionné ; ses appels
     d'outils s'ajoutent en direct ; à la fin, son résultat s'affiche et il reste sélectionné.
   - La position de défilement du chat n'a pas bougé.
3. **Débordement** — Demander 5 agents en parallèle : la barre montre 3 lignes et « +2 more » ;
   le clic sur « +2 more » ouvre l'onglet Agents sans sélection.
4. **US3** — Après la fin des agents, ouvrir l'onglet Agents : agents listés comme terminés ;
   sélectionner l'un affiche son résultat. Dans un chat neuf : message d'état vide.
5. **Changement de chat** — Deux chats du même workspace, agents dans un seul : la barre et
   l'onglet suivent le chat sélectionné.
6. **Accessibilité** — Tab jusqu'à la barre, Entrée sur une ligne : même effet que le clic ;
   macOS « Réduire les animations » activé : l'indicateur ne tourne plus.
7. **Non-régression** — Onglet Tasks inchangé ; carte des agents inchangée hors correction
   `starting` ; agents d'équipe (réglage « Team agents as session tabs ») absents de la barre.
