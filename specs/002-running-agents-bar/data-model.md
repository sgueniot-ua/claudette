# Data Model: Barre des sous-agents en cours et onglet Agents

Aucune nouvelle donnée persistée ni changement de schéma ; seul ajout Rust : le balayage au démarrage (R14). Tout est dérivé du store front
(`src/ui/src/stores/`) ou y vit comme état UI non persisté.

## SessionAgent (dérivé, non stocké)

Vue d'une activité `ToolActivity` de premier niveau avec `toolName === "Agent"`, hors agents
d'équipe (FR-013).

| Champ | Source | Notes |
|---|---|---|
| `toolUseId` | `ToolActivity.toolUseId` | identifiant stable, clé de sélection |
| `activity` | la `ToolActivity` elle-même | passée telle quelle au rendu de la carte (FR-010) |
| `live` | vrai si l'activité vient de `toolActivities[sessionId]`, faux si de `completedTurns` | argument de `agentTaskState` |
| `state` | `agentTaskState(activity, live)` | `progress` \| `done` \| `error` \| `stopped` \| `queued` |
| `running` | `isAgentRunningState(state)` | règle unique « en cours » (FR-004) |
| `subagentType` | `agentSubagentType(activity)` (`subagent_type` de `inputJson`) | ex. `scout` ; peut être `null` |
| `label` | `activitySummaryText(activity)` | description affichée (FR-003) |

**Ordre** : ordre de lancement — tours terminés du plus ancien au plus récent, puis le tour en cours ;
dans un tour, ordre des activités.

**Listes dérivées** :
- `runningAgents(session)` = `SessionAgent` avec `running`, dans l'ordre ci-dessus → barre (FR-001).
- `sessionAgents(session)` = en cours d'abord, puis les autres (terminés, en échec, arrêtés,
  en attente), chaque groupe dans l'ordre ci-dessus → onglet Agents (FR-009).

**Règles** :
- Activité dont `inputJson` a `team_name` et `name` non vides → exclue (agent d'équipe).
- Seules les activités de premier niveau sont considérées (les sous-agents imbriqués vivent dans
  `agentToolCalls` du parent et ne sont jamais listés).

## Transitions d'état d'un sous-agent (existantes, plus une)

```
(tool_use Agent) ──► queued/progress ──task_started*──► starting ──task_progress──► running
     running/starting ──SubagentStop / task_notification──► completed | failed | stopped
     running/starting ──ProcessExited (reapInFlightAgents)──► stopped
     running/starting (ligne enregistrée) ──démarrage de l'app (resolve_orphaned_agent_activities)──► stopped   [R14]
```
`*` nouveau (research R3) : `task_started` sans `status` sur une activité `Agent` pose `starting`.

## État UI ajouté (uiSlice, non persisté)

| Champ / action | Type | Rôle |
|---|---|---|
| `RightSidebarTab` | `"files" \| "changes" \| "tasks" \| "agents"` | type unique de l'onglet (remplace 5 unions dupliquées) |
| `selectedAgentBySession` | `Record<string, string \| null>` | agent sélectionné dans l'onglet, par session de chat |
| `openAgentInSidebar(workspaceId, sessionId, toolUseId \| null)` | action | sélectionne (ou vide la sélection), met l'onglet du workspace à `agents`, ouvre la barre latérale si fermée |
| `selectAgentInSidebar(sessionId, toolUseId \| null)` | action | sélection depuis la liste de l'onglet |

Sélection orpheline (id absent de `sessionAgents`) → traitée comme `null` à l'affichage.
