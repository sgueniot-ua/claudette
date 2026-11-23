# Running Sub-agents Bar and Agents Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the running sub-agents of the selected chat in a bar pinned above the chat input, and open a sub-agent's live detail in a new right-sidebar "Agents" tab.

**Architecture:** Front-only (`src/ui`). A pure selector derives the session's sub-agents from the store's existing tool activities (live lane + completed turns), with the exact "running" rule of the chat's agent card (`agentTaskState` / `isAgentRunningState`). A bar component next to `WorkflowStatusPill` lists running ones; a click calls a new store action that opens the right sidebar on a new `agents` tab whose panel lists the session's agents and renders the selected one with the existing `AgentToolCallGroup`. One stream fix: `task_started` without status on an `Agent` sets `agentStatus = "starting"`.

**Tech Stack:** TypeScript strict, React 19, Zustand, react-i18next, vitest (+ happy-dom), Astro Starlight docs.

**Spec:** `specs/002-running-agents-bar/spec.md` and `specs/002-running-agents-bar/plan.md` (with `research.md`, `data-model.md`, `contracts/ui-contract.md`, `quickstart.md`).

## Global Constraints

- Worktree: `/Users/sgueniot/.claudette/workspaces/Claudette-mobile/running-agents-bar`, branch `sgueniot-ua/running-agents-bar`. Never push.
- Front only: no Rust change, no new Tauri command/event, no persisted setting or DB field.
- After any TS change (tests included): `cd src/ui && bunx tsc -b && bun run test` must pass; CSS changes also `bun run lint:css`.
- Colors/styling only via `var(--token)` from `styles/theme.css` (constitution V). Appliquer ~/.claude/rules/design-system.md (composants et tokens DS uniquement, composants UI par spécialisation ou composition) — here: reuse `TaskStateIcon`, `AgentToolCallGroup`, theme tokens; no raw values.
- God files: do not add responsibilities to `ChatPanel.tsx`, `ChatInputArea.tsx`, `Sidebar.tsx`, `services/tauri.ts`. `ChatPanelSessionView.tsx` gets one JSX line; `RightSidebar.tsx` gets one tab button + one panel branch.
- "Running" = `isAgentRunningState(agentTaskState(activity, live))` with `live = true` for `toolActivities[sessionId]`, `false` for `completedTurns`. Never use `groupHasRunningActivity`.
- Sub-agent = top-level `ToolActivity` with `toolName === "Agent"` whose `inputJson` does NOT have both non-empty `team_name` and `name`.
- Bar shows at most `RUNNING_AGENTS_BAR_MAX_ROWS = 3` rows, then a "+N more" button.
- New labels in namespace `chat`, same keys in all 6 `src/ui/src/locales/{de,en,es,ja,pt-BR,zh-CN}/chat.json`.
- Each test cites the spec rule it covers in a comment (`// FR-001`).
- Fixtures built from the real `ToolActivity` type (`stores/slices/chatSlice.ts:14-38`); copy the local `agent(id, overrides)` helper style of `components/chat/AgentActivityGroups.test.tsx:31`. Component tests: `// @vitest-environment happy-dom`, `import "../../i18n"`, `vi.mock("../../workers/highlight.worker?worker")`, reset store with `useAppStore.setState()` in `beforeEach`.
- Conventional commits, header ≤ 100 chars.
- Choix fonctionnel non couvert par la spec : ne pas trancher, rendre BLOCKED avec la question.

**User decisions (already made):**
- Approach 1: front only, data derived from the store activities used by the chat's agent card; new right-sidebar tab "Agents"; detail reuses the agent card rendering.
- Click target is option B: live detail in the right sidebar, chat scroll position untouched.
- Desktop only; remote app out of scope.
- Bar pinned above the chat input; ≤ 3 rows then "+N"; finished agents kept in the Agents tab.
- Validated behavior change: `task_started` without status on an `Agent` → `agentStatus = "starting"`.

## Review Focus

1. A background agent just launched (tool_result "launched…" already present, no status yet) must appear in the bar immediately → Task 2 test `task_started without status marks an Agent starting`.
2. A background agent whose launching turn already ended (activity in `completedTurns`) must still be listed while running → Task 1 test `lists a running agent from a completed turn`.
3. Team agents (`team_name` + `name` in input) must never appear → Task 1 test `excludes team agents`.
4. Switching chats must not leak another session's agents or selection → Task 1 test `scopes to the session` and Task 5 test `follows the active session`.
5. A selected agent that vanishes (rollback/clear) must not crash the panel → Task 5 test `orphan selection shows the list`.

