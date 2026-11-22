# Research: Indicateur de chat et de workspace en cours

Les décisions ci-dessous ont été prises par l'utilisateur le 2026-11-22. Les constats viennent du
code de la branche `sgueniot-ua/chat-in-progress` (base `a1eb39a4`).

## Constats sur l'existant

- **Modèle** : `AgentStatus` (`src/model/workspace.rs:5`) a déjà `Running`, `Idle`,
  `IdleWithBackground`, `Stopped`, `Compacting` et `Error`. `ChatSession` porte `agent_status`,
  `needs_attention` et `attention_kind` (Ask | Plan).
- **Hydratation Rust** : `hydrate_session` est dupliquée dans `src-tauri/src/ipc.rs:546` et
  `src-tauri/src/commands/chat/session.rs:14`. Elle applique la règle suivante : `active_pid`
  donne `Running`, `running_background_tasks` non vide donne `IdleWithBackground`, sinon `Idle`.
- **Desktop, calcul** : `IdleWithBackground` est déjà calculé par session
  (`hooks/useAgentStream.ts:1616-1640`) et par workspace (`chatTurnLifecycle.ts:55-80`, ordre
  Running > IdleWithBackground > Idle).
- **Desktop, affichage** : `IdleWithBackground` n'est rendu nulle part.
  - `Sidebar.tsx:669` ne teste que `Running` et `Compacting`.
  - `SessionTabs.tsx:61-67` (`statusFor`) et `Dashboard.tsx:145` passent tout le reste en idle.
- **Desktop, attention** : à la session, Plan l'emporte sur Ask
  (`agentInteractionSlice.ts:97-126`). Au workspace, dans la barre latérale, l'ordre est
  Ask > Plan > Done, et l'attention passe avant le spinner (`Sidebar.tsx:600-648`).
- **Accessibilité desktop** : les badges d'attention ont `role="img"` et un `aria-label`. Le
  spinner « en cours » est `aria-hidden` et n'a qu'un `title`.
- **i18n desktop** : react-i18next, avec 6 langues (en, es, pt-BR, ja, zh-CN, de). Il n'y a pas
  de français.
- **Télécommande** (`src/ui-mobile`) :
  - Elle appelle `load_initial_data` et `list_chat_sessions` une seule fois, au montage de
    l'écran.
  - Elle n'écoute que `agent-stream` et `agent-permission-prompt`, et seulement pour le chat
    ouvert.
  - Ses types n'ont pas de champ d'état.
  - Elle n'a ni tests, ni i18n, ni état de connexion.
  - Ses styles sont dans `styles.css`, avec des tokens `:root`.
- **Relais desktop → télécommande** : `remote_host.rs:26-45` relaie déjà `chat-turn-started`,
  `agent-stream`, `agent-background-task`, `agent-permission-prompt`, `workspaces-changed` et
  `chat-session-created`. `src-mobile/src/commands.rs:24-65` les ré-émet en événements Tauri vers
  la webview. Quand le transport se ferme, il se contente de journaliser (`commands.rs:47`).
- **Payloads** : `list_chat_sessions` côté desktop renvoie des sessions hydratées.
  `load_initial_data` et `list_workspaces` renvoient l'`agent_status` stocké en base, sans
  overlay runtime.
- **Serveur autonome** (`src-server`) : ses `AgentSessionState` ne suivent pas les tâches en arrière-plan
  (`snapshot.rs:171`). `hydrate_session_runtime` (`snapshot.rs:174`) ne produit que
  Running ou Idle, avec l'attention.

- **Tâches en arrière-plan** : `running_background_tasks` reçoit toutes les tâches de fond
  annoncées par le CLI : commandes Bash, outil `Agent` en arrière-plan et `Workflow`
  (`send/background_tasks.rs:270`, `send.rs:2805`). Une tâche en sort à sa fin
  (`commands/terminal.rs:271`) ou quand un nouveau tour démarre (`send.rs:391`). La spec retient
  toutes ces tâches (clarification du 2026-11-22) : aucun filtrage par type n'est nécessaire.

## Décisions

### D1 — Flux temps réel vers la télécommande : relecture sur événement

- **Décision** : un nouvel appel RPC, `get_workspaces_activity`, renvoie l'état calculé côté
  Rust. La télécommande le rappelle à chaque événement relayé pertinent, avec un étranglement
  de 300 ms au début et à la fin de chaque rafale.
- **Raison** :
  - Une seule logique, côté Rust.
  - La source de vérité est relue à chaque fois, donc une transition manquée ne peut pas figer
    l'affichage.
  - On réutilise les événements déjà relayés.
- **Rejeté** :
  - Un événement dédié `session-activity-changed` **portant l'état** : il faudrait instrumenter
    chaque point de changement, avec un risque d'oubli. D7 ajoute bien un événement, mais c'est
    un simple signal de relecture, sans état, émis seulement aux points sans événement.
  - Une machine d'état côté mobile : elle dupliquerait `useAgentStream`.
  - Un sondage périodique : trafic permanent.
