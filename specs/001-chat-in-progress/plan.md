# Implementation Plan: Indicateur de chat et de workspace en cours

**Branch**: `sgueniot-ua/chat-in-progress` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-chat-in-progress/spec.md`

## Summary

On ajoute l'état « tâches en arrière-plan » (`IdleWithBackground` : sous-agents, Workflows ou
commandes shell lancés en arrière-plan), déjà calculé mais jamais
affiché, aux indicateurs du desktop. On donne aussi à l'app télécommande (`src/ui-mobile`) des
indicateurs d'activité : liste des workspaces, liste des chats, écran de chat, attente
utilisateur et état « inconnu » en cas de perte de liaison.

Approche technique :
- Les règles d'état sont regroupées dans un module pur du crate `claudette`.
- Un nouvel appel RPC, `get_workspaces_activity`, expose l'état calculé côté Rust.
- La télécommande relit cet état à chaque événement déjà relayé par le desktop (research D1), à
  chaque ouverture d'écran (F3), et sur un nouvel événement `agent-activity-changed`, émis là où
  aucun événement n'existait (research D7).

## Technical Context

**Language/Version**: Rust edition 2024 (toolchain 1.94) ; TypeScript ~5.9 (React 19)

**Primary Dependencies**: Tauri 2, react-i18next (desktop) ; nouvelle devDependency `vitest`
`^4.1.4` dans `src/ui-mobile` (research D3)

**Storage**: N/A (état runtime uniquement, aucune migration)

**Testing**: `cargo test` (core, server, mobile) ; vitest (`src/ui`, `src/ui-mobile`)

**Target Platform**: desktop macOS, Linux et Windows ; app télécommande iOS et Android (Tauri 2)

**Project Type**: desktop-app avec client mobile distant (WSS)

**Performance Goals**: changement d'état visible en moins de 2 s sur les deux apps (SC-002).
L'étranglement à 300 ms laisse une marge sur ce délai.

**Constraints**:
- pas de nouvelle dépendance runtime ;
- tokens CSS uniquement ;
- `isAgentBusy` reste inchangé : le compteur, le blocage de la saisie et le badge « terminé »
  ne changent pas de comportement (FR-011).

**Scale/Scope**: quelques dizaines de workspaces et de sessions par machine. La réponse RPC
reste petite.

## Constitution Check

| Principe | Statut | Justification |
|---|---|---|
| I. Crates en couches | ✅ | Règles dans `src/activity.rs` (core) ; `src-tauri` et `src-server` ne font que les appeler ; la télécommande n'exécute aucun agent. |
| II. Modèle pur | ✅ | `SessionActivity` et `WorkspaceActivity` dans `src/model/activity.rs` (`Serialize`) ; rien n'est persisté. |
| III. Contrats et régressions | ✅ | Ajout seulement : nouvelle méthode RPC (aussi inscrite dans `METHODS`), nouveaux événements `agent-activity-changed` et `remote-connection-state`. Aucun payload, champ ou libellé existant n'est modifié. Un seul changement de comportement voulu, demandé par la spec (FR-011) : sur la barre latérale, « tâches en arrière-plan » passe avant le badge « terminé, non lu ». Il sera signalé dans la PR et couvert par un test. Les branches actuelles de la barre latérale et des onglets sont conservées et couvertes par des tests. |
| IV. Migrations | ✅ N/A | Pas de base de données. |
| V. Tokens | ✅ | Nouveau token `--status-background` dans le `:root` de `theme.css`, aliasé sur `--text-dim` pour suivre chaque thème. Côté télécommande, nouveaux tokens dans le `:root` de `styles.css`. |
| VI. Sécurité plateforme | ✅ N/A | Aucun sous-process. |
| VII. God files | ⚠️ maîtrisé | `Sidebar.tsx`, `ipc.rs`, `SessionTabs`, `interaction.rs`, `lifecycle.rs`, `send/background_tasks.rs` : au plus une branche ou un appel d'une ligne chacun. Le choix d'indicateur de la barre latérale va dans `workspaceIndicator.ts`, l'émission dans `emit_activity_changed`, le rendu dans un composant partagé et le handler RPC dans un module dédié. |
| Docs | ✅ | `features/parallel-agents.mdx` (indicateurs desktop) et `features/mobile-app.mdx` mis à jour dans la même PR. `cli-client.mdx` inchangée : elle renvoie à `claudette capabilities`, qui lit `METHODS`. |

Re-check après la phase 1 : aucun écart, Complexity Tracking vide.

## Project Structure

### Documentation (this feature)

```text
specs/001-chat-in-progress/
├── spec.md
├── plan.md                          # ce fichier
├── research.md                      # décisions D1–D6
├── data-model.md                    # types et règles
├── quickstart.md                    # vérification
├── contracts/get_workspaces_activity.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── model/activity.rs                 # NOUVEAU : SessionActivity, WorkspaceActivity
├── model/mod.rs                      # export
├── activity.rs                       # NOUVEAU : session_status, workspace_status, workspace_attention + tests
└── lib.rs                            # pub mod activity