## Spec coverage

| Rule | Task | Tests |
|---|---|---|
| FR-001 | 1, 4 | `sessionAgents.test.ts › runningSessionAgents keeps only running`; `RunningAgentsBar.test.tsx › renders one row per running agent` |
| FR-002 | 4 | `RunningAgentsBar.test.tsx › renders nothing without running agents`, `› disappears when the last agent finishes` |
| FR-003 | 4 | `RunningAgentsBar.test.tsx › row shows icon, type and description` |
| FR-004 | 1, 2 | `sessionAgents.test.ts › running matches agentTaskState`; `useAgentStream.taskStartedStarting.test.tsx › task_started without status marks an Agent starting` |
| FR-005 | 4 | `RunningAgentsBar.test.tsx › is mounted outside the messages scroller` (ChatPanelSessionView structure) |
| FR-006 | 4 | `RunningAgentsBar.test.tsx › caps at 3 rows with +N more`, `› +N opens the Agents tab without selection` |
| FR-007 | 3, 4 | `uiSlice.agents.test.ts › openAgentInSidebar selects, switches tab and opens sidebar`; `RunningAgentsBar.test.tsx › row click opens the agent` |
| FR-008 | 3, 5 | `uiSlice.agents.test.ts › agents is a valid right sidebar tab`; `AgentsPanel.test.tsx › RightSidebar shows an Agents tab` |
| FR-009 | 1, 5 | `sessionAgents.test.ts › orderForAgentsPanel puts running first`; `AgentsPanel.test.tsx › lists running then finished` |
| FR-010 | 5 | `AgentsPanel.test.tsx › detail renders the agent card expanded` |
| FR-011 | 5 | `AgentsPanel.test.tsx › shows the empty state` |
| FR-012 | 1, 5 | `sessionAgents.test.ts › scopes to the session`; `AgentsPanel.test.tsx › follows the active session` |
| FR-013 | 1 | `sessionAgents.test.ts › excludes team agents`, `› ignores nested agents` |
| FR-014 | 4, 5 | `chatLocales.agents.test.ts › every locale has the new keys` |
| FR-015 | 4, 5 | `RunningAgentsBar.test.tsx › rows are buttons with accessible names`; `AgentsPanel.test.tsx › selected agent has aria-current` |
| FR-016 | 6 | docs build/review (no unit test) |
| FR-017 | 0, 2 | `useViewTogglePersistence` existing tests; `useAgentStream.taskStartedStarting.test.tsx › task_started leaves a Bash activity untouched`; existing `AgentActivityGroups`/`TaskList` tests unchanged |

---

### Task 0: Unify the right-sidebar tab type

**Goal:** One exported `RightSidebarTab` type replaces the 5 duplicated `"files" | "changes" | "tasks"` unions, with no behavior change.

**Files:**
- Modify: `src/ui/src/stores/slices/uiSlice.ts:33,46`
- Modify: `src/ui/src/components/right-sidebar/RightSidebar.tsx:117`
- Modify: `src/ui/src/components/file-viewer/editor-menubar/useEditorActions.ts:56`
- Modify: `src/ui/src/hooks/useViewTogglePersistence.ts:26,38`

**Acceptance Criteria:**
- [ ] `export const RIGHT_SIDEBAR_TABS = ["files", "changes", "tasks"] as const; export type RightSidebarTab = (typeof RIGHT_SIDEBAR_TABS)[number];` live in `uiSlice.ts` and every former union imports them.
- [ ] `grep -rn '"files" | "changes" | "tasks"' src/ui/src` returns nothing.
- [ ] Existing tests pass unchanged.

**Verify:** `cd src/ui && bunx tsc -b && bun run test` → all pass

**Steps:**
- [ ] **Step 1:** Add the const + type to `uiSlice.ts`; replace the unions at the 4 other sites; `useViewTogglePersistence.ts` imports `RIGHT_SIDEBAR_TABS` instead of declaring its own.
- [ ] **Step 2:** Run Verify.
- [ ] **Step 3: Commit** `refactor(ui): share one RightSidebarTab type`

```json:metadata
{"files":["src/ui/src/stores/slices/uiSlice.ts","src/ui/src/components/right-sidebar/RightSidebar.tsx","src/ui/src/components/file-viewer/editor-menubar/useEditorActions.ts","src/ui/src/hooks/useViewTogglePersistence.ts"],"verifyCommand":"cd src/ui && bunx tsc -b && bun run test","acceptanceCriteria":["single exported RightSidebarTab type","no duplicated union left","existing tests pass"],"modelTier":"mechanical"}
```

