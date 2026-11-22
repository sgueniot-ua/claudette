# Feature Specification: Indicateur de chat et de workspace en cours

**Feature Branch**: `sgueniot-ua/chat-in-progress`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "en tant qu'utilisateur je souhaite pouvoir voir quand un chat est en cours (non fini) et donc quand un workspace est en cours (même si c'est avec des sous agents)"

## Clarifications

### Session 2026-11-22

- Q: Quelles tâches font passer un chat dans l'état « sous-agents en cours » : seulement les sous-agents, ou aussi les commandes shell et les Workflows lancés en arrière-plan ? → A: Toutes les tâches de fond (sous-agents, Workflows, commandes shell) ; l'état est renommé « tâches en arrière-plan ».
- Q: Quand l'app télécommande perd la liaison, l'état « inconnu » remplace-t-il aussi « en attente de l'utilisateur » ? → A: Oui, tous les indicateurs passent à « inconnu ».
- Q: Quels libellés affichent les apps, alors que ni le desktop ni la télécommande n'ont d'interface en français ? → A: Les libellés de l'app : « Running », « Background tasks running », « Idle », les libellés existants d'attente (« Question requires attention », « Plan approval needed ») et « Status unknown — disconnected » ; le desktop les traduit dans ses autres langues.
- Q: Que montre la télécommande appairée au serveur autonome (sans interface), qui ne suit pas les tâches de fond ? → A: « en cours », « inactif » et « en attente de l'utilisateur » ; jamais « tâches en arrière-plan ».
- Q: Sur desktop, où l'état d'un chat est-il visible ? → A: Sur l'onglet du chat ; l'écran de chat desktop n'ajoute pas d'indicateur.
- Q: Dans la barre latérale desktop, que montre un workspace dont un tour est terminé et non lu, mais dont une tâche en arrière-plan tourne encore ? → A: « tâches en arrière-plan » ; le badge « terminé, non lu » ne revient qu'à la fin de la dernière tâche en arrière-plan.
- Q: Que montre la télécommande si le desktop ne fournit pas l'état (version plus ancienne, erreur) ? → A: Aucun indicateur : les listes s'affichent comme aujourd'hui ; « inconnu » reste réservé à la perte de liaison.
- Q: Les chats archivés comptent-ils dans l'état d'un workspace ? → A: Non, seuls les chats non archivés des workspaces non archivés comptent.

## Vocabulaire

- **App télécommande** : l'app iOS/Android (`src-mobile`) qui s'appaire avec Claudette desktop et
  pilote ses workspaces et chats à distance, sans exécuter d'agent elle-même.
- **Chat** : une session de conversation avec un agent, rattachée à un workspace.
- **Agent principal** : l'agent qui répond au message de l'utilisateur dans un chat.
- **Tâche en arrière-plan** : un travail lancé en arrière-plan par l'agent principal (sous-agent,
  Workflow ou commande shell, par exemple un serveur de dev), qui peut continuer après la fin de la
  réponse de l'agent principal.
- **États d'activité** d'un chat :
  - **En cours** : l'agent principal travaille (réponse en cours, y compris compaction du contexte).
  - **Tâches en arrière-plan** (anciennement « sous-agents en cours ») : l'agent principal a fini,
    mais au moins une tâche en arrière-plan tourne encore.
  - **Inactif** : ni l'agent principal ni aucune tâche en arrière-plan ne travaille.
- **En attente de l'utilisateur** : état déjà affiché par le desktop quand l'agent attend une
  réponse (question, validation de plan) ; il garde sa priorité actuelle sur les états d'activité.
- **Inconnu** : état affiché par l'app télécommande quand elle a perdu la liaison avec le desktop ;
  il remplace tous les autres états, attente de l'utilisateur comprise.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Voir sur l'app télécommande quels workspaces et quels chats sont en cours (Priority: P1)

Depuis l'app télécommande, l'utilisateur ouvre la liste des workspaces et voit d'un coup d'œil ceux où
un agent travaille encore. Il ouvre un workspace et voit, dans la liste de ses chats, lesquels sont
en cours. Aujourd'hui l'app télécommande n'affiche aucune de ces informations : l'utilisateur doit ouvrir
chaque chat pour deviner s'il est fini.

**Why this priority**: c'est le manque le plus visible. Avec l'app télécommande, l'utilisateur suit ses agents à
distance et n'a aucun moyen de savoir lesquels ont fini.

**Independent Test**: lancer un message dans un chat depuis le desktop ou l'app télécommande, puis ouvrir la
liste des workspaces et la liste des chats sur l'app télécommande : le workspace et le chat apparaissent
« en cours », puis « inactif » une fois la réponse terminée.

**Acceptance Scenarios**:

1. **Given** un chat dont l'agent principal répond, **When** l'utilisateur affiche la liste des
   chats de son workspace sur l'app télécommande, **Then** ce chat porte l'indicateur « en cours ».
2. **Given** ce même chat, **When** l'utilisateur affiche la liste des workspaces sur l'app télécommande,
   **Then** le workspace porte l'indicateur « en cours ».
