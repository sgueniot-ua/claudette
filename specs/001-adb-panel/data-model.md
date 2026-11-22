# Data Model: Volet ADB lié au workspace

Types du crate `claudette` (`src/model/adb.rs`, tous `Serialize`, sans IO) et leurs miroirs
TypeScript (`src/ui/src/types/adb.ts`).

## AdbDevice

Appareil vu par `adb devices -l`.

| Champ | Type | Règle |
|---|---|---|
| `serial` | `String` | non vide ; `emulator-NNNN` pour un émulateur |
| `state` | `AdbDeviceState` | `Device` (prêt), `Offline`, `Unauthorized`, `Other(String)` |
| `model` | `Option<String>` | champ `model:` de `adb devices -l`, `_` remplacés par des espaces |
| `avd_name` | `Option<String>` | émulateurs seulement, lu par `emu avd name` |

Nom affiché (FR-005) : `avd_name`, sinon `model`, sinon `serial`.

## DeviceKey

Identité stable d'un appareil choisi à la main (R7).

| Variante | Contenu | Correspondance |
|---|---|---|
| `Avd(String)` | nom d'AVD | appareil dont `avd_name` est égal |
| `Serial(String)` | numéro de série | appareil dont `serial` est égal |

Sérialisation dans `app_settings` : `avd:<nom>` / `serial:<série>` ; toute autre valeur est
ignorée (traitée comme absente).

## Resolution

Résultat de `resolve_device(manual: Option<&DeviceKey>, dedicated_avd: Option<&str>, kept: Option<&DeviceKey>, devices: &[AdbDevice])`. `kept` est l'appareil choisi automatiquement plus tôt par la session (émulateur dédié ou unique appareil prêt), tenu dans l'état de la tâche de session, jamais persisté.

| Variante | Quand | Volet (FR-008) |
|---|---|---|
| `Device { serial, source }` | appareil retenu, `state == Device` | logs |
| `Unavailable { key, source }` | appareil retenu mais absent ou pas prêt | « appareil déconnecté », attente |
| `NeedsChoice` | aucun choix manuel, pas d'émulateur dédié, pas d'appareil `kept`, ≥ 2 appareils prêts | liste à choisir |
| `NoDevice` | aucun choix manuel, aucun appareil prêt | message + comment en associer un |

`source` : `Manual` | `DedicatedEmulator` | `OnlyDevice` (affiché dans l'en-tête du volet).

Ordre (FR-007) : `Manual` → `DedicatedEmulator` (seulement si démarré et prêt) → appareil `kept` → `OnlyDevice`.
L'appareil `kept` est gardé tant qu'il est prêt, même si un autre appareil prêt se connecte (FR-007e), et attendu (`Unavailable`) quand il disparaît, quels que soient les autres appareils (FR-007f). Seuls le choix manuel et un émulateur dédié prêt le devancent.
Un choix manuel ne retombe jamais sur un autre appareil (FR-007c) : absent → `Unavailable`.

## LogcatLine

Une ligne analysée du format `threadtime`.

| Champ | Type | Règle |
|---|---|---|
| `ts` | `Option<String>` | `MM-DD HH:MM:SS.mmm` ; sert de reprise `-T` (R3) |
| `pid`, `tid` | `Option<u32>` | |
| `level` | `Option<LogLevel>` | `V D I W E F A` ; détermine le token de couleur |
| `tag` | `Option<String>` | |
| `message` | `String` | ligne brute entière si le format n'est pas reconnu (en-têtes `--------- beginning of`) |

## AdbSessionStatus

État d'une session de workspace, porté par l'événement `adb-session-status`.

| État | Signification |
|---|---|
| `AdbMissing` | outil adb introuvable (R5) |
| `NoDevice` / `NeedsChoice` | voir `Resolution` |
| `Waiting { device, reason }` | appareil retenu, absent ou pas prêt ; `reason` : `Disconnected` / `Unauthorized` ; reprise auto (FR-009, FR-005) |
| `Streaming { device, source }` | logcat en cours |
| `Stopped` | session arrêtée (archivage, suppression, mode Android désactivé) |

Transitions : `Streaming → Waiting` à la fin du processus logcat ou à la disparition de
l'appareil ; `Waiting → Streaming` au retour de l'appareil (reprise `-T <dernier ts>`) ; tout état
→ nouvelle résolution quand la liste d'appareils ou le choix manuel change ; tout état → `Stopped`
(fin).

## Réglages persistés (`app_settings`)

| Clé | Valeur | Défaut |
|---|---|---|
| `repo:{repo_id}:android_mode` | `"true"` | absent = désactivé (FR-001a) |
| `workspace:{workspace_id}:adb_device` | `avd:<nom>` / `serial:<série>` | absent = automatique (FR-007a) |

## État frontend (non persisté)

`adbSlice` : `adbPanelVisible: boolean`, `adbPanelWidth: number` (px, 240–1200, défaut 480),
`adbSessions: Record<workspaceId, AdbSessionStatus>`, `adbDevices: AdbDevice[]`,
`adbLogVersion: Record<workspaceId, number>`, `androidModeByRepo: Record<repoId, boolean>`.
Lignes : tampon circulaire hors store, 50 000 lignes par workspace (R2, FR-006b) ; par workspace,
`followTail: boolean` (FR-006a) et position figée, non persistés.