### Task 1: Session sub-agent selectors and hook

**Goal:** Pure selectors and a memoized hook that list a session's sub-agents with the card's running rule.

**Files:**
- Create: `src/ui/src/stores/sessionAgents.ts`, `src/ui/src/stores/sessionAgents.test.ts`
- Create: `src/ui/src/hooks/useSessionAgents.ts`

**Interfaces:**
```ts
export interface SessionAgent {
  toolUseId: string; activity: ToolActivity; live: boolean;
  state: TaskState; running: boolean; subagentType: string | null; label: string;
}
export function isTeamAgentActivity(activity: ToolActivity): boolean;
export function collectSessionAgents(live: ToolActivity[], completed: CompletedTurn[]): SessionAgent[]; // launch order: completed turns oldest→newest, then live; activity order inside a turn
export function runningSessionAgents(agents: SessionAgent[]): SessionAgent[];
export function orderForAgentsPanel(agents: SessionAgent[]): SessionAgent[]; // running first, then the rest; launch order kept in each group
export function useSessionAgents(sessionId: string | null): SessionAgent[]; // stable EMPTY array, pattern of hooks/useLiveWorkflows.ts
```
`state = agentTaskState(activity, live)`, `running = isAgentRunningState(state)`, `subagentType = agentSubagentType(activity)`, `label = activitySummaryText(activity)`.

**Acceptance Criteria:**
- [ ] Only top-level `toolName === "Agent"` activities, team agents excluded.
- [ ] Running agents from completed turns are included.
- [ ] Order as specified.

**Verify:** `cd src/ui && bun run test src/stores/sessionAgents.test.ts && bunx tsc -b` → pass

**Steps:**
- [ ] **Step 1: Write failing tests** in `sessionAgents.test.ts`:
  - `runningSessionAgents keeps only running` (FR-001): live `[agent("a",{agentStatus:"running"}), agent("b",{agentStatus:"completed"})]` → running ids `["a"]`.
  - `running matches agentTaskState` (FR-004): for agents with statuses `running|starting|completed|failed|stopped|null+resultText`, `running === isAgentRunningState(agentTaskState(a, live))`.
  - `lists a running agent from a completed turn` (FR-001): completed turn activity `agent("c",{agentStatus:"running"})` → running ids `["c"]`, `live === false`.
  - `orderForAgentsPanel puts running first` (FR-009): completed `[x done, y running]`, live `[z running]` → `["y","z","x"]`.
  - `excludes team agents` (FR-013): `agent("t",{inputJson: JSON.stringify({description:"d", team_name:"T", name:"n"})})` → absent; with only `team_name` → present.
  - `ignores nested agents` (FR-013): an `agentToolCalls` entry with `toolName:"Agent"` inside a parent → only the parent listed.
  - `ignores non-Agent tools` : a `Bash` activity → absent.
  - `scopes to the session` (FR-012): `renderHook`-style or direct store test — `useSessionAgents("s1")` returns only s1 agents when s2 also has some (can be tested through `collectSessionAgents(state.toolActivities.s1, state.completedTurns.s1)` plus one hook render).
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run Verify → PASS.
- [ ] **Step 5: Commit** `feat(chat): derive a session's sub-agents from tool activities`

```json:metadata
{"files":["src/ui/src/stores/sessionAgents.ts","src/ui/src/stores/sessionAgents.test.ts","src/ui/src/hooks/useSessionAgents.ts"],"verifyCommand":"cd src/ui && bun run test src/stores/sessionAgents.test.ts && bunx tsc -b","acceptanceCriteria":["top-level Agent activities only, team agents excluded","running agents from completed turns included","launch order and running-first panel order"],"modelTier":"standard"}
```

### Task 2: Mark an Agent "starting" on task_started

**Goal:** `task_started` without `status` sets `agentStatus = "starting"` on an `Agent` activity only, so a just-launched background agent reads as running.

**Files:**
- Modify: `src/ui/src/hooks/useAgentStream.ts:~740-744` (the `if (streamEvent.status) … else if (task_progress)` block)
- Create: `src/ui/src/hooks/useAgentStream.taskStartedStarting.test.tsx` (model on `useAgentStream.backgroundAgent.test.tsx`)

