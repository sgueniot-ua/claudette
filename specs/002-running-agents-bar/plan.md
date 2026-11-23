# Implementation Plan: Barre des sous-agents en cours et onglet Agents

**Branch**: `sgueniot-ua/running-agents-bar` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-running-agents-bar/spec.md`

## Summary

Afficher en permanence, au-dessus de la saisie d'un chat desktop, les sous-agents (`Agent`) en cours
de la session, et ouvrir leur détail en direct dans un nouvel onglet « Agents » de la barre latérale
droite. Approche retenue par l'utilisateur : **tout côté front** (`src/ui`), données dérivées des
activités d'outil que le store tient déjà pour la carte des agents du chat, règle « en cours »
identique à la carte (`agentTaskState`), détail rendu par le composant existant de la carte
(`AgentToolCallGroup`). Une correction front ciblée : `task_started` sans
statut sur un `Agent` pose `starting`, pour que l'agent de fond soit vu en cours dès son lancement
(research R3). Amendement du 2026-11-23 (revue finale, choix de l'utilisateur) : un balayage Rust au
démarrage passe à `stopped` les activités `Agent` restées `running`/`starting` d'une exécution
précédente de l'app, comme c'est déjà fait pour les Workflows (research R14).

## Technical Context

**Language/Version**: TypeScript (strict), React 19 ; Rust 2024 pour le seul balayage au démarrage (R14)

**Primary Dependencies**: Zustand (store unique à slices), react-i18next, lucide-react — aucune
nouvelle dépendance

**Storage**: SQLite existante, table `turn_tool_activities` (mise à jour de `agent_status` au démarrage, R14) ; sinon état UI non persisté

**Testing**: vitest (+ happy-dom pour les composants), `bunx tsc -b`, `bun run lint:css`

**Target Platform**: Claudette desktop (Tauri 2 webview) macOS / Linux / Windows

**Project Type**: desktop-app (front React seulement pour cette feature)

**Performance Goals**: barre à jour < 2 s après un changement d'état (SC-001) — en pratique au rendu
suivant l'événement ; sélecteur mémoïsé, O(nombre d'activités de la session)

**Constraints**: pas de re-rendu du fil de chat dû à la barre ; tokens de design uniquement ; pas de
nouvelle responsabilité dans les god files (`ChatPanel.tsx`, `ChatInputArea.tsx`)

**Scale/Scope**: quelques dizaines de sous-agents par session au plus

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principe | Statut | Note |
|---|---|---|
| I. Crates en couches | ✅ | balayage dans le crate `claudette` (`src/db/checkpoint.rs`), appelé au démarrage à côté du balayage des Workflows ; aucune commande Tauri ajoutée |
| II. Modèle pur, état | ✅ | état UI dans Zustand, non persisté (`selectedAgentBySession`) ; données dérivées |
| III. Contrats / régressions | ✅ avec réserve | un changement visible intentionnel (carte : `starting` au lancement d'un agent de fond), épinglé par test et signalé en PR ; union d'onglet élargie sans retirer de valeur ; persistance de `rightSidebarTab` tolérante |
| IV. Migrations | ✅ | aucune migration : mise à jour de données existantes au démarrage, comme le balayage des Workflows |
| V. Tokens de design | ✅ | nouveaux CSS modules en `var(--…)`, `lint:css` |
| VI. Sécurité plateformes | ✅ | N/A |
| VII. God files | ✅ | barre dans un composant dédié, une ligne dans `ChatPanelSessionView.tsx` ; panneau dédié ; `RightSidebar.tsx` reçoit seulement l'onglet et le `case` |
| Docs utilisateur | ✅ | nouvelle page `features/running-agents.mdx` + renvoi depuis `task-history.mdx` |

Re-check après Phase 1 : inchangé, aucune violation → pas de Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-running-agents-bar/
├── spec.md
├── plan.md              # ce fichier
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── ui-contract.md   # Phase 1
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/ui/src/
├── stores/
│   ├── sessionAgents.ts                 # NOUVEAU — sélecteurs purs (+ .test.ts)
│   └── slices/uiSlice.ts                # type RightSidebarTab, sélection d'agent, openAgentInSidebar
├── hooks/
│   ├── useSessionAgents.ts              # NOUVEAU — hook mémoïsé
│   ├── useAgentStream.ts                # task_started → "starting" pour un Agent
│   └── useViewTogglePersistence.ts      # accepte "agents"
├── components/
│   ├── chat/
│   │   ├── RunningAgentsBar.tsx         # NOUVEAU (+ .module.css, .test.tsx)
│   │   └── ChatPanelSessionView.tsx     # une ligne : <RunningAgentsBar …/>
│   ├── right-sidebar/
│   │   ├── AgentsPanel.tsx              # NOUVEAU (+ .module.css, .test.tsx)
│   │   └── RightSidebar.tsx             # onglet "Agents" + case
│   └── file-viewer/editor-menubar/useEditorActions.ts  # type RightSidebarTab
└── locales/{de,en,es,ja,pt-BR,zh-CN}/chat.json          # nouvelles clés
site/src/content/docs/features/running-agents.mdx        # NOUVEAU
site/src/content/docs/features/task-history.mdx          # renvoi vers Agents
site/astro.config.mjs                                    # entrée de navigation
src/db/checkpoint.rs                                     # resolve_orphaned_agent_activities (+ test)
src-tauri/src/main.rs                                    # appel au démarrage, à côté du balayage Workflow
```

**Structure Decision**: front desktop uniquement, dans l'arborescence existante `src/ui/src`
(stores / hooks / components par domaine). Ordre de livraison : (1) type `RightSidebarTab` unifié,
sans changement de comportement ; (2) sélecteurs + correction `starting` ; (3) store sélection ;
(4) barre ; (5) onglet ; (6) i18n + docs.

## Complexity Tracking

Aucune violation de la constitution.
