# Research: Barre des sous-agents en cours et onglet Agents

Toutes les références sont relatives à `src/ui/src/` sauf mention contraire.

## R1 — Source des données

- **Decision** : dériver la liste des sous-agents d'une session des activités d'outil déjà dans le
  store : `toolActivities[sessionId]` (tour en cours) et `completedTurns[sessionId][].activities`
  (tours terminés), dans `stores/slices/chatSlice.ts`. Un sous-agent = une activité de premier niveau
  avec `toolName === "Agent"`.
- **Rationale** : c'est exactement la source de la carte des agents (`AgentActivityGroups.tsx`,
  `AgentToolCallGroup.tsx`) ; les événements `task_started` / `task_progress` / `task_notification`
  et les hooks `SubagentStart` / `PreToolUse` / `SubagentStop` mettent déjà à jour ces activités,
  y compris après la fin du tour (`updateToolActivity` et `upsertAgentToolCall` cherchent aussi dans
  `completedTurns`). FR-004 (pas de contradiction barre / carte) est garanti par construction.
- **Alternatives considered** : suivi côté Rust (rejeté par l'utilisateur : doublon de données,
  risque de divergence avec la carte, utile seulement pour la remote, hors périmètre).
- **Précédent** : `stores/inFlightWorkflows.ts` (`collectInFlightWorkflows(live, completedTurns)`) et
  `hooks/useLiveWorkflows.ts` font la même chose pour les Workflows ; le nouveau sélecteur suit ce
  modèle (fonction pure + hook mémoïsé avec constantes `EMPTY_*`).

## R2 — Règle « en cours »

- **Decision** : réutiliser `agentTaskState(activity, live)` de `components/chat/agentActivityDisplay.ts`
  avec `live = true` pour le tour en cours et `live = false` pour les tours terminés, comme la carte ;
  « en cours » = `isAgentRunningState(state)` (état `progress`). Ne pas utiliser
  `groupHasRunningActivity` (`toolActivityGroups.ts`), dont la sémantique diffère (faux dès qu'un
  `resultText` existe).
- **Rationale** : même fonction que la carte → FR-004 / SC-004.

## R3 — Trou entre le lancement d'un agent de fond et son premier progrès

- **Constat** : pour un `Agent` lancé avec `run_in_background`, le `tool_result` d'accusé de
  lancement remplit `resultText` tout de suite, et `task_started` n'a pas de `status` (vérifié avec
  le vrai CLI : `task_started` sans `status`, puis `task_progress`, puis `task_notification
  completed`). `agentStatus` reste `null` jusqu'au premier `task_progress`, et `agentTaskState`
  renvoie alors `done`. La carte montre donc l'agent comme terminé pendant cette fenêtre ; la barre
  ne le montrerait pas (SC-001).
- **Decision** : dans `hooks/useAgentStream.ts`, sur `task_started` sans `status`, poser
  `agentStatus = "starting"` **uniquement si l'activité visée est un `Agent`** (lookup via
  `stores/findToolActivity.ts`). `starting` est déjà traité comme « en cours » par
  `agentTaskState` et comme vivant par `reapInFlightAgents` (qui le passe à `stopped` à la mort du
  process), donc aucun état fantôme.
- **Rationale** : corrige la carte et alimente la barre dès le lancement, sans toucher aux tâches
  Bash ni aux Workflows. C'est un changement de comportement visible de la carte (un agent de fond
  qui vient d'être lancé apparaît « running » au lieu de « done ») : intentionnel, à signaler dans
  la PR et à épingler par un test (constitution III).
- **Alternatives considered** : ignorer la fenêtre (rejeté : un sous-agent qui réfléchit longtemps
  avant son premier outil serait absent de la barre) ; ajouter `task_type` au flux (nécessite Rust,
  hors approche choisie).

## R4 — Exclusions (FR-013)

- **Sous-agents imbriqués** : ils n'existent que dans `agentToolCalls` du parent (hooks), jamais
  comme activité de premier niveau ; ne lister que les activités de premier niveau les exclut par
  construction.