**Acceptance Criteria:**
- [ ] `task_started` (no status) for an `Agent` activity whose `resultText` is already the launch acknowledgement → `agentStatus === "starting"`, `agentTaskState(...) === "progress"`.
- [ ] Same event for a `Bash` activity → `agentStatus` unchanged (`undefined`/`null`).
- [ ] `task_started` with an explicit status still uses that status.
- [ ] Works when the activity is already in `completedTurns`.

**Verify:** `cd src/ui && bun run test src/hooks/useAgentStream && bunx tsc -b` → pass

**Steps:**
- [ ] **Step 1: Write failing tests** `task_started without status marks an Agent starting` (FR-004), `task_started leaves a Bash activity untouched` (FR-017), `task_started keeps an explicit status`, `task_started reaches an Agent in a completed turn`.
- [ ] **Step 2:** Run → FAIL on the first and last.
- [ ] **Step 3:** In the block, add `else if (streamEvent.subtype === "task_started" && findToolActivity(useAppStore.getState(), sessionId, streamEvent.tool_use_id)?.toolName === "Agent") updates.agentStatus = "starting";`.
- [ ] **Step 4:** Run Verify → PASS (existing `useAgentStream.*` tests too).
- [ ] **Step 5: Commit** `fix(chat): show a just-launched background agent as starting`

```json:metadata
{"files":["src/ui/src/hooks/useAgentStream.ts","src/ui/src/hooks/useAgentStream.taskStartedStarting.test.tsx"],"verifyCommand":"cd src/ui && bun run test src/hooks/useAgentStream && bunx tsc -b","acceptanceCriteria":["Agent task_started without status -> starting","Bash activity untouched","explicit status kept","completed-turn activity updated"],"modelTier":"standard"}
```

### Task 3: Agents tab in the store

**Goal:** Add the `agents` tab value, the per-session agent selection and the `openAgentInSidebar` action.

**Files:**
- Modify: `src/ui/src/stores/slices/uiSlice.ts`
- Modify: `src/ui/src/hooks/useViewTogglePersistence.ts` (only if its tests need the new value)
- Create: `src/ui/src/stores/slices/uiSlice.agents.test.ts`

**Interfaces:**
```ts
RIGHT_SIDEBAR_TABS = ["files", "changes", "tasks", "agents"] as const;
selectedAgentBySession: Record<string, string | null>;          // UI-only, not persisted
openAgentInSidebar(workspaceId: string, sessionId: string, toolUseId: string | null): void;
selectAgentInSidebar(sessionId: string, toolUseId: string | null): void;
```
`openAgentInSidebar` sets `selectedAgentBySession[sessionId] = toolUseId`, `rightSidebarTabByWorkspace[workspaceId] = "agents"`, and `rightSidebarVisible = true`.

**Acceptance Criteria:**
- [ ] Sidebar hidden → visible after the action; already visible → stays visible.
- [ ] `selectedAgentBySession` is not written by `useViewTogglePersistence`.
- [ ] A persisted `rightSidebarTab: "agents"` is accepted; an unknown value still falls back to `files`.

**Verify:** `cd src/ui && bun run test src/stores src/hooks/useViewTogglePersistence && bunx tsc -b` → pass

**Steps:**
- [ ] **Step 1: Write failing tests** `agents is a valid right sidebar tab` (FR-008), `openAgentInSidebar selects, switches tab and opens sidebar` (FR-007), `openAgentInSidebar with null clears the selection` (FR-006), `selectAgentInSidebar changes only that session` (FR-012).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run Verify → PASS.
- [ ] **Step 5: Commit** `feat(ui): add the Agents right-sidebar tab state`

```json:metadata
{"files":["src/ui/src/stores/slices/uiSlice.ts","src/ui/src/hooks/useViewTogglePersistence.ts","src/ui/src/stores/slices/uiSlice.agents.test.ts"],"verifyCommand":"cd src/ui && bun run test src/stores src/hooks/useViewTogglePersistence && bunx tsc -b","acceptanceCriteria":["agents tab value","openAgentInSidebar selects, switches tab, opens sidebar","selection not persisted","unknown persisted tab falls back to files"],"modelTier":"standard"}
```

### Task 4: Running agents bar

**Goal:** A bar above the chat input listing the session's running sub-agents, each a button opening it in the Agents tab.

