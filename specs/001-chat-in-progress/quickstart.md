# Quickstart : vérifier la fonctionnalité

## Tests automatiques

```bash
cargo test -p claudette activity                       # règles FR-001, FR-002, attention
cargo test -p claudette-server activity                # réponse du serveur autonome
cargo test -p claudette-mobile --locked                # émission de remote-connection-state (macOS)
cd src/ui && bun run test && bunx tsc -b && bun run lint:css
cd src/ui-mobile && bun run test && bunx tsc -b
```

## Desktop (`./scripts/dev.sh`)

1. Dans un chat, envoyer un message : spinner « en cours » sur l'onglet et sur la ligne du
   workspace.
2. Demander une tâche qui lance un sous-agent en arrière-plan (`run_in_background`). Quand la
   réponse principale est finie, le spinner atténué « Background tasks running » apparaît sur
   l'onglet, la ligne du workspace et le Dashboard.
3. À la fin du sous-agent, l'icône redevient inactive.
4. Demander de lancer `sleep 60` en arrière-plan : même indicateur pendant 60 s, puis inactif.
5. Une question de l'agent affiche toujours le badge « en attente », qui passe avant le spinner.
6. Laisser un tour se terminer sans l'ouvrir pendant qu'une tâche de fond tourne : la ligne du
   workspace montre « tâches en arrière-plan », puis le badge « terminé » à la fin de la tâche.
7. VoiceOver : chaque indicateur annonce son libellé.

## Télécommande

1. Activer « Share this machine » sur le desktop et appairer l'app télécommande (simulateur iOS).
2. Lancer un message depuis le desktop. Sur la télécommande, la liste des workspaces, la liste des
   chats et l'écran de chat affichent « en cours » en moins de 2 s, sans rafraîchir.
3. Refaire l'étape 2 du desktop : la télécommande affiche « Background tasks running », puis
   « inactif ».
4. Une question de l'agent : la télécommande affiche « en attente de l'utilisateur ».
5. Répondre depuis le desktop à une question de l'agent, puis arrêter un agent : la
   télécommande quitte « en attente » puis « en cours » en moins de 2 s, sans rafraîchir.
6. Couper le partage sur le desktop : tous les indicateurs passent à « inconnu », y compris un
   chat en attente d'une réponse. Reconnecter :
   la télécommande affiche l'état réel.
7. Appairer la télécommande à un desktop sans la méthode (build de `main`) : listes affichées
   comme aujourd'hui, sans indicateur ni erreur.