- **Note** : `agent-stream` est très bavard pendant une réponse. Un simple anti-rebond pourrait
  ne jamais se déclencher, d'où l'étranglement au début et à la fin de la rafale.

### D2 — Visuel « tâches en arrière-plan » : spinner atténué

- **Décision** : le même anneau que « en cours », en rotation plus lente (environ 2,4 s), dans
  la couleur d'un nouveau token.
  - Desktop : `--status-background`, défini dans le `:root` de `theme.css` comme alias de `--text-dim`, que chaque thème redéfinit.
  - Télécommande : `--status-background`, défini dans `styles.css`.
- **Mouvement réduit** (`prefers-reduced-motion`) : anneau fixe, comme le spinner actuel.

### D3 — Tests de la télécommande : vitest

- **Décision** : ajouter `vitest` en `devDependency` de `src/ui-mobile`, en `^4.1.4` comme
  `src/ui`, avec un script `test`. Cela modifie `src/ui-mobile/bun.lock`, volontairement.
- On ne teste que des fonctions pures et des classes sans DOM : pas de `@testing-library`, pour
  ne pas ajouter de dépendance.

### D4 — Serveur autonome : minimum

- **Décision** : `claudette-server` répond à `get_workspaces_activity` avec Running, Idle et
  l'attention, sans `IdleWithBackground`.

### D5 — Logique d'état dans le crate `claudette` (constitution I)

- **Décision** : un module pur `src/activity.rs` contient les règles et leurs tests Rust :
  - le calcul de l'état d'une session à partir de « process actif » et « tâches en arrière-plan actives » ;
  - l'agrégat d'un workspace.
- Les deux `hydrate_session` de `src-tauri` et le serveur autonome l'appellent. Les deux copies
  de `hydrate_session` gardent leur signature : seul leur corps délègue au core.

### D6 — Perte de liaison

- **Décision** : `src-mobile` surveille la fermeture du transport (watch `closed()` de
  `src/transport/ws.rs:397`) et émet l'événement Tauri `remote-connection-state`, sous la forme
  `{connection_id, connected}`.
  - Sur `connected: false`, la télécommande passe tous ses indicateurs à « inconnu ».
  - Quand la connexion est rétablie (`connect_saved` réussi), la télécommande relit l'état
    (FR-009).
- « Inconnu » l'emporte sur tous les autres états, attente de l'utilisateur comprise (spec FR-013).
- Liaison active mais `get_workspaces_activity` en erreur (desktop plus ancien sans la méthode,
  erreur serveur) : la télécommande n'affiche **aucun** indicateur d'activité (spec FR-013,
  clarification du 2026-11-22). Une erreur « Connection closed » relève de la perte de liaison :
  l'événement `remote-connection-state` décide.

### D7 — Signal `agent-activity-changed` pour les transitions muettes

- **Constat** (vérifié dans le code) : plusieurs transitions n'émettent aucun événement relayé :
  - `reset_attention` après `submit_agent_answer` (`interaction.rs:108`), `submit_mcp_answer`
    (`:167`) et `submit_approval_response` (`:290`) ;
  - `clear_attention` (`:32`) ;
  - `stop_agent` (`lifecycle.rs:39`) ;
  - la fin normale d'une tâche de fond (`send/background_tasks.rs:736`).
- **Décision** (choisie par l'utilisateur) : un événement léger `agent-activity-changed`
  `{workspace_id, chat_session_id}`, sans état dans le payload. Il est émis par une seule
  fonction d'aide, `emit_activity_changed`, appelée à ces points, et ajouté à
  `FORWARDED_EVENTS`. La télécommande relit l'état comme pour les autres événements.
- **Rejeté** :
  - une relecture périodique en filet : délai au-delà de 2 s (SC-002) ;
  - les deux à la fois : complexité sans gain une fois chaque point couvert par un test.
- **Note** : le nom de la clé de session suit `agent-background-task` (`chat_session_id`).
  `remote_host.rs` n'alias `chat_session_id` → `session_id` que pour `agent-stream` ; la
  télécommande n'utilise pas ce champ, elle relit tout.

- **Serveur autonome** (vérifié) : `handle_submit_agent_answer` (`handler.rs:1294`),
  `handle_submit_approval` (`:1395`) et `handle_stop_agent` (`:1237`) n'émettent aucun événement.
  Ils émettront aussi `agent-activity-changed` via `ServerState::emit` (`ws.rs:166`). Pas de liste
  de relais à modifier : `StandaloneHost` pousse directement ses événements aux clients.

### D8 — Relecture à l'ouverture d'un écran (FR-009)

- Chaque écran de la télécommande (liste des workspaces, liste des chats, chat) demande une
  relecture à son montage, via le même étranglement de 300 ms.