**Files:**
- Create: `src/ui/src/components/chat/RunningAgentsBar.tsx`, `RunningAgentsBar.module.css`, `RunningAgentsBar.test.tsx`
- Modify: `src/ui/src/components/chat/ChatPanelSessionView.tsx:391` (add `<RunningAgentsBar workspaceId={selectedWorkspaceId} sessionId={activeSessionId} />` next to `WorkflowStatusPill`, guarded like the input)
- Modify: `src/ui/src/locales/{de,en,es,ja,pt-BR,zh-CN}/chat.json`
- Create: `src/ui/src/locales/chatLocales.agents.test.ts`

**Interfaces:** `export const RUNNING_AGENTS_BAR_MAX_ROWS = 3; export function RunningAgentsBar({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }): JSX.Element | null`

Keys (en): `running_agents_bar_label: "Running agents"`, `running_agents_more: "+{{count}} more"`, `running_agent_open: "Open {{type}} agent: {{description}} ({{state}})"`, `agents_tab: "Agents"`, `agents_panel_empty: "No sub-agents were launched in this chat."`, `agents_panel_running: "Running"`, `agents_panel_finished: "Finished"`, `agents_panel_all: "All agents"`. Translate in the 5 other locales.

**Layout:** container `<nav aria-label={t("running_agents_bar_label")}>`; each row is a `<button>` with `TaskStateIcon state="progress"` wrapped in a span animated by CSS (pulse, `animation: none` under `@media (prefers-reduced-motion: reduce)`), the subagent type (omitted when null) and the description truncated to one line (`text-overflow: ellipsis`). Style from `WorkflowStatusPill.module.css` tokens.

**Acceptance Criteria:**
- [ ] Nothing rendered when no agent runs; rows appear/disappear as states change.
- [ ] Max 3 rows; "+N more" button opens the tab with `toolUseId = null`.
- [ ] Row click calls `openAgentInSidebar(workspaceId, sessionId, toolUseId)`; chat scroll untouched (no scroll call).
- [ ] Every new key present in all 6 locales.

**Verify:** `cd src/ui && bun run test src/components/chat/RunningAgentsBar src/locales && bunx tsc -b && bun run lint:css` → pass

**Steps:**
- [ ] **Step 1: Write failing tests**: `renders nothing without running agents` (FR-002), `renders one row per running agent` (FR-001), `row shows icon, type and description` (FR-003), `disappears when the last agent finishes` (FR-002: update store status to `completed`, assert null), `caps at 3 rows with +N more` (FR-006: 5 running → 3 rows + "+2 more"), `+N opens the Agents tab without selection` (FR-006), `row click opens the agent` (FR-007: store `rightSidebarTabByWorkspace[ws] === "agents"`, selection set), `rows are buttons with accessible names` (FR-015: `getByRole("button", {name: /scout.*Attendre 9/})`), `is mounted outside the messages scroller` (FR-005: render `ChatPanelSessionView` minimal or assert in its existing test that the bar is not inside `.messages`; if `ChatPanelSessionView` has no test harness, assert via a DOM query in a smoke render with mocked children), and in `chatLocales.agents.test.ts` `every locale has the new keys` (FR-014).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement component, CSS, mount line, locale keys.
- [ ] **Step 4:** Run Verify → PASS.
- [ ] **Step 5: Commit** `feat(chat): pin running sub-agents above the chat input`

```json:metadata
{"files":["src/ui/src/components/chat/RunningAgentsBar.tsx","src/ui/src/components/chat/RunningAgentsBar.module.css","src/ui/src/components/chat/RunningAgentsBar.test.tsx","src/ui/src/components/chat/ChatPanelSessionView.tsx","src/ui/src/locales/en/chat.json","src/ui/src/locales/de/chat.json","src/ui/src/locales/es/chat.json","src/ui/src/locales/ja/chat.json","src/ui/src/locales/pt-BR/chat.json","src/ui/src/locales/zh-CN/chat.json","src/ui/src/locales/chatLocales.agents.test.ts"],"verifyCommand":"cd src/ui && bun run test src/components/chat/RunningAgentsBar src/locales && bunx tsc -b && bun run lint:css","acceptanceCriteria":["hidden without running agents","one row per running agent with icon, type, description","max 3 rows then +N more","row click opens agent in Agents tab","keys in 6 locales","reduced motion respected"],"modelTier":"standard"}
```

### Task 5: Agents panel in the right sidebar

**Goal:** A new "Agents" tab listing the active session's sub-agents (running first) with the selected one rendered by `AgentToolCallGroup`.

