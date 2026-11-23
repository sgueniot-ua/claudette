# Feature Specification: Barre des sous-agents en cours et onglet Agents

**Feature Branch**: `sgueniot-ua/running-agents-bar`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Dans le chat d'une session de workspace (desktop uniquement), afficher en permanence les sous-agents Claude Code en cours (lancés par l'outil Agent, en arrière-plan ou au premier plan), aujourd'hui seulement visibles dans une carte « N agents » perdue dans le flux du chat. 1) Une barre fixée au-dessus de la zone de saisie, visible seulement tant qu'au moins un sous-agent de la session tourne, une ligne par agent (indicateur animé, type d'agent ex. scout, description) ; elle disparaît quand le dernier a fini. 2) Clic sur un agent : la barre latérale droite s'ouvre sur un nouvel onglet « Agents » (à côté de Files, Changes, Tasks), sélectionné sur cet agent. 3) L'onglet Agents liste les sous-agents de la session (en cours en haut, puis terminés de la session) ; le détail de l'agent sélectionné montre description, type, outil en cours, appels d'outils, durée, tokens, puis son résultat final — même contenu que la carte du chat. Hors périmètre : app remote mobile, agents d'équipe TeamCreate (déjà en onglets de session), panneau Tasks inchangé. Libellés traduits dans les 6 langues de l'app ; documentation utilisateur mise à jour."

## Vocabulaire

- **Chat** : une session de conversation avec un agent, rattachée à un workspace, affichée dans un
  onglet du desktop.
- **Agent principal** : l'agent qui répond au message de l'utilisateur dans un chat.
- **Sous-agent** : un agent lancé par l'agent principal pour une tâche délimitée, au premier plan
  (l'agent principal attend son résultat) ou en arrière-plan (l'agent principal peut finir son tour
  avant lui). Chaque sous-agent a un type (par exemple `scout`, `implementer`) et une description
  courte donnée à son lancement.
- **Carte des agents** : le bloc « N agents » que le chat affiche déjà dans le fil de la
  conversation, avec une entrée dépliable par sous-agent.
- **Barre latérale droite** : le panneau à droite du chat, avec aujourd'hui les onglets Files,
  Changes et Tasks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Voir en permanence les sous-agents en cours (Priority: P1)

L'utilisateur lit ou écrit dans un chat pendant que l'agent principal a lancé des sous-agents. Au
lieu de remonter dans la conversation pour retrouver la carte des agents, il voit, juste au-dessus
de la zone de saisie, la liste des sous-agents de ce chat qui tournent encore. La liste se met à
jour d'elle-même et disparaît quand le dernier sous-agent a fini.

**Why this priority**: c'est le besoin exprimé : la carte des agents se perd dans le flux du chat et
rien ne montre ce qui tourne encore. Cette barre seule apporte déjà la visibilité attendue.

**Independent Test**: dans un chat, demander à l'agent de lancer deux sous-agents qui attendent
9 et 15 secondes ; vérifier que la barre apparaît avec deux lignes, passe à une ligne après environ
9 secondes, puis disparaît après environ 15 secondes, quelle que soit la position de lecture dans
la conversation.

**Acceptance Scenarios**:

1. **Given** un chat sans sous-agent en cours, **When** l'utilisateur regarde le chat, **Then**
   aucune barre des sous-agents n'est affichée.
2. **Given** un chat où l'agent principal vient de lancer deux sous-agents, **When** ils démarrent,
   **Then** la barre apparaît au-dessus de la zone de saisie avec une ligne par sous-agent, chacune
   avec un indicateur animé, le type et la description du sous-agent.
3. **Given** la barre affiche deux sous-agents, **When** l'un d'eux se termine, **Then** sa ligne
   disparaît de la barre et l'autre reste.
4. **Given** la barre affiche un seul sous-agent, **When** il se termine, **Then** la barre
   disparaît.
5. **Given** des sous-agents lancés en arrière-plan et un agent principal qui a fini son tour,
   **When** les sous-agents tournent encore, **Then** la barre reste affichée tant qu'ils tournent.
6. **Given** l'utilisateur a remonté la conversation loin de la carte des agents, **When** des
   sous-agents tournent, **Then** la barre reste visible au-dessus de la zone de saisie.
7. **Given** deux chats du même workspace, dont un seul a des sous-agents en cours, **When**
   l'utilisateur passe de l'un à l'autre, **Then** chaque chat montre seulement ses propres
   sous-agents.

---

### User Story 2 - Suivre un sous-agent sans perdre le fil du chat (Priority: P2)