3. **Given** un chat affiché « en cours » sur l'app télécommande, **When** l'agent principal termine sa
   réponse et qu'aucune tâche en arrière-plan ne tourne, **Then** le chat et son workspace passent à
   « inactif » sans action de l'utilisateur.
4. **Given** un chat inactif, **When** un message y est envoyé (depuis l'app télécommande ou le desktop),
   **Then** le chat et son workspace passent à « en cours » sans action de l'utilisateur.

---

### User Story 2 - Distinguer « tâches en arrière-plan » de « en cours » (Priority: P2)

Quand l'agent principal a fini de répondre mais que des tâches en arrière-plan (sous-agents,
Workflows, commandes shell) tournent encore, l'utilisateur voit que le chat (et donc son workspace) n'est pas fini, avec un
indicateur distinct de « en cours ». Aujourd'hui, sur desktop, ce cas s'affiche comme un chat
inactif ; sur l'app télécommande, rien n'est affiché.

**Why this priority**: sans cet état, l'utilisateur croit le travail fini alors que des tâches en
arrière-plan modifient encore le workspace.

**Independent Test**: dans un chat, demander une tâche qui lance un sous-agent en arrière-plan ;
quand l'agent principal a répondu, le chat et le workspace affichent « tâches en arrière-plan » sur
desktop et sur l'app télécommande, jusqu'à la fin de la dernière tâche en arrière-plan.

**Acceptance Scenarios**:

1. **Given** un chat dont l'agent principal a fini et dont une tâche en arrière-plan tourne encore,
   **When** l'utilisateur regarde ce chat (onglet du chat sur desktop, liste des chats ou écran de
   chat sur la télécommande) ou son workspace, **Then** il voit l'indicateur « tâches en
   arrière-plan », visuellement distinct de « en cours » et de « inactif ».
2. **Given** un chat « tâches en arrière-plan », **When** la dernière tâche en arrière-plan se
   termine (succès, échec ou arrêt), **Then** le chat passe à « inactif ».
3. **Given** un chat « tâches en arrière-plan », **When** l'utilisateur envoie un nouveau message,
   **Then** le chat passe à « en cours » tant que l'agent principal répond, puis revient à
   « tâches en arrière-plan » si des tâches en arrière-plan tournent encore.
4. **Given** une commande shell longue lancée en arrière-plan (par exemple un serveur de dev),
   **When** l'agent principal a fini, **Then** le chat reste « tâches en arrière-plan » tant que la
   commande tourne.

---

### User Story 3 - Voir l'état du chat ouvert sur l'app télécommande (Priority: P3)

Dans l'écran d'un chat sur l'app télécommande, l'utilisateur voit si ce chat est en cours, avec des
tâches en arrière-plan, en attente de l'utilisateur ou inactif, y compris quand le travail a été lancé depuis un autre appareil.

**Why this priority**: l'écran de chat montre déjà le texte qui arrive ; l'état explicite y est
utile surtout pour le cas des tâches en arrière-plan et pour un chat ouvert en cours de route.

**Independent Test**: ouvrir sur l'app télécommande un chat dont un message a été lancé depuis le desktop :
l'écran affiche « en cours », puis l'état suivant à la fin de la réponse.

**Acceptance Scenarios**:

1. **Given** un chat en cours lancé depuis le desktop, **When** l'utilisateur l'ouvre sur l'app télécommande,
   **Then** l'écran affiche l'état « en cours » dès l'ouverture.
2. **Given** l'écran d'un chat ouvert sur l'app télécommande, **When** l'état du chat change, **Then** l'état
   affiché change sans action de l'utilisateur.

---

### Edge Cases

- Plusieurs chats dans un workspace : le workspace prend l'état le plus actif de ses chats
  (« en cours » > « tâches en arrière-plan » > « inactif »).
- Un chat attend une réponse de l'utilisateur (question de l'agent, validation de plan) : il
  affiche « en attente de l'utilisateur », sur desktop comme sur l'app télécommande, avec la
  priorité actuelle du desktop sur les états d'activité.
