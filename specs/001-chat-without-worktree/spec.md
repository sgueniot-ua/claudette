# Feature Specification: Chats de projet sans worktree

**Feature Branch**: `sgueniot-ua/feat-multi-chat-no-worktree`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "je veux pouvoir lancer un ou plusieurs chat sur un projet, sans worktree associé"

## Clarifications

### Session 2026-11-20

- Q: Droits de l'agent dans un chat de projet ? → A: les mêmes que dans un workspace avec worktree.
- Q: Où apparaissent les chats de projet ? → A: uniquement dans la vue du projet, pas dans la sidebar.
- Q: Restauration d'un checkpoint dans un chat de projet ? → A: permise après confirmation explicite.
- Q: « Effacer la conversation en restaurant les fichiers » et « forker depuis un checkpoint » dans un
  chat de projet ? → A: disponibles comme dans un workspace ; toute restauration de fichiers demande
  une confirmation explicite (dossier partagé).
- Q: Restauration de fichiers pendant qu'un autre chat du même projet travaille ? → A: autorisée
  après un avertissement renforcé signalant les autres chats en cours.
- Q: Effet de « effacer la conversation en restaurant les fichiers » dans un chat de projet ? → A:
  le dossier revient à son état au début de cette conversation (avant le premier message du chat) ;
  aucun commit n'est retiré, rien n'est réinitialisé vers la branche par défaut.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lancer un chat directement sur un projet (Priority: P1)

L'utilisateur a un projet (dépôt) ajouté dans Claudette. Il veut poser une question à un agent ou lui
confier une petite tâche sur ce projet sans créer d'espace de travail isolé (pas de nouvelle branche,
pas de copie du dépôt sur disque, pas de script de setup). Depuis le projet, il lance un chat ;
l'agent travaille dans le dossier du projet tel qu'il est sur le disque.

**Why this priority**: c'est le cœur de la demande. Aujourd'hui, tout chat impose la création d'un
workspace avec sa worktree, ce qui est lourd pour une question rapide, une revue, ou une tâche sur la
branche déjà extraite du projet.

**Independent Test**: sur un projet ajouté, lancer un chat de projet, demander à l'agent le chemin de
son dossier de travail et la branche courante : il répond avec le dossier du projet et la branche
extraite, et aucune nouvelle worktree ni branche n'a été créée.

**Acceptance Scenarios**:

1. **Given** un projet ajouté dans Claudette, **When** l'utilisateur lance un chat de projet, **Then**
   un chat s'ouvre en moins de 2 secondes, sans création de worktree, de branche ni exécution du script
   de setup du projet.
2. **Given** un chat de projet ouvert, **When** l'utilisateur envoie un message, **Then** l'agent
   s'exécute avec le dossier du projet comme dossier de travail.
3. **Given** un chat de projet, **When** l'utilisateur rouvre Claudette, **Then** le chat et son
   historique sont toujours présents sous le projet.
4. **Given** un chat de projet, **When** l'agent lit, modifie ou commit des fichiers, **Then** il le
   fait dans le dossier du projet, avec les mêmes droits et les mêmes règles de permission que dans un
   workspace avec worktree.

---

### User Story 2 - Plusieurs chats en parallèle sur le même projet (Priority: P2)

L'utilisateur lance plusieurs chats de projet sur le même projet, par exemple un pour explorer le code
et un autre pour préparer une note de version, et les suit en parallèle.

**Why this priority**: la demande porte explicitement sur « un ou plusieurs » chats ; sans cela, la
fonctionnalité serait limitée à une seule conversation par projet.

**Independent Test**: lancer deux chats de projet sur le même projet, envoyer un message dans chacun ;
les deux agents tournent en même temps et chaque chat garde son propre historique.

**Acceptance Scenarios**:

1. **Given** un chat de projet existant, **When** l'utilisateur lance un second chat de projet sur le
   même projet, **Then** les deux chats coexistent, chacun avec son historique.
2. **Given** deux chats de projet actifs sur le même projet, **When** les deux agents travaillent en
   même temps, **Then** chacun affiche son propre statut (en cours, inactif, attend une réponse).
