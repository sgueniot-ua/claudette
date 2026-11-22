# Research: Volet ADB lié au workspace

Décisions techniques de la phase 0. Les choix d'architecture ont été validés par l'utilisateur
le 2026-11-21 (rendu en liste virtualisée, volets côte à côte, mode Android par dépôt).

## R1 — Rendu des logs : liste React virtualisée maison

- **Decision**: une liste React à hauteur de ligne fixe, sans retour à la ligne (défilement
  horizontal pour les lignes longues), virtualisée à la main : seules les lignes visibles
  (+ une marge) sont rendues. Pas de nouvelle dépendance.
- **Rationale**: choix de l'utilisateur (structure par ligne : niveau, tag, message ; ouvre la porte
  à des filtres par niveau). Avec une hauteur fixe, la virtualisation tient en un calcul
  `premièreLigne = scrollTop / hauteurLigne` : quelques dizaines de lignes de code, testables,
  sans dépendance (constitution : dépendances au minimum, binaire < 30 Mo).
- **Alternatives considered**: xterm en lecture seule (recherche et couleurs gratuites, mais rendu
  non structuré ; écarté par l'utilisateur) ; `@tanstack/react-virtual` (utile pour des hauteurs
  variables, inutile à hauteur fixe).

## R2 — Tampon des logs côté frontend

- **Decision**: un tampon circulaire par workspace, hors du store Zustand (module
  `adbLogBuffer.ts`), plafonné à 50 000 lignes ; le store ne garde qu'un compteur de version par
  workspace pour déclencher le rendu, rafraîchi au plus une fois par image (`requestAnimationFrame`).
- **Rationale**: logcat peut produire des milliers de lignes par seconde ; les mettre dans Zustand
  déclencherait un rendu par lot et copierait des tableaux énormes (SC-004). Le plafond borne la
  mémoire ; les lignes les plus anciennes sortent.
- **Alternatives considered**: tout dans Zustand (trop coûteux) ; tampon côté Rust avec
  pagination à la demande (plus d'allers-retours IPC pour un gain nul à cette échelle).

## R3 — Flux logcat côté Rust

- **Decision**: `adb -s <série> logcat -v threadtime -T <n>` lancé par `claudette::process::command`
  (jamais `Command::new`), avec `enriched_env().apply`. Les lignes de stdout sont analysées dans le
  crate `claudette` (`LogcatLine` : date, pid, tid, niveau, tag, message ; ligne non reconnue gardée
  brute) et envoyées par lots (toutes les 50 ms ou 500 lignes) par l'événement Tauri
  `adb-logcat-lines`. Premier lancement : `-T 500` (500 dernières lignes puis le direct). Reprise
  après déconnexion : `-T '<horodatage de la dernière ligne reçue>'` pour éviter les doublons.
- **Rationale**: lots = peu d'événements IPC ; analyse côté Rust = logique testable dans le cœur
  (constitution I) ; `-v threadtime` est le format par défaut d'Android Studio.
- **Alternatives considered**: PTY (inutile, aucune saisie) ; une ligne par événement (des milliers
  d'événements par seconde).

## R4 — Découverte des appareils

- **Decision**: `adb devices -l` interrogé toutes les 2 s, seulement tant qu'au moins une session
  ADB est ouverte ; le nom d'AVD d'un émulateur est lu une fois par série avec
  `adb -s emulator-NNNN emu avd name` et mis en cache jusqu'à la disparition de la série. Le
  changement de liste émet `adb-devices-changed`.
- **Rationale**: simple, robuste aux redémarrages du serveur adb ; aucun appel adb quand aucun
  dépôt n'a de session (FR-001a). 2 s tient SC-002 (bascule de workspace instantanée, la liste est
  déjà connue) et FR-009 (reprise automatique).
- **Alternatives considered**: `adb track-devices` (flux binaire du protocole adb, à relancer à
  chaque mort du serveur, plus de code pour un gain faible).

## R5 — Localisation de l'outil adb

- **Decision**: dans l'ordre : `sdk.dir` de `local.properties` du worktree ; `adb` dans le PATH
  enrichi ; `$ANDROID_HOME` puis `$ANDROID_SDK_ROOT` + `platform-tools/adb` ; SDK par défaut de
  l'OS (`~/Library/Android/sdk`, `~/Android/Sdk`, `%LOCALAPPDATA%\Android\Sdk`). `adb.exe` sous
  Windows. Introuvable → état `AdbMissing` (FR-008).
- **Rationale**: même ordre que l'outillage émulateur existant de l'utilisateur, plus le PATH.

## R6 — Émulateur dédié à la branche

- **Decision**: nom attendu `task-<slug(dépôt)>-<slug(branche)>`, tronqué à 60 caractères ;
  `slug` remplace tout caractère hors `[A-Za-z0-9._-]` par `-` puis retire les `-` des bords ;
  dépôt = dernier segment de l'URL de l'origin sans `.git`, sinon nom du dossier racine ;
  branche = branche extraite dans le worktree (`git rev-parse --abbrev-ref HEAD`), relue à chaque
  résolution (FR-007d) ; HEAD détaché → pas d'émulateur dédié. Fonction
  pure dans `src/adb/naming.rs`, testée sur les cas de la convention existante.
- **Rationale**: Assumption de la spec ; identique à la convention en place pour que les émulateurs
  déjà créés soient reconnus.

## R7 — Règle d'association

- **Decision**: fonction pure `resolve_device(manual, dedicated_avd, kept, devices) -> Resolution` dans
  le cœur : choix manuel présent → cet appareil (connecté ou non : `Offline` s'il manque, on ne
  retombe pas sur un autre, FR-008) ; sinon émulateur dédié démarré ; sinon l'unique appareil
  `device` (prêt : un appareil `unauthorized` ou `offline` ne compte pas) ; sinon `NeedsChoice`
  (≥ 2) ou `NoDevice` (0). Appareil retenu `unauthorized` → `Waiting` avec raison `Unauthorized`
  (FR-005). Le choix manuel identifie un émulateur par
  son nom d'AVD (son numéro de série change d'un démarrage à l'autre) et un appareil physique par
  sa série. `kept` (FR-007e, FR-007f) : l'appareil choisi automatiquement (émulateur dédié ou
  unique appareil prêt) est retenu dans l'état de la tâche de session (clé AVD ou série, jamais
  persistée) ; il passe avant « l'unique appareil prêt » : gardé s'il reste prêt quand un autre
  appareil se connecte ou que son logcat s'arrête, attendu (`Unavailable`) quand il disparaît.
  Seuls le choix manuel et un émulateur dédié prêt le devancent.