src-tauri/src/
├── commands/chat/activity.rs         # NOUVEAU : construit Vec<WorkspaceActivity> depuis la DB + AppState.agents (sessions non archivées) ;
│                                     #   emit_activity_changed(app, workspace_id, session_id)
├── commands/chat/interaction.rs      # appel d'emit_activity_changed après reset_attention (:32, :108, :167, :290)
├── commands/chat/lifecycle.rs        # appel d'emit_activity_changed après stop_agent (:39)
├── commands/chat/send/background_tasks.rs  # appel d'emit_activity_changed à la fin d'une tâche de fond (:736)
├── commands/chat/session.rs          # hydrate_session délègue à claudette::activity::session_status
├── remote_host.rs                    # "agent-activity-changed" ajouté à FORWARDED_EVENTS
└── ipc.rs                            # hydrate_session délègue au core ; "get_workspaces_activity" dans METHODS + 1 bras

src-server/src/
├── activity.rs                       # NOUVEAU : réponse du serveur autonome (Running/Idle/attention) + tests
└── handler.rs                        # 1 bras "get_workspaces_activity" ; émission d'agent-activity-changed
                                      #   dans handle_submit_agent_answer, handle_submit_approval, handle_stop_agent

src-mobile/src/commands.rs            # émet "remote-connection-state" (fermeture du transport, connexion)

src/ui/src/
├── components/shared/SessionStatusIcon.tsx(.module.css)  # variante "background" + aria-label pour toutes les variantes
├── components/chat/SessionTabs.tsx   # statusFor : IdleWithBackground → "background"
├── components/sidebar/workspaceIndicator.ts  # NOUVEAU (pur) : choix de l'indicateur d'une ligne (ask > plan > background > done > …)
├── components/sidebar/Sidebar.tsx    # utilise workspaceIndicator ; rendu de la branche background
├── components/sidebar/Sidebar.module.css  # anneau atténué (vitesse et couleur)
├── components/layout/Dashboard.tsx   # même mapping via statusFor partagé
├── components/sidebar/RemoteSections.tsx  # idem, si la liste affiche déjà le spinner
├── utils/agentStatus.ts              # NOUVEAU helper isBackgroundRunning (isAgentBusy inchangé)
├── styles/theme.css                  # --status-background dans :root (alias de --text-dim)
└── locales/{en,es,pt-BR,ja,zh-CN,de}/{sidebar,chat}.json  # libellés et aria

src/ui-mobile/
├── package.json, bun.lock            # vitest + script "test"
└── src/
    ├── types.ts                      # SessionActivity, WorkspaceActivity, ActivityDisplay
    ├── services/activity.ts          # NOUVEAU (pur) : toActivityDisplay, libellés, RefetchThrottle
    ├── services/activity.test.ts     # NOUVEAU
    ├── services/useActivity.tsx      # NOUVEAU : contexte React (fetch, écoute des événements, état connecté, état « indisponible »)
    ├── components/ActivityIndicator.tsx  # NOUVEAU : anneau/badge + aria-label
    ├── screens/{WorkspacesScreen,ChatListScreen,ChatScreen}.tsx  # affichent ActivityIndicator ; relecture au montage (F3)
    ├── App.tsx                       # monte le provider
    └── styles.css                    # tokens --status-* + styles de l'indicateur