- **Agents d'équipe** : activité `Agent` normale dont `inputJson` contient `team_name` et `name`
  non vides (cf. `src-tauri/src/commands/chat/send/team_agents.rs`, `ClaudeTeamAgentInput`).
  **Decision** : helper pur `isTeamAgentActivity(activity)` (parse `inputJson` via
  `utils/toolInput`) ; ces activités sont exclues de la barre et de l'onglet.

## R5 — Emplacement de la barre

- **Decision** : nouveau composant `components/chat/RunningAgentsBar.tsx`, rendu dans
  `components/chat/ChatPanelSessionView.tsx` à côté de `WorkflowStatusPill` (entre la zone des
  messages et `ChatInputArea`), hors du conteneur qui défile → toujours visible (FR-005).
- **Rationale** : `WorkflowStatusPill` est le précédent exact (pastille des Workflows de fond au-dessus
  de la saisie) ; `ChatPanel.tsx` et `ChatInputArea.tsx` sont des god files et ne sont pas touchés
  (constitution VII) ; `ChatPanelSessionView.tsx` reçoit une seule ligne de JSX.
- **Style** : reprendre les tokens de `WorkflowStatusPill.module.css` (`--chat-input-bg`,
  `--divider`, `--radius-pill`, `--space-*`) ; indicateur animé = `TaskStateIcon` état `progress`
  (vérifier qu'il respecte `prefers-reduced-motion`, sinon l'ajouter dans le CSS du nouveau
  composant).

## R6 — Onglet « Agents » de la barre latérale droite

- **Constat** : `components/right-sidebar/RightSidebar.tsx` rend les onglets Files / Changes / Tasks
  (libellés en dur en anglais). L'union `"files" | "changes" | "tasks"` est répétée dans
  `stores/slices/uiSlice.ts` (l. 33 et 46), `RightSidebar.tsx` (l. 117),
  `file-viewer/editor-menubar/useEditorActions.ts` (l. 56) et `hooks/useViewTogglePersistence.ts`
  (`RIGHT_SIDEBAR_TABS`, l. 26). Ouverture : `rightSidebarVisible` + `toggleRightSidebar()`.
- **Decision** :
  - introduire un type unique `RightSidebarTab = "files" | "changes" | "tasks" | "agents"` exporté
    de `uiSlice.ts` et l'utiliser aux 5 endroits (commit préparatoire séparé, sans changement de
    comportement) ;
  - nouveau panneau `components/right-sidebar/AgentsPanel.tsx` (liste + détail), branché dans
    `RightSidebar.tsx` par un onglet et un `case` ;
  - action de store `openAgentInSidebar(workspaceId, sessionId, toolUseId | null)` : sélectionne
    l'agent, passe l'onglet du workspace à `agents`, ouvre la barre latérale si elle est fermée ;
  - la persistance de `rightSidebarTab` dans `useViewTogglePersistence.ts` accepte `agents` (valeur
    inconnue → `files`, comportement actuel).
- **Auto-bascule vers Tasks** (`RightSidebar.tsx` ~186-195) : inchangée ; elle ne se déclenche que si
  aucun onglet n'a été choisi pour le workspace, et un clic dans la barre enregistre `agents`.

## R7 — Sélection (FR-007, FR-012, cas « agent qui disparaît »)

- **Decision** : état UI non persisté (constitution II) `selectedAgentBySession: Record<sessionId,
  toolUseId | null>` dans `uiSlice.ts`. L'onglet lit la sélection du chat actif ; si l'id n'est plus
  dans la liste dérivée, il affiche la liste sans détail. Pas de nettoyage actif nécessaire.

## R8 — Détail d'un agent (FR-010)

- **Decision** : réutiliser `AgentToolCallGroup` (props `activity, searchQuery, worktreePath, inline,
  collapsed, onToggle, live`) avec `collapsed = false`, `searchQuery = ""`, `live` selon le tour
  d'origine. Pas de nouveau rendu des appels d'outils, du résultat ni des tokens.
