# Implementation Plan: Volet ADB lié au workspace

**Branch**: `sgueniot-ua/worktree-adb-panel` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-adb-panel/spec.md`

## Summary

Un volet ADB, à côté du volet terminal (côte à côte quand les deux sont ouverts), affiche en
lecture seule les logs logcat de l'appareil associé au workspace affiché, pour les dépôts où le
mode Android est activé. Le cœur Rust (`claudette::adb`) localise adb, liste les appareils,
reconnaît l'émulateur dédié à la branche, résout l'appareil du workspace et fait tourner une
session logcat par workspace, avec reprise automatique. Le frontend rend les lignes dans une liste
virtualisée maison alimentée par un tampon circulaire hors store. Détails : [research.md](research.md).

## Technical Context

**Language/Version**: Rust edition 2024 (toolchain 1.94) ; TypeScript strict, React 19

**Primary Dependencies**: Tauri 2, tokio, rusqlite (existants) ; Zustand 5, lucide-react, i18next
(existants). Aucune nouvelle dépendance.

**Storage**: table SQLite `app_settings` existante (clés `repo:{id}:android_mode`,
`workspace:{id}:adb_device`) ; pas de migration

**Testing**: `cargo test` (fonctions pures du cœur, `tempfile` pour `local.properties`) ; vitest
(slice, tampon, virtualisation, recherche, conditions d'affichage)

**Target Platform**: Claudette desktop macOS, Linux, Windows ; outil adb externe requis

**Project Type**: application desktop (cœur Rust + binaire Tauri + webview React)

**Performance Goals**: logs visibles < 3 s après ouverture (SC-001) ; bascule < 1 s (SC-002) ;
interface fluide sous plusieurs milliers de lignes/s (SC-004)

**Constraints**: une session ouverte tourne en fond jusqu'à archivage, suppression, désactivation
du mode ou fermeture de l'app (FR-004a) ; aucun appel adb ni processus pour les dépôts sans mode
Android ; jamais de
`Command::new` brut ; tampon borné à 50 000 lignes par workspace ; démarrage de l'app inchangé
(rien n'est lancé au démarrage)

**Scale/Scope**: quelques workspaces Android simultanés, 1 à 5 appareils

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principe | Verdict | Comment |
|---|---|---|
| I. Layered crates, thin shells | ✅ | logique dans `src/adb/` ; `src-tauri/src/commands/adb.rs` = wrappers fins |
| II. Pure data model, state ownership | ✅ | types dans `src/model/adb.rs` (`Serialize`) ; sessions dans `AppState` ; flux par événements Tauri ; visibilité et largeur du volet non persistées |
| III. Contract stability | ✅ | uniquement des ajouts ; `TerminalPanel` reste toujours monté ; onglets terminal intacts (FR-010) |
| IV. Migrations | ✅ | aucune migration |
| V. Design tokens | ✅ | couleurs des niveaux de log par `var(--…)` de `theme.css` ; `lint:css` |
| VI. Platform safety | ✅ | `claudette::process::command` + `enriched_env` ; `adb.exe` sous Windows ; aucun prompt TCC |
| VII. God files | ✅ | rien d'ajouté dans `TerminalPanel.tsx`, `Sidebar.tsx`, `services/tauri.ts`, `ipc.rs` : services dans `services/adb.ts`, composants dans `components/adb/`, slice dédiée ; arrêt des sessions branché sur `ops_hooks.rs`, pas dans `workspace.rs` |
| Gouvernance | ✅ | CLAUDE.md et configs Copilot mis à jour ensemble (nouveau domaine et module) |
| Docs | ✅ | nouvelle page + réglage + raccourci documentés (FR-012) |

Re-check après Phase 1 : inchangé, aucune violation. Complexity Tracking vide.

## Project Structure

### Documentation (this feature)

```text
specs/001-adb-panel/
├── spec.md
├── plan.md              # ce fichier
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── tauri-adb.md     # Phase 1
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── model/adb.rs                 # AdbDevice, DeviceKey, Resolution, LogcatLine, AdbSessionStatus
├── adb/
│   ├── mod.rs                   # API publique du module
│   ├── locate.rs                # localisation de l'outil adb (R5)
│   ├── naming.rs                # nom de l'émulateur dédié (R6)
│   ├── devices.rs               # analyse de `adb devices -l`, `emu avd name`, sondage (R4)
│   ├── resolve.rs               # règle d'association (R7)
│   ├── logcat.rs                # analyse threadtime, processus logcat, lots (R3)
│   ├── session.rs               # AdbSessions : une session par workspace, reprise (R12)
│   └── settings.rs              # clés app_settings (R8)
└── lib.rs                       # + pub mod adb