- L'agent principal s'arrête sur une erreur ou est interrompu par l'utilisateur : le chat quitte
  « en cours » (vers « tâches en arrière-plan » s'il en reste, sinon « inactif »).
- L'app télécommande perd la liaison avec le desktop (Wi-Fi coupé, veille du téléphone) : tous
  ses indicateurs passent à « inconnu », attente de l'utilisateur comprise, jusqu'à la reconnexion.
- L'app télécommande se reconnecte, ou l'app télécommande est rouverte, pendant qu'un chat travaille : l'état
  affiché est l'état réel au moment de la reconnexion, pas un état mémorisé.
- Un sous-agent lancé au premier plan (l'agent principal attend sa fin) : le chat est « en cours ».
- Un workspace a un tour terminé non lu et une tâche en arrière-plan encore active : la barre
  latérale desktop affiche « tâches en arrière-plan » ; le badge « terminé, non lu » réapparaît à
  la fin de la dernière tâche en arrière-plan.
- Le desktop ne fournit pas l'état (version plus ancienne, erreur) : la télécommande n'affiche
  aucun indicateur d'activité, ses listes restent comme aujourd'hui.
- Télécommande appairée au serveur autonome (sans interface) : celui-ci ne suit pas les tâches en
  arrière-plan ; la télécommande n'affiche alors que « en cours », « en attente de l'utilisateur »
  et « inactif ».

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le système MUST déterminer pour chaque chat l'un des trois états d'activité :
  « en cours », « tâches en arrière-plan », « inactif », selon les définitions du vocabulaire.
- **FR-002**: Le système MUST déterminer pour chaque workspace l'état le plus actif de ses chats,
  dans l'ordre « en cours » > « tâches en arrière-plan » > « inactif ».
- **FR-003**: L'app télécommande MUST afficher l'état d'activité de chaque workspace dans la liste des
  workspaces.
- **FR-004**: L'app télécommande MUST afficher l'état d'activité de chaque chat dans la liste des chats
  d'un workspace.
- **FR-005**: L'app télécommande MUST afficher l'état d'activité du chat ouvert dans l'écran de chat.
- **FR-006**: L'app desktop MUST afficher l'état « tâches en arrière-plan » pour les chats (onglets
  de chat ; l'écran de chat desktop n'ajoute pas d'indicateur) et les workspaces (barre latérale et autres listes qui montrent déjà « en cours »), là où
  elle l'affiche aujourd'hui comme inactif.
- **FR-007**: Les états « en cours », « tâches en arrière-plan » et « inactif » MUST être
  visuellement distincts entre eux, sur desktop comme sur l'app télécommande.
- **FR-008**: Chaque changement d'état MUST apparaître sur toutes les surfaces concernées sans
  action de l'utilisateur (pas de rafraîchissement manuel).
- **FR-009**: À l'ouverture de l'app télécommande, d'une liste ou d'un chat, l'état affiché MUST être
  l'état réel courant, y compris pour un travail lancé depuis un autre appareil.
- **FR-010**: Chaque état affiché MUST avoir un libellé textuel lu par les lecteurs d'écran, et
  ne MUST pas reposer sur la seule couleur. Libellés (anglais, traduits dans les autres langues
  du desktop) : « Running », « Background tasks running », « Idle », les libellés d'attente
  existants (« Question requires attention », « Plan approval needed ») et, sur la télécommande,
  « Status unknown — disconnected ».
- **FR-011**: Le comportement actuel du desktop pour « en cours », « en attente de l'utilisateur »
  et le badge « terminé, non lu » MUST être conservé, à une exception près : tant qu'une tâche en
  arrière-plan tourne dans un workspace, « tâches en arrière-plan » s'affiche à la place du badge
  « terminé, non lu », qui revient à la fin de la dernière tâche.
- **FR-012**: L'app télécommande MUST afficher l'état « en attente de l'utilisateur » sur les
  chats et workspaces concernés, avec la même priorité que sur desktop.
- **FR-013**: Quand l'app télécommande perd la liaison avec le desktop, elle MUST afficher l'état
  « inconnu » à la place de tous les autres états, « en attente de l'utilisateur » compris,
  jusqu'à la reconnexion (FR-009). Si la liaison fonctionne mais que le desktop ne fournit pas
  l'état, la télécommande n'affiche aucun indicateur d'activité.

### Key Entities

- **État d'activité d'un chat** : en cours / tâches en arrière-plan / inactif ; dépend de
  l'activité de l'agent principal et des tâches en arrière-plan du chat.
- **État d'activité d'un workspace** : agrégat des états de ses chats non archivés (FR-002).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sur l'app télécommande, l'utilisateur identifie les workspaces où un agent travaille depuis la
  seule liste des workspaces, sans ouvrir de chat.
- **SC-002**: Un changement d'état (début, fin de l'agent principal, fin de la dernière tâche en
  arrière-plan)
  apparaît sur desktop et sur l'app télécommande en moins de 2 secondes, connexion établie.
- **SC-003**: Dans 100 % des cas de test où une tâche en arrière-plan tourne encore après la fin
  de l'agent principal, le chat et le workspace affichent « tâches en arrière-plan » et non
  « inactif » (hors serveur autonome).
- **SC-004**: Aucune régression des indicateurs existants du desktop (spinner « en cours »,
  « en attente de l'utilisateur », badge « terminé, non lu » hors exception de FR-011).

## Assumptions

- Seuls les workspaces et les chats non archivés sont concernés.
- L'app télécommande affiche les workspaces et chats d'une machine appairée ; l'état vient de cette machine.
- La compaction du contexte compte comme « en cours », comme sur desktop aujourd'hui.
- Le visuel des indicateurs suit les composants existants de chaque app. « Tâches en
  arrière-plan » reprend l'anneau de « en cours », plus lent, dans la couleur d'un nouveau token
  de design dédié ; aucun Figma n'est fourni pour ce changement.
- L'arrêt d'une tâche en arrière-plan depuis l'indicateur est hors périmètre.
- Hors périmètre : déplier un workspace dans la barre latérale desktop pour voir chacun de ses
  chats et leur état (fera l'objet d'une spec séparée).
