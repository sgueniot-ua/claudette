# Contrat RPC : `get_workspaces_activity`

Nouvelle méthode, ajoutée sans rien changer aux méthodes existantes. Elle est servie par :
- le desktop, via « Share this machine » (`remote_host.rs` → `ipc::dispatch_method`) ;
- l'IPC local, donc aussi le CLI `claudette rpc get_workspaces_activity` ;
- le serveur autonome (`src-server/src/handler.rs`).

## Requête

```json
{ "method": "get_workspaces_activity", "params": {} }
```

## Réponse

Elle couvre les workspaces non archivés et leurs sessions non archivées.

```json
[
  {
    "workspace_id": "ws_1",
    "agent_status": "IdleWithBackground",
    "attention_kind": null,
    "sessions": [
      { "session_id": "s_1", "agent_status": "IdleWithBackground", "needs_attention": false, "attention_kind": null },
      { "session_id": "s_2", "agent_status": "Idle", "needs_attention": false, "attention_kind": null }
    ]
  }
]
```

- `agent_status` prend l'une de ces valeurs : `"Running"`, `"IdleWithBackground"` ou `"Idle"`.
  C'est la sérialisation existante de `AgentStatus`.
- `attention_kind` vaut `"Ask"`, `"Plan"` ou `null`.
- Serveur autonome : `"IdleWithBackground"` n'est jamais renvoyé (research D4).
- En cas d'erreur, la réponse est une erreur JSON-RPC. Si la liaison est active, la télécommande
  n'affiche alors aucun indicateur. Il en va de même pour un desktop plus ancien qui répond
  « méthode inconnue ».
- La méthode est inscrite dans `METHODS` (`ipc.rs`), donc listée par `claudette capabilities`.

## Événements Tauri côté télécommande

| Événement | Source | Effet |
|---|---|---|
| `agent-activity-changed` `{workspace_id, chat_session_id}` | **nouveau**, émis par le desktop après une réponse ou une approbation, `clear_attention`, `stop_agent` et la fin d'une tâche de fond ; ajouté à `FORWARDED_EVENTS`. Le serveur autonome l'émet aussi après une réponse, une approbation et un arrêt | relecture de `get_workspaces_activity` (étranglée à 300 ms) |
| `chat-turn-started`, `agent-stream`, `agent-background-task`, `agent-permission-prompt`, `workspaces-changed`, `chat-session-created` | déjà relayés par `remote_host.rs` et `src-mobile/src/commands.rs` | relecture de `get_workspaces_activity` (étranglée à 300 ms) |
| `remote-connection-state` `{connection_id, connected: bool}` | **nouveau**, émis par `src-mobile` à la fermeture du transport et à la connexion | `false` → tout à « inconnu » ; `true` → relecture |