3. **Given** plusieurs chats de projet, **When** l'utilisateur en lance un nouveau, **Then** Claudette
   lui indique que tous les chats de ce projet partagent le même dossier, sans isolation entre eux.

---

### User Story 3 - Retrouver et gérer ses chats de projet (Priority: P3)

L'utilisateur retrouve ses chats de projet dans la navigation, les renomme, et archive ceux dont il
n'a plus besoin, sans que cela touche au dossier du projet.

**Why this priority**: indispensable dès qu'on en a plusieurs, mais la valeur première est déjà
livrée par les stories 1 et 2.

**Independent Test**: créer deux chats de projet, en renommer un, archiver l'autre ; le dossier du
projet, ses fichiers et ses branches sont inchangés.

**Acceptance Scenarios**:

1. **Given** des chats de projet, **When** l'utilisateur ouvre la vue du projet (clic sur l'en-tête
   du projet dans la sidebar), **Then** ses chats de projet actifs y sont listés et ouvrables ; ils
   n'apparaissent pas comme lignes dans la sidebar.
2. **Given** un chat de projet, **When** l'utilisateur l'archive, **Then** le chat disparaît de la
   liste active, aucun fichier, branche ni worktree n'est supprimé, et le script d'archivage du projet
   n'est pas exécuté.
3. **Given** un chat de projet, **When** l'utilisateur le renomme, **Then** seul son nom affiché
   change ; aucune branche n'est renommée.

---

### Edge Cases

- Le dossier du projet a été déplacé ou supprimé : le lancement ou l'envoi d'un message échoue avec un
  message explicite, l'historique du chat reste consultable.
- Le projet est retiré de Claudette : ses chats de projet sont retirés avec lui, le dossier du projet
  sur disque n'est pas touché.
- L'utilisateur change de branche dans le dossier du projet pendant qu'un chat est ouvert : le chat
  continue sur la branche désormais extraite, sans erreur.
- Restauration d'un point de contrôle (checkpoint) dans un chat de projet, alors que le dossier est
  partagé avec l'utilisateur et les autres chats : la restauration est permise après une confirmation
  explicite avertissant que le dossier partagé du projet sera modifié ; sans confirmation, rien n'est
  restauré.
- Restauration de fichiers (checkpoint ou effacement de la conversation) pendant qu'un autre chat du
  même projet travaille : la confirmation signale en plus que d'autres chats du projet sont en cours
  et peuvent être perturbés ; l'utilisateur peut alors confirmer ou annuler.
- « Effacer la conversation en restaurant les fichiers » dans un chat de projet : le dossier revient à
  son état d'avant le premier message de ce chat ; les modifications faites depuis, y compris par
  l'utilisateur ou d'autres chats, sont annulées après confirmation.
- Fork depuis un checkpoint d'un chat de projet : crée un workspace classique, avec sa worktree et sa
  branche, comme le fork depuis un workspace.
- Une tâche planifiée (routine, réveil) cible un chat de projet : elle s'exécute dans le dossier du
  projet, sans être désactivée faute de worktree.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Les utilisateurs DOIVENT pouvoir lancer un chat sur un projet ajouté, depuis la vue du
  projet, sans créer de worktree ni de branche.
- **FR-002**: Le système DOIT exécuter l'agent d'un chat de projet avec le dossier du projet comme
  dossier de travail.
- **FR-003**: Le système NE DOIT PAS exécuter le script de setup ni le script d'archivage du projet
  pour un chat de projet.
- **FR-004**: Les utilisateurs DOIVENT pouvoir avoir plusieurs chats de projet actifs en même temps sur
  un même projet, chacun avec son historique et son statut propres.
- **FR-005**: Le système DOIT indiquer à l'utilisateur, à la création d'un chat de projet, que ce chat
  travaille dans le dossier du projet sans isolation vis-à-vis des autres chats de projet.
- **FR-006**: Le système DOIT conserver les chats de projet et leur historique entre deux lancements de
  Claudette.
- **FR-007**: Les utilisateurs DOIVENT pouvoir renommer et archiver un chat de projet sans effet sur
  les fichiers, branches ou worktrees du projet.