src-tauri/src/
├── commands/adb.rs              # commandes du contrat
├── commands/mod.rs              # + mod adb
├── ops_hooks.rs                 # workspace_changed / workspaces_changed_bulk : Archived|Deleted → AdbSessions::stop ; Deleted → efface workspace:{id}:adb_device
├── commands/repository.rs       # remove_repository → stop des sessions du dépôt
├── state.rs                     # + adb_sessions dans AppState
└── main.rs                      # enregistrement des commandes

src/ui/src/
├── types/adb.ts
├── services/adb.ts              # invoke + listen du contrat
├── stores/slices/adbSlice.ts    # état non persisté (data-model)
├── components/adb/
│   ├── AdbPanel.tsx             # en-tête (appareil, source, état), choix d'appareil, recherche
│   ├── AdbLogList.tsx           # liste virtualisée (R1)
│   ├── adbLogBuffer.ts          # tampon circulaire par workspace (R2)
│   ├── adbLogSearch.ts          # recherche dans le tampon
│   └── AdbPanel.module.css
├── components/layout/AppLayout.tsx        # zone du bas côte à côte (R9)
├── components/shared/PanelToggles.tsx     # bouton ADB conditionnel
├── components/settings/sections/RepoSettings.tsx  # interrupteur mode Android
├── hotkeys/actions.ts + hooks/useKeyboardShortcuts.ts  # global.toggle-adb-panel (⌘⇧A), portée `adb` + adb.open-search (⌘F)
├── components/command-palette/commands.ts # commande « Toggle ADB panel »
└── locales/*/                   # libellés

site/src/content/docs/features/
├── android-adb-panel.mdx        # nouvelle page (+ astro.config.mjs)
├── settings.mdx                 # ligne Android mode
└── keyboard-shortcuts.mdx       # raccourcis

CLAUDE.md                        # domaine `adb` dans la liste des commandes Tauri, `src/adb/` dans la structure
.github/copilot-instructions.md  # mêmes listes, alignées (règle de CLAUDE.md)
.github/instructions/*.md        # idem si elles reprennent ces listes
```

**Structure Decision**: structure existante du workspace Cargo et de `src/ui` ; un module cœur
`src/adb/`, un domaine de commandes `adb`, un dossier de composants `components/adb/`.

## Couverture de la spec (tests prévus)

| Règle | Test(s) prévus |
|---|---|
| FR-001 / FR-001a | vitest : bouton et raccourci absents sans mode Android, présents avec ; cargo : `adb_open_session` refusé sans mode |
| FR-001b | vitest : mise en page côte à côte / pleine largeur selon les volets ouverts |
| FR-002 / FR-003 | vitest : le volet affiche la session du workspace sélectionné, bascule au changement |
| FR-003a | vitest : volet masqué sur un workspace sans mode Android ou distant, réaffiché au retour |
| FR-004 | vitest : tampon par workspace conservé au retour |
| FR-004a | vitest : fermer le volet ou changer de workspace n'appelle pas `adb_close_session` ; cargo : la session survit sans abonné |
| FR-005 | vitest : nom affiché (AVD > modèle > série), état et message « non autorisé » ; cargo : `Unauthorized` → `Waiting`, reprise à l'autorisation |
| FR-006 | cargo : analyse threadtime ; vitest : virtualisation, recherche, absence de saisie |
| FR-006a | vitest : suivi du bas, gel quand on remonte, reprise par le bouton, vue stable malgré l'éviction |
| FR-006b | cargo : premier lancement `-T 500` ; vitest : tampon plafonné à 50 000, plus anciennes évincées |
| FR-006c | vitest : ⌘F dans le volet ouvre sa recherche, pas celle du chat |
| FR-007 / FR-007a | cargo : `resolve_device` (4 étapes), (dé)sérialisation `DeviceKey`, clé effacée sur `Deleted` et gardée sur `Archived` |
| FR-007c | cargo : choix manuel absent → `Unavailable`, jamais un autre appareil |
| FR-007d | cargo : la résolution lit la branche extraite (`git rev-parse --abbrev-ref HEAD` du worktree) à chaque appel ; test avec un dépôt `tempfile` dont on change la branche |
| FR-007e / FR-007f | cargo : `resolve_device` avec `kept` (gardé, attendu, priorités), session : reprise après fin de logcat, attente sans bascule, reprise au retour |
| FR-007b | quickstart 15 + vérification en revue : aucun appel au module `adb` dans les chemins de création de workspace |
| FR-008 | cargo : `locate` sans adb → `AdbMissing` ; vitest : messages par état |
| FR-009 | cargo : transitions `Streaming → Waiting → Streaming`, reprise `-T <ts>` |
| FR-010 | vitest : ouvrir ADB ne modifie pas `terminalTabs` ni `terminalPanelVisible` |
| FR-011 | cargo : `AdbSessions::stop` appelé par les hooks `Archived` / `Deleted` (unitaire et en lot) et par `remove_repository` |
| FR-012 | revue : pages de doc présentes |
| Émulateur dédié (Assumption) | cargo : `naming` sur les cas de la convention (slug, troncature 60, `.git`) |
