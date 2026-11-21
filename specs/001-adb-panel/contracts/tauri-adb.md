# Contract: commandes et événements Tauri du volet ADB

Nouveau domaine `src-tauri/src/commands/adb.rs` (wrappers fins vers `claudette::adb`). Aucun
contrat existant n'est modifié. Types : voir [data-model.md](../data-model.md).

## Commandes

| Commande | Paramètres | Retour | Effet |
|---|---|---|---|
| `adb_get_android_mode` | `repo_id: String` | `bool` | lit `repo:{id}:android_mode` |
| `adb_set_android_mode` | `repo_id: String, enabled: bool` | `()` | écrit / supprime la clé ; `false` arrête les sessions des workspaces du dépôt |
| `adb_open_session` | `workspace_id: String` | `AdbSessionStatus` | démarre (ou retrouve) la session du workspace ; refuse (`Err`) si le dépôt n'a pas le mode Android ou si le workspace est distant |
| `adb_close_session` | `workspace_id: String` | `()` | arrête la session (idempotent) ; appelé côté Rust par l'archivage / la suppression, pas par la fermeture du volet (FR-004a) |
| `adb_list_devices` | — | `Vec<AdbDevice>` | dernière liste connue (interroge adb si aucune) |
| `adb_set_workspace_device` | `workspace_id: String, key: Option<DeviceKey>` | `AdbSessionStatus` | écrit / efface le choix manuel puis re-résout la session |
| `adb_get_workspace_device` | `workspace_id: String` | `Option<DeviceKey>` | lit le choix manuel |

## Événements

| Événement | Charge utile | Fréquence |
|---|---|---|
| `adb-logcat-lines` | `{ workspace_id: String, lines: Vec<LogcatLine>, reset: bool }` | lots ≤ 50 ms ou 500 lignes ; `reset` au changement d'appareil |
| `adb-session-status` | `{ workspace_id: String, status: AdbSessionStatus }` | à chaque transition |
| `adb-devices-changed` | `{ devices: Vec<AdbDevice> }` | quand la liste change (sondage 2 s tant qu'une session existe) |

## Raccourci et commande de palette

| Id | Défaut | Portée |
|---|---|---|
| `global.toggle-adb-panel` | `mod+shift+code:KeyA` (⌘⇧A / Ctrl+Shift+A) | actif seulement si le workspace affiché est local et que son dépôt a le mode Android |
| `adb.open-search` (portée `adb`) | `mod+f` | focus dans le volet ADB (FR-006c) |

La commande de palette « Toggle ADB panel » est masquée aux mêmes conditions que le raccourci
(FR-001a, FR-003a).

## Réglage de dépôt

Settings > Repository (`RepoSettings.tsx`) : interrupteur « Android mode » (désactivé par défaut),
absent pour un dépôt distant. Documenté dans `site/src/content/docs/features/settings.mdx`.

## Hors contrat (non exposé)

Pas de méthode IPC CLI ni de méthode du serveur distant dans cette version (workspaces distants
hors périmètre).