site/src/content/docs/features/{parallel-agents,mobile-app}.mdx
```

**Structure Decision**: on garde la structure existante à cinq crates et deux frontends.
- Logique : core `claudette`.
- Exposition : `src-tauri` et `src-server`.
- Rendu : `src/ui` et `src/ui-mobile`.

## Lots de travail (pour writing-plans)

1. **Core** : modèle et règles pures, avec leurs tests (FR-001, FR-002, priorité de l'attention).
2. **Exposition** :
   - handler desktop et IPC, avec les deux `hydrate_session` qui délèguent au core ;
   - handler du serveur autonome ;
   - événement `agent-activity-changed` aux points sans événement (desktop et serveur autonome), et relais ;
   - émission de `remote-connection-state` par `src-mobile`.
3. **Desktop UI** :
   - variante « background » de `SessionStatusIcon` ;
   - onglets, barre latérale (sélecteur pur, background avant done), Dashboard et sections distantes ;
   - token, i18n dans les 6 langues, aria (FR-006, FR-007, FR-010, FR-011).
4. **Télécommande** :
   - outillage vitest ;
   - fonctions pures et leurs tests ;
   - provider, indicateur, trois écrans, état « inconnu » (FR-003 à FR-005, FR-008, FR-009,
     FR-012, FR-013).
5. **Docs** et vérification `quickstart.md`.

## Couverture de la spec (prévisionnelle)

| Règle | Lot | Test(s) prévus |
|---|---|---|
| FR-001 | 1 | `activity.rs` : `session_status` (3 cas, dont « process actif + tâche de fond → Running », cas du sous-agent au premier plan) ; fin du process sur erreur ou interruption → sort de Running (`session_status(false, …)`) ; `hydrate_session` délègue au core |
| FR-002 | 1 | `activity.rs` : `workspace_status` (ordre Running > IdleWithBackground > Idle, liste vide) |
| Cas limite « serveur autonome » | 2 | `src-server` : la réponse ne contient jamais `IdleWithBackground` |
| FR-003 | 4 | `activity.test.ts` : affichage d'un workspace depuis `WorkspaceActivity` |
| FR-004 | 4 | `activity.test.ts` : affichage d'une session |
| FR-005 | 4 | `activity.test.ts` : état du chat ouvert (session absente → idle) |
| FR-006 | 3 | `SessionTabs` `statusFor` ; sélecteur d'indicateur de la barre latérale (fonction pure extraite) ; l'écran de chat desktop (`ProcessingIndicator`) reste inchangé |
| FR-007 | 3, 4 | les variantes running, background et idle donnent des classes et libellés distincts (desktop et télécommande) |
| FR-008 | 2, 4 | `RefetchThrottle` (faux timers) : une rafale d'événements → relecture en moins de 300 ms, et une relecture à la fin de la rafale ; Rust : `agent-activity-changed` émis par réponse, approbation, `clear_attention`, `stop_agent` et fin de tâche de fond ; présent dans `FORWARDED_EVENTS` ; serveur autonome : émis par réponse, approbation et arrêt ; le provider réagit aux 7 événements |
| FR-009 | 2, 4 | handler Rust : l'état reflète `AppState.agents` au moment de l'appel, sessions archivées exclues ; provider : relecture quand `connected: true` et à l'ouverture de chaque écran |
| FR-010 | 3, 4 | chaque variante a un libellé aria non vide |
| FR-011 | 3 | `workspaceIndicator` : attention avant spinner ; background avant done (exception) ; done quand Idle et non lu ; `isAgentBusy` inchangé |
| FR-012 | 1, 4 | `workspace_attention` (Ask > Plan) ; mapping attention > running côté télécommande |
| FR-013 | 2, 4 | `src-mobile` : fermeture → événement `connected: false` ; mapping déconnecté → `unknown`, y compris quand la session demande une réponse (ask/plan) ; connecté mais RPC en erreur ou méthode inconnue → aucun indicateur |

## Libellés (spec FR-010)

Libellés anglais fixés par la spec, traduits dans les 5 autres langues du desktop :
- « Running » : la clé `status_running` existe déjà ;
- « Background tasks running » : nouvelle clé `status_background` ;
- « Idle » : la clé `status_idle` existe déjà ;
- « Question requires attention » et « Plan approval needed » : les libellés
  `status_badge_ask_*` et `status_badge_plan_*` existants sont réutilisés ;
- « Status unknown — disconnected » (télécommande seulement).

## Complexity Tracking

Aucun écart à la constitution.