## R8 — Persistance

- **Decision**: table `app_settings` existante, sans migration :
  `repo:{repo_id}:android_mode` = `"true"` (absent = désactivé) ;
  `workspace:{workspace_id}:adb_device` = `avd:<nom>` ou `serial:<série>`. La clé du workspace est
  supprimée à la suppression du workspace (et gardée à l'archivage, un workspace restauré retrouve
  son choix).
- **Rationale**: précédents `repo:{id}:claude_flag:*`, `repo:{id}:env_provider:*` ; pas de
  migration (constitution IV non sollicitée).

## R9 — Mise en page côte à côte

- **Decision**: la zone du bas de `AppLayout` devient un conteneur horizontal ; le terminal reste
  toujours monté (règle existante : ne jamais démonter `TerminalPanel`), le volet ADB aussi une fois
  ouvert la première fois. Largeur du volet ADB en pixels dans le store (`adbPanelWidth`, défaut
  480, non persistée), séparateur via le `ResizeHandle` existant (`direction="horizontal"`,
  `cssVar="--adb-w"`, `invert`, min 240, max 1200 — `ResizeHandle` écrit des px). Seul, le volet
  prend toute la largeur. Hauteur commune `terminalHeight`.
- **Rationale**: réutilise les mécanismes de redimensionnement en place ; état d'interface non
  persisté (constitution II).
- **Alternatives considered**: `react-resizable-panels` (déjà en dépendance, mais `AppLayout` utilise
  partout `ResizeHandle` + variables CSS ; on reste cohérent).

## R10 — Raccourci et visibilité

- **Decision**: action `global.toggle-adb-panel`, défaut `mod+shift+code:KeyA` (⌘⇧A, Ctrl+Shift+A),
  catégorie navigation, rebindable ; ignorée si le workspace affiché n'a pas le mode Android ou est
  distant. Libre dans `hotkeys/actions.ts` (vérifié) ; `mod+shift+\`` écarté car ⌘⇧` est le cycle
  inverse des fenêtres de macOS. Bouton `Smartphone` (lucide) dans `PanelToggles`, mêmes conditions.
- **Recherche (FR-006c)**: nouvelle portée `adb` dans `HotkeyScope` et action `adb.open-search`
  (`mod+f`, rebindable), active quand le focus est dans le volet ADB, sur le modèle de
  `terminal.open-search` : le gestionnaire global de recherche du chat ne la reçoit pas.
- **Suivi du bas (FR-006a)**: suivi actif tant que la liste est à moins d'une ligne du bas ; sinon
  figé, avec bouton « derniers logs ». Les lignes évincées du tampon sous une vue figée décalent
  l'index de la première ligne affichée pour que la vue ne saute pas.

## R11 — Workspaces distants

- **Decision**: volet indisponible quand `workspace.remote_connection_id` est non nul (Assumption
  de la spec) ; le réglage mode Android n'est pas proposé pour un dépôt distant.

## R12 — Arrêt des sessions

- **Decision**: une session ouverte vit jusqu'à l'archivage, la suppression, la désactivation du
  mode Android ou la fermeture de l'app (FR-004a, choix de l'utilisateur) ; fermer le volet ou
  changer de workspace ne l'arrête pas, et `adb_close_session` n'est appelé que par ces fins-là.
  Point d'arrêt unique : `TauriHooks::workspace_changed` et `workspaces_changed_bulk`
  (`src-tauri/src/ops_hooks.rs`) pour `Archived` et `Deleted` — ils couvrent l'archivage (GUI,
  CLI, IPC), `delete_workspace` et `delete_workspaces_bulk` (GUI et IPC). `remove_repository`
  (`commands/repository.rs`) arrête en plus les sessions des workspaces du dépôt. À la fermeture
  de l'app, `kill_on_drop` tue les processus `adb logcat`. La clé
  `workspace:{id}:adb_device` est supprimée sur `Deleted` seulement.