L'utilisateur veut savoir ce que fait un sous-agent précis. Il clique sur sa ligne dans la barre :
la barre latérale droite s'ouvre sur l'onglet « Agents », positionnée sur ce sous-agent, avec son
activité en direct. Le chat reste à sa position de lecture.

**Why this priority**: c'est le complément de la barre : la voir ne suffit pas toujours, il faut
pouvoir suivre un sous-agent. Elle dépend de la barre (US1) pour le point d'entrée principal.

**Independent Test**: lancer un sous-agent qui exécute plusieurs commandes, cliquer sur sa ligne
dans la barre, vérifier que l'onglet Agents s'ouvre sur lui, que ses appels d'outils s'y ajoutent au
fil de l'eau et que la position de lecture du chat n'a pas bougé.

**Acceptance Scenarios**:

1. **Given** la barre latérale droite est fermée ou sur un autre onglet, **When** l'utilisateur
   clique sur un sous-agent dans la barre, **Then** la barre latérale droite s'ouvre sur l'onglet
   Agents avec ce sous-agent sélectionné.
2. **Given** un sous-agent sélectionné dans l'onglet Agents, **When** il travaille, **Then** le
   détail montre sa description, son type, l'outil en cours, ses appels d'outils, sa durée et ses
   tokens, mis à jour en direct.
3. **Given** un sous-agent sélectionné, **When** il se termine, **Then** il reste sélectionné, son
   état passe à terminé et son résultat final s'affiche.
4. **Given** l'utilisateur a cliqué sur un sous-agent dans la barre, **When** l'onglet Agents
   s'ouvre, **Then** la position de défilement du chat est inchangée.

---

### User Story 3 - Revoir les sous-agents de la session (Priority: P3)

L'utilisateur ouvre l'onglet Agents directement, sans passer par la barre, pour voir tous les
sous-agents du chat : ceux qui tournent en haut, puis ceux qui ont fini pendant la session, et relire
le résultat de l'un d'eux.

**Why this priority**: utile pour relire un résultat après coup, mais la valeur principale (voir et
suivre ce qui tourne) est couverte par US1 et US2.

**Independent Test**: après une conversation où trois sous-agents ont tourné et fini, ouvrir
l'onglet Agents, vérifier que les trois y figurent comme terminés et que la sélection de l'un
affiche son résultat.

**Acceptance Scenarios**:

1. **Given** un chat dont des sous-agents tournent et d'autres ont fini, **When** l'utilisateur
   ouvre l'onglet Agents, **Then** les sous-agents en cours sont listés en premier, puis les
   terminés.
2. **Given** un chat sans aucun sous-agent, **When** l'utilisateur ouvre l'onglet Agents, **Then**
   l'onglet affiche un message indiquant qu'aucun sous-agent n'a été lancé dans ce chat.
3. **Given** l'onglet Agents ouvert sur un chat, **When** l'utilisateur passe à un autre chat du
   workspace, **Then** l'onglet montre les sous-agents de ce nouveau chat.

---

### Edge Cases

- **Nombreux sous-agents** : au-delà de 3 sous-agents en cours, la barre affiche les 3 premiers et un
  indicateur « +N » ; un clic sur cet indicateur ouvre l'onglet Agents. La barre ne pousse jamais la
  zone de saisie hors de l'écran.
- **Sous-agent en échec ou interrompu** : il quitte la barre comme un sous-agent terminé ; dans
  l'onglet Agents, il apparaît avec un état d'échec ou d'arrêt distinct de « terminé ».
- **L'utilisateur arrête le tour** : les sous-agents dont la fin est connue quittent la barre ; la
  barre ne montre jamais un sous-agent que la carte des agents montre comme fini.
- **Sous-agents imbriqués** (un sous-agent qui lance lui-même des sous-agents) : seuls les
  sous-agents lancés directement par l'agent principal sont listés.
- **Agents d'équipe** : les agents ouverts comme onglets de chat séparés ne sont listés ni dans la
  barre ni dans l'onglet Agents.
- **Sous-agent sélectionné qui disparaît** (chat effacé, retour à un point de contrôle) : l'onglet
  Agents revient à la liste sans sélection.
- **Rechargement de l'app** : l'onglet Agents montre les sous-agents que le chat affiche encore dans
  sa conversation ; ni la barre ni l'onglet n'inventent un état que la carte des agents n'a pas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le système MUST afficher, au-dessus de la zone de saisie d'un chat, une barre listant
  les sous-agents de ce chat qui tournent encore, au premier plan comme en arrière-plan.
- **FR-002**: La barre MUST n'être affichée que tant qu'au moins un sous-agent du chat tourne, et
  disparaître quand le dernier se termine.
