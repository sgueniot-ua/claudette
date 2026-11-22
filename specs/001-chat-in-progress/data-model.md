# Data Model: Indicateur de chat et de workspace en cours

Aucune donnée persistée : pas de migration, et aucun champ de base de données n'est ajouté ou
modifié. Tous les états viennent du runtime.

## Types existants réutilisés (inchangés)

- `AgentStatus` (`src/model/workspace.rs`). Correspondance avec les états de la spec :
  - `Running` et `Compacting` → « en cours » ;
  - `IdleWithBackground` → « tâches en arrière-plan » ;
  - `Idle`, `Stopped` et `Error` → « inactif ».
- Sessions et workspaces archivés : exclus de tous les calculs.
- `AttentionKind` (`src/model`) : `Ask` | `Plan` → « en attente de l'utilisateur ».
- `ChatSession.agent_status`, `.needs_attention` et `.attention_kind` : déjà sérialisés.

## Nouveaux types (`src/model/activity.rs`, `Serialize` + `Deserialize`)

```rust
pub struct SessionActivity {
    pub session_id: String,
    pub agent_status: AgentStatus,          // Running | IdleWithBackground | Idle
    pub needs_attention: bool,
    pub attention_kind: Option<AttentionKind>,
}

pub struct WorkspaceActivity {
    pub workspace_id: String,
    pub agent_status: AgentStatus,          // agrégat FR-002
    pub attention_kind: Option<AttentionKind>, // agrégat : Ask > Plan
    pub sessions: Vec<SessionActivity>,     // sessions non archivées
}
```

## Règles (fonctions pures, `src/activity.rs`)

| Fonction | Règle | Spec |
|---|---|---|
| `session_status(process_active, background_running) -> AgentStatus` | processus actif → `Running` ; sinon, tâche en arrière-plan active → `IdleWithBackground` ; sinon `Idle` | FR-001 |
| `workspace_status(&[SessionActivity]) -> AgentStatus` | au moins un `Running` → `Running` ; sinon au moins un `IdleWithBackground` → `IdleWithBackground` ; sinon `Idle` | FR-002 |
| `workspace_attention(&[SessionActivity]) -> Option<AttentionKind>` | au moins un `Ask` → `Ask` ; sinon au moins un `Plan` → `Plan` ; sinon `None` (ordre actuel de la barre latérale desktop) | FR-011, FR-012 |

## États d'affichage (frontends)

```ts
type ActivityDisplay = "ask" | "plan" | "running" | "background" | "idle" | "unknown";
// null : liaison active mais état non fourni par le desktop → aucun indicateur
type ActivityDisplayOrNone = ActivityDisplay | null;
```

Sur la télécommande, si la liaison fonctionne mais que l'état n'est pas disponible (RPC en erreur
ou inconnue du desktop), aucun indicateur n'est affiché (`ActivityDisplayOrNone` = `null`).

Priorité, du plus fort au plus faible : `unknown` (télécommande déconnectée ; remplace tout,
attente comprise) > `ask` / `plan`
(attention) > `running` > `background` > `idle`. C'est la priorité actuelle du desktop, avec
`background` inséré entre `running` et `idle`.

- Barre latérale desktop, ordre complet d'une ligne de workspace : `ask` > `plan` >
  `background` > badge « terminé, non lu » > spinner d'environnement > `running` > icônes Stopped,
  PR et inactif. Un workspace `running` n'a jamais de badge « terminé » : ce badge n'existe que
  quand le workspace n'est pas busy. Seul le passage de `background` avant le badge change par
  rapport à aujourd'hui (exception FR-011).
- Transitions : pilotées par le runtime (début de tour, fin de process, fin de la dernière
  tâche en arrière-plan, question posée ou répondue). Aucun état n'est conservé côté client, sauf le dernier
  résultat RPC.