- **FR-008**: Le système DOIT distinguer visuellement un chat de projet d'un workspace avec worktree.
- **FR-009**: L'agent d'un chat de projet DOIT avoir les mêmes droits et règles de permission sur les
  fichiers que l'agent d'un workspace avec worktree.
- **FR-013**: Les chats de projet DOIVENT être listés et lancés depuis la vue du projet ; ils NE
  DOIVENT PAS apparaître comme lignes dans la sidebar.
- **FR-014**: La restauration d'un point de contrôle dans un chat de projet DOIT demander une
  confirmation explicite mentionnant que le dossier partagé du projet sera modifié ; un refus
  n'effectue aucune restauration.
- **FR-015**: « Effacer la conversation en restaurant les fichiers » DOIT rester disponible dans un
  chat de projet, après une confirmation explicite mentionnant que le dossier partagé du projet sera
  modifié. Il DOIT ramener les fichiers du dossier à leur état au début de cette conversation (avant
  son premier message), sans retirer de commit ni revenir à la branche par défaut. Un chat qui n'a
  encore reçu aucun message ne propose pas de restauration.
- **FR-016**: Le fork depuis un checkpoint d'un chat de projet DOIT rester disponible et créer un
  workspace avec worktree, comme depuis un workspace.
- **FR-017**: Quand une restauration de fichiers est demandée dans un chat de projet alors qu'un autre
  chat du même projet travaille, la confirmation DOIT le signaler explicitement ; la restauration
  n'a lieu qu'après confirmation.
- **FR-010**: Les chats de projet DOIVENT offrir les mêmes capacités de conversation que les chats de
  workspace (choix du modèle, mode plan, questions de l'agent, pièces jointes, terminal dans le
  dossier du projet).
- **FR-011**: Les tâches planifiées ciblant un chat de projet DOIVENT s'exécuter normalement et ne pas
  être désactivées pour cause d'absence de worktree.
- **FR-012**: La création, le renommage et l'archivage d'un workspace avec worktree DOIVENT garder leur
  comportement actuel.

### Key Entities

- **Projet** : un dépôt git ajouté dans Claudette, avec son dossier sur disque et sa branche extraite.
- **Chat de projet** : une conversation avec un agent, rattachée directement à un projet, qui
  travaille dans le dossier du projet. Attributs : nom, statut (actif, archivé), statut de l'agent,
  historique, date de création. Un projet a zéro, un ou plusieurs chats de projet.
- **Workspace** (existant) : espace de travail avec sa propre worktree et sa branche, inchangé.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un utilisateur lance un chat de projet et envoie son premier message en moins de
  10 secondes, sans étape de création d'espace de travail.
- **SC-002**: Le lancement d'un chat de projet ne crée aucun dossier ni aucune branche (0 nouvelle
  worktree, 0 nouvelle branche).
- **SC-003**: Au moins 3 chats de projet tournent en même temps sur un même projet, chacun avec un
  historique distinct.
- **SC-004**: Après redémarrage de Claudette, 100 % des chats de projet non archivés et leur
  historique sont retrouvés.
- **SC-005**: Aucun parcours existant de workspace avec worktree (création, chat, archivage,
  suppression) ne change de comportement.

## Assumptions

- Le dossier de travail d'un chat de projet est le dossier du dépôt ajouté dans Claudette (son
  checkout principal), sur la branche qui y est extraite au moment de chaque message.
- Plusieurs chats de projet partagent ce dossier : leurs modifications éventuelles peuvent se mélanger.
  Claudette prévient, mais n'empêche pas.
- Le diff d'un chat de projet montre les modifications non commitées du dossier du projet, pas un
  écart avec une branche de base.
- Les variables d'environnement, fournisseurs d'environnement (direnv, mise, dotenv, nix) et réglages
  par dépôt s'appliquent au dossier du projet comme à un workspace.
- Les clients distants (application mobile, machines appairées) et la CLI voient et pilotent les chats
  de projet comme les chats de workspace ; leur création depuis l'application mobile est hors
  périmètre de cette version.
- Les workspaces distants (sur une machine appairée) sont hors périmètre : la fonctionnalité concerne
  les projets locaux.