**Files:**
- Create: `src/ui/src/components/right-sidebar/AgentsPanel.tsx`, `AgentsPanel.module.css`, `AgentsPanel.test.tsx`
- Modify: `src/ui/src/components/right-sidebar/RightSidebar.tsx` (tab button `t("agents_tab")` after Tasks; panel branch `activeTab === "agents"`)

**Interfaces:** `export function AgentsPanel({ workspaceId }: { workspaceId: string }): JSX.Element` — session = `selectActiveSessionId` for the workspace (`stores/useAppStore.ts:156`); agents = `orderForAgentsPanel(useSessionAgents(sessionId))`; selection = `selectedAgentBySession[sessionId]`, ignored if not in the list.

**Layout:** list with two headings (`agents_panel_running`, `agents_panel_finished`, a heading only when its group is non-empty); each item a `<button aria-current={selected ? "true" : undefined}>` with `TaskStateIcon state={agent.state}`, type, label; click → `selectAgentInSidebar`. When an agent is selected: an `agents_panel_all` back button above `<AgentToolCallGroup activity={agent.activity} searchQuery="" worktreePath={…} collapsed={false} onToggle={() => {}} live={agent.live} />` (check the component's real prop names/types before use). Empty state text `agents_panel_empty`.

**Acceptance Criteria:**
- [ ] Running agents listed before finished ones.
- [ ] Selected agent detail renders the existing card, expanded, live updates through the store.
- [ ] Empty state when the session has no sub-agent.
- [ ] Switching active session switches list and selection.
- [ ] Orphan selection shows the list without detail.

**Verify:** `cd src/ui && bun run test src/components/right-sidebar && bunx tsc -b && bun run lint:css` → pass

**Steps:**
- [ ] **Step 1: Write failing tests**: `lists running then finished` (FR-009), `detail renders the agent card expanded` (FR-010: agent with `agentResultText:"fini"` and one `agentToolCalls` entry → both visible), `shows the empty state` (FR-011), `follows the active session` (FR-012), `orphan selection shows the list` (edge case), `selected agent has aria-current` (FR-015), `RightSidebar shows an Agents tab` (FR-008: render `RightSidebar` as in `RightSidebar.cache.test.tsx`, click the tab, panel visible).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement panel and wire the tab.
- [ ] **Step 4:** Run Verify → PASS (existing `RightSidebar.cache.test.tsx`, `TaskList.test.tsx` unchanged).
- [ ] **Step 5: Commit** `feat(ui): add an Agents tab with live sub-agent detail`

```json:metadata
{"files":["src/ui/src/components/right-sidebar/AgentsPanel.tsx","src/ui/src/components/right-sidebar/AgentsPanel.module.css","src/ui/src/components/right-sidebar/AgentsPanel.test.tsx","src/ui/src/components/right-sidebar/RightSidebar.tsx"],"verifyCommand":"cd src/ui && bun run test src/components/right-sidebar && bunx tsc -b && bun run lint:css","acceptanceCriteria":["running first then finished","detail is the expanded agent card","empty state","follows active session","orphan selection safe","Agents tab in right sidebar"],"modelTier":"standard"}
```

### Task 6: User documentation

**Goal:** Document the bar and the Agents tab, and how it differs from Tasks.

**Files:**
- Create: `site/src/content/docs/features/running-agents.mdx`
- Modify: `site/astro.config.mjs` (sidebar entry next to Task History)
- Modify: `site/src/content/docs/features/task-history.mdx` (one sentence linking to the new page in "Subagent Tasks")

**Acceptance Criteria:**
- [ ] Page covers: when the bar shows, 3 rows + "+N more", click → Agents tab, list order, detail content, finished agents kept, team agents excluded, desktop only, Tasks = checklists vs Agents = activity.
- [ ] Page reachable from the sidebar nav.

**Verify:** `grep -n running-agents site/astro.config.mjs site/src/content/docs/features/task-history.mdx` → both match

**Steps:**
- [ ] **Step 1:** Write the page (frontmatter `title: Running Agents`, `description`), register it, add the link.
- [ ] **Step 2:** Run Verify.
- [ ] **Step 3: Commit** `docs: document the running agents bar and Agents tab`

```json:metadata
{"files":["site/src/content/docs/features/running-agents.mdx","site/astro.config.mjs","site/src/content/docs/features/task-history.mdx"],"verifyCommand":"grep -n running-agents site/astro.config.mjs site/src/content/docs/features/task-history.mdx","acceptanceCriteria":["page documents bar and tab","registered in nav","Tasks page links to it"],"modelTier":"mechanical"}
```