- **Rationale** : FR-010 exige le même contenu que la carte.

## R9 — Débordement (FR-006)

- **Decision** : la barre affiche les 3 premiers agents en cours (ordre de lancement : tours les plus
  anciens d'abord, puis ordre dans le tour) et un bouton « +N more » qui appelle
  `openAgentInSidebar(ws, session, null)`. Constante `RUNNING_AGENTS_BAR_MAX_ROWS = 3`.

## R10 — i18n (FR-014)

- **Decision** : nouvelles clés dans le namespace `chat` (`locales/{de,en,es,ja,pt-BR,zh-CN}/chat.json`) :
  libellé de la barre, « +N more », titre et état vide de l'onglet, libellé de l'onglet « Agents »,
  libellés accessibles. Les libellés existants de la barre latérale (Files, Changes, Tasks) restent
  en dur : les traduire serait hors périmètre (FR-017).

## R11 — Accessibilité (FR-015)

- **Decision** : barre = `<nav aria-label>` (ou région `role="status"` pour l'annonce) contenant des
  `<button>` ; nom accessible = type + description + état ; liste de l'onglet = boutons avec
  `aria-pressed`/`aria-current` sur l'agent sélectionné ; animation coupée sous
  `prefers-reduced-motion: reduce`.

## R12 — Tests

- vitest, `// @vitest-environment happy-dom` pour les composants, `import "../../i18n"`,
  `vi.mock("../../workers/highlight.worker?worker")` (cf. `AgentActivityGroups.test.tsx`). Fixtures
  construites depuis le type `ToolActivity` réel (helper local `agent(id, overrides)` à
  l'image de `AgentActivityGroups.test.tsx:31`). Test du stream sur le modèle de
  `hooks/useAgentStream.backgroundAgent.test.tsx`.

## R13 — Documentation (FR-016)

- **Decision** : nouvelle page `site/src/content/docs/features/running-agents.mdx` (barre + onglet),
  enregistrée dans `site/astro.config.mjs` ; une phrase dans `task-history.mdx` renvoyant vers elle
  pour distinguer Tasks (listes de tâches) et Agents (activité des sous-agents).

## R14 — Agents orphelins après fermeture ou plantage de l'app (amendement 2026-11-23)

- **Constat (revue finale)** : le tour qui lance un agent de fond est enregistré en quelques secondes
  avec `agent_status` = `starting` (R3) ou `running`. Si l'app se ferme ou plante avant la
  `task_notification`, la ligne garde ce statut. Au relancement, `agentTaskState` la lit comme
  `progress` : la barre et la carte montrent un agent mort comme en cours, sans fin.
  `reapInFlightAgents` ne s'exécute que sur `ProcessExited` de la session, qui n'arrive jamais pour
  un process de l'exécution précédente. Le balayage Rust au démarrage
  (`resolve_orphaned_workflow_activities`, `src/db/checkpoint.rs`) exclut volontairement les
  `Agent`, faute d'indicateur persistant : cette fonctionnalité en ajoute un.
- **Decision (choix de l'utilisateur)** : nouvelle fonction `Database::resolve_orphaned_agent_activities()`
  dans `src/db/checkpoint.rs`, appelée au démarrage au même endroit que le balayage des Workflows :
  les lignes `tool_name = 'Agent'` dont `LOWER(TRIM(agent_status))` vaut exactement `running` ou
  `starting` passent au statut de récolte partagé (`REAPED_TASK_STATUS`, `stopped`). Les lignes à
  statut `NULL` ou terminal ne sont pas touchées (même périmètre que `reapInFlightAgents`).
  Ligne par ligne avec log-and-continue, comme le balayage des Workflows. Tests Rust sur le modèle de
  `test_resolve_orphaned_workflow_activities`.
- **Alternatives considered** : heuristique front sur l'existence d'un process de session (rejetée :
  devinette) ; ne rien faire (rejeté par l'utilisateur).