- **FR-003**: Chaque ligne de la barre MUST montrer un indicateur animé d'activité, le type du
  sous-agent et sa description.
- **FR-004**: Le système MUST considérer un sous-agent comme « en cours » exactement quand la carte
  des agents du chat le montre en cours ; la barre et la carte ne se contredisent jamais.
- **FR-005**: La barre MUST rester visible quelle que soit la position de défilement de la
  conversation.
- **FR-006**: Au-delà de 3 sous-agents en cours, la barre MUST afficher les 3 premiers et un
  indicateur du nombre restant ; un clic sur cet indicateur ouvre l'onglet Agents.
- **FR-007**: Un clic sur un sous-agent de la barre MUST ouvrir la barre latérale droite sur
  l'onglet Agents, avec ce sous-agent sélectionné, sans changer la position de défilement du chat.
- **FR-008**: La barre latérale droite MUST proposer un onglet « Agents » à côté des onglets Files,
  Changes et Tasks.
- **FR-009**: L'onglet Agents MUST lister les sous-agents du chat sélectionné : ceux en cours en
  premier, puis ceux terminés, en échec ou arrêtés.
- **FR-010**: Pour le sous-agent sélectionné, l'onglet Agents MUST montrer sa description, son type,
  son état, l'outil en cours, ses appels d'outils, sa durée et ses tokens, mis à jour en direct, puis
  son résultat final quand il se termine ; ce contenu est celui de l'entrée du sous-agent dans la
  carte des agents.
- **FR-011**: L'onglet Agents MUST afficher un message d'état vide quand le chat n'a lancé aucun
  sous-agent.
- **FR-012**: La barre et l'onglet Agents MUST ne concerner que le chat sélectionné ; changer de chat
  met les deux à jour.
- **FR-013**: Seuls les sous-agents lancés directement par l'agent principal MUST être listés ; les
  sous-agents imbriqués et les agents d'équipe ouverts comme onglets de chat sont exclus.
- **FR-014**: Les libellés de la barre et de l'onglet Agents MUST être traduits dans toutes les
  langues proposées par le desktop.
- **FR-015**: La barre et l'onglet Agents MUST être accessibles au clavier et aux lecteurs d'écran :
  chaque sous-agent est un élément activable avec un nom lisible (type, description, état), et
  l'indicateur animé respecte la préférence de réduction des animations.
- **FR-016**: La documentation utilisateur MUST décrire la barre et l'onglet Agents, et préciser
  la différence avec l'onglet Tasks.
- **FR-017**: Le panneau Tasks, la carte des agents du chat et l'app télécommande MUST garder leur
  comportement actuel.

### Key Entities

- **Sous-agent d'un chat** : un agent lancé directement par l'agent principal du chat. Attributs :
  type, description, état (en cours, terminé, en échec, arrêté), début et durée, tokens consommés,
  appels d'outils (dont celui en cours), résultat final.
- **Sélection de l'onglet Agents** : le sous-agent affiché en détail, propre au chat ; vide quand
  aucun n'est sélectionné.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Quand un sous-agent démarre ou se termine, la barre reflète le changement en moins de
  2 secondes, dans 100 % des essais du scénario de test de US1.
- **SC-002**: L'utilisateur voit la liste des sous-agents en cours d'un chat sans aucun défilement,
  quelle que soit la longueur de la conversation.
- **SC-003**: L'utilisateur passe de la barre au détail d'un sous-agent en un seul clic.
- **SC-004**: Dans aucun essai la barre ne montre comme en cours un sous-agent que la carte des agents
  montre comme fini, ni l'inverse.
- **SC-005**: Ouvrir le détail d'un sous-agent ne déplace jamais la position de lecture du chat.

## Assumptions

- Desktop uniquement ; l'app télécommande iOS/Android est hors périmètre de cette fonctionnalité.
- Les informations affichées (type, description, état, appels d'outils, durée, tokens, résultat)
  sont celles que le desktop connaît déjà et montre dans la carte des agents ; aucune nouvelle
  source d'information n'est requise.
- L'onglet Agents garde les sous-agents terminés du chat pour permettre de relire un résultat ;
  après un rechargement, il montre ceux que la conversation affiche encore.
- Les libellés de référence sont en anglais (langue de base de l'interface desktop), traduits dans
  les autres langues proposées.
- Le choix d'onglet de la barre latérale droite suit la mémorisation existante par workspace.
- Le seuil de 3 sous-agents visibles dans la barre est un choix par défaut pour garder la zone de
  saisie dégagée.
