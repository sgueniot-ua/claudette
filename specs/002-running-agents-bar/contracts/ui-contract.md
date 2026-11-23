# UI Contract: Barre des sous-agents en cours et onglet Agents

Interfaces internes au front desktop (`src/ui/src/`). Aucune commande Tauri, aucun événement,
aucun réglage ni clé persistée n'est ajouté.

## Sélecteurs (`stores/sessionAgents.ts`, fonctions pures)

```ts
interface SessionAgent {
  toolUseId: string;
  activity: ToolActivity;
  live: boolean;
  state: TaskState;
  running: boolean;
  subagentType: string | null;
  label: string;
}
collectSessionAgents(live: ToolActivity[], completed: CompletedTurn[]): SessionAgent[]; // ordre de lancement, hors agents d'équipe
runningSessionAgents(agents: SessionAgent[]): SessionAgent[];   // FR-001
orderForAgentsPanel(agents: SessionAgent[]): SessionAgent[];    // FR-009
isTeamAgentActivity(activity: ToolActivity): boolean;           // FR-013
```

Hook : `useSessionAgents(sessionId: string | null): SessionAgent[]` (mémoïsé, tableau vide stable
quand la session est nulle ou sans agent).

## Store (`stores/slices/uiSlice.ts`)

```ts
export type RightSidebarTab = "files" | "changes" | "tasks" | "agents";
selectedAgentBySession: Record<string, string | null>;
openAgentInSidebar(workspaceId: string, sessionId: string, toolUseId: string | null): void;
selectAgentInSidebar(sessionId: string, toolUseId: string | null): void;
```

## Composants

| Composant | Emplacement | Props | Comportement |
|---|---|---|---|
| `RunningAgentsBar` | `components/chat/RunningAgentsBar.tsx`, rendu dans `ChatPanelSessionView.tsx` à côté de `WorkflowStatusPill` | `workspaceId`, `sessionId` | rien si aucun agent en cours (FR-002) ; ≤ 3 lignes + « +N more » (FR-006) ; clic ligne → `openAgentInSidebar(ws, session, id)` ; clic « +N » → `openAgentInSidebar(ws, session, null)` (FR-007) |
| `AgentsPanel` | `components/right-sidebar/AgentsPanel.tsx`, onglet `agents` de `RightSidebar.tsx` | `workspaceId` (session = session active du workspace) | liste `orderForAgentsPanel` ; état vide (FR-011) ; détail = `AgentToolCallGroup` déplié (FR-010) |

## Changement de comportement existant (intentionnel)

`hooks/useAgentStream.ts` : `task_started` sans `status` sur une activité `Agent` → `agentStatus =
"starting"`. Effet visible : la carte des agents montre un agent de fond fraîchement lancé comme
« running » au lieu de « done » avant son premier progrès. À signaler dans la PR.

## Libellés (namespace `chat`, 6 locales)

| Clé | en |
|---|---|
| `running_agents_bar_label` | `Running agents` |
| `running_agents_more` | `+{{count}} more` |
| `running_agent_open` | `Open {{type}} agent: {{description}} ({{state}})` |
| `agents_tab` | `Agents` |
| `agents_panel_empty` | `No sub-agents were launched in this chat.` |
| `agents_panel_running` | `Running` |
| `agents_panel_finished` | `Finished` |
| `agents_panel_back` | `All agents` |

Les clés exactes peuvent être ajustées à l'implémentation ; les 6 fichiers `chat.json` reçoivent
les mêmes clés.
