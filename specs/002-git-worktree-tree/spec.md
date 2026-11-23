# Feature Specification: Arbre git avec les worktrees de chaque branche

**Feature Branch**: `002-git-worktree-tree`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "en tant que utilisateur je voudrais voir mon arbre git avec les worktree associé a chaque branche"

## Clarifications

### Session 2026-11-22

- Q: Où l'utilisateur ouvre-t-il l'arbre git d'un dépôt dans l'application desktop ? → A: Un onglet « Arbre git » dans le panneau latéral droit, à côté des onglets existants, pour le dépôt de l'espace de travail sélectionné.
- Q: Que se passe-t-il quand l'utilisateur clique sur un commit dans l'arbre ? → A: Un détail du commit s'affiche : message complet, auteur, date, identifiant complet copiable, branches et worktrees qui le contiennent, et liste des fichiers modifiés avec accès à leur diff.
- Q: L'arbre doit-il afficher, pour chaque branche, combien de commits elle a d'avance et de retard sur la branche principale ? → A: Oui, à côté de l'étiquette de chaque branche locale.
- Q: Comment montrer une branche ou un worktree dont le commit de tête est plus ancien que les commits chargés ? → A: Une liste complète de toutes les branches et de tous les worktrees, en tête de vue, indépendante des commits chargés ; un clic charge l'historique jusqu'à ce commit et le montre.
- Q: Que montrer quand la branche principale est une branche distante (origin/main) alors que les branches distantes sont masquées ? → A: La branche de base de Claudette est toujours affichée et marquée comme principale, même distante ; les compteurs d'avance et de retard se calculent par rapport à elle.
- Q: Pour un commit de fusion, quels fichiers modifiés et quel diff montrer ? → A: Ceux calculés par rapport au premier parent (ce que la fusion a apporté à la branche qui l'a reçue).
- Q: Que faire quand l'utilisateur clique dans la liste sur une branche dont le commit de tête est à plus de 10 000 commits dans l'historique ? → A: La vue charge au plus 10 000 commits ; au-delà, elle affiche « Ce commit est trop ancien pour être affiché dans l'arbre » avec son identifiant copiable.
- Q: L'arbre doit-il montrer les commits pointés par un worktree en HEAD détachée qu'aucune branche n'atteint ? → A: Oui : les commits affichés sont ceux atteignables depuis les branches affichées, la branche principale et les HEAD de tous les worktrees.
- Q: En combien de temps au plus la marque « modifications non commitées » d'un worktree doit-elle apparaître après une modification ? → A: 10 secondes, vue ouverte.
- Q: Le bouton « Charger plus » doit-il lui aussi s'arrêter à 10 000 commits ? → A: Oui : à 10 000 commits chargés, le bouton disparaît et un message « Limite de l'arbre atteinte (10 000 commits) » le remplace.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Voir l'arbre des branches et leurs worktrees (Priority: P1)

Un utilisateur qui fait travailler plusieurs agents en parallèle sur un même dépôt veut une vue d'ensemble : l'historique des commits sous forme d'arbre (branches qui divergent et se rejoignent), et, à côté de chaque branche, le worktree où elle est actuellement extraite. Il sait d'un coup d'œil quelle branche vit dans quel espace de travail, où en est chacune par rapport à la branche principale, et quelles branches n'ont aucun worktree.

**Why this priority**: c'est la demande elle-même. Sans cette vue, l'utilisateur doit croiser à la main la liste des espaces de travail et l'historique git.

**Independent Test**: ouvrir la vue sur un dépôt qui a au moins trois branches, dont deux extraites dans des worktrees distincts ; vérifier que l'arbre affiche les trois branches et que les deux worktrees sont rattachés à la bonne branche.

**Acceptance Scenarios**:

1. **Given** un dépôt avec une branche principale et deux branches extraites chacune dans un worktree, **When** l'utilisateur ouvre l'arbre git du dépôt, **Then** il voit l'historique des commits en arbre, chaque branche étiquetée à son commit de tête, et le nom de chaque worktree affiché à côté de sa branche.
2. **Given** une branche locale extraite dans aucun worktree, **When** l'utilisateur consulte l'arbre, **Then** la branche apparaît avec son étiquette, sans marque de worktree.
3. **Given** un worktree en HEAD détachée (sans branche), **When** l'utilisateur consulte l'arbre, **Then** ce worktree est affiché sur le commit qu'il pointe, signalé comme « détaché ».
4. **Given** une branche locale qui a 3 commits absents de la branche principale et à qui manquent 2 commits de celle-ci, **When** l'utilisateur consulte l'arbre, **Then** son étiquette indique 3 commits d'avance et 2 de retard.
5. **Given** plusieurs worktrees ou branches qui pointent le même commit, **When** l'utilisateur consulte l'arbre, **Then** toutes les étiquettes de ce commit restent lisibles, sans se recouvrir.
6. **Given** une branche dont le commit de tête est plus ancien que les commits chargés, **When** l'utilisateur clique sur cette branche dans la liste en tête de vue, **Then** l'historique se charge jusqu'à ce commit et l'arbre le montre.
7. **Given** la branche principale du dépôt est origin/main et les branches distantes sont masquées, **When** l'utilisateur consulte l'arbre, **Then** origin/main est affichée et marquée comme principale, et les compteurs des branches locales se calculent par rapport à elle.

---

### User Story 2 - Rejoindre un espace de travail depuis l'arbre (Priority: P2)

Depuis l'arbre, l'utilisateur repère la branche qui l'intéresse et veut aller directement à l'espace de travail Claudette qui la porte.

**Why this priority**: transforme la vue en outil de navigation ; utile, mais la vue a déjà de la valeur sans cela.

**Independent Test**: dans l'arbre, activer la marque de worktree d'une branche portée par un espace de travail Claudette ; vérifier que cet espace de travail devient l'espace sélectionné.

**Acceptance Scenarios**:

1. **Given** une branche extraite dans un worktree géré par Claudette, **When** l'utilisateur active la marque de ce worktree, **Then** l'espace de travail correspondant s'ouvre.
2. **Given** une branche extraite dans un worktree créé hors de Claudette, **When** l'utilisateur consulte sa marque, **Then** la marque indique que ce worktree n'est pas un espace de travail Claudette et donne son chemin sur le disque ; aucune navigation n'est proposée.
3. **Given** l'arbre affiché, **When** l'utilisateur clique sur un commit, **Then** le détail du commit s'affiche : message complet, auteur, date, identifiant complet copiable, branches et worktrees qui le contiennent, et liste des fichiers modifiés.
4. **Given** le détail d'un commit ouvert, **When** l'utilisateur choisit un fichier modifié, **Then** le diff de ce fichier pour ce commit s'affiche.

---

### User Story 3 - Lire l'état de chaque worktree (Priority: P3)

L'utilisateur veut savoir, sans ouvrir chaque espace de travail, si un worktree a des modifications non commitées.

**Why this priority**: confort ; l'information existe déjà ailleurs dans l'application.

**Independent Test**: modifier un fichier dans un worktree sans commiter ; vérifier que sa marque dans l'arbre le signale.

**Acceptance Scenarios**:

1. **Given** un worktree avec des modifications non commitées, **When** l'utilisateur consulte l'arbre, **Then** la marque du worktree le signale.
2. **Given** un worktree propre, **When** l'utilisateur consulte l'arbre, **Then** sa marque ne porte aucun signal de modification.

---

### Edge Cases

- Dépôt avec un très long historique (des dizaines de milliers de commits) : seuls les commits récents s'affichent d'abord ; l'utilisateur peut en charger davantage jusqu'à 10 000 commits, puis la vue indique que la limite de l'arbre est atteinte.
- Branche ou worktree dont le commit de tête est plus ancien que les commits chargés : présent dans la liste en tête de vue ; un clic charge l'historique jusqu'à lui.
- Commit de tête à plus de 10 000 commits dans l'historique : la vue ne charge pas davantage et affiche « Ce commit est trop ancien pour être affiché dans l'arbre », avec l'identifiant copiable.
- Commit de fusion : sa liste de fichiers modifiés n'est pas vide quand la branche fusionnée a apporté des changements.
- Worktree dont le dossier a été supprimé du disque (worktree « orphelin ») : affiché comme introuvable, sans faire échouer la vue.
- Branche principale extraite dans le dépôt lui-même (worktree principal) : rattachée comme les autres, identifiée comme dépôt principal.
- Dépôt sans aucun worktree lié : l'arbre s'affiche normalement, seule la marque du dépôt principal apparaît.
- Dépôt vide (aucun commit) : message explicite plutôt qu'un arbre vide.
- Un agent commite ou crée une branche pendant que la vue est ouverte : la vue reflète le changement sans redémarrer l'application.
- Lecture de l'historique impossible (dépôt corrompu, git indisponible) : message d'erreur compréhensible, le reste de l'application reste utilisable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le système DOIT proposer, dans un onglet « Arbre git » du panneau latéral droit, une vue qui affiche, pour le dépôt de l'espace de travail sélectionné, l'historique des commits sous forme d'arbre (lignes de branches, divergences, fusions).
- **FR-002**: Chaque commit affiché DOIT montrer au minimum son message résumé, son auteur, sa date et son identifiant court.
- **FR-003**: Chaque branche locale DOIT être étiquetée sur son commit de tête.
- **FR-004**: Chaque worktree du dépôt (dépôt principal compris) DOIT être rattaché à la branche qu'il a extraite, ou à son commit s'il est en HEAD détachée, et identifiable par son nom d'espace de travail ou, à défaut, par son dossier.
- **FR-005**: Le système DOIT distinguer visuellement les worktrees gérés par Claudette des worktrees créés hors de Claudette.
- **FR-006**: Une branche sans worktree DOIT rester visible et se distinguer d'une branche extraite.
- **FR-007**: Le système DOIT toujours afficher la branche principale du dépôt (la branche de base que Claudette utilise pour ce dépôt) et la marquer comme principale, même si c'est une branche distante et même quand les autres branches distantes sont masquées.
- **FR-008**: L'utilisateur DOIT pouvoir ouvrir l'espace de travail Claudette associé à un worktree depuis l'arbre.
- **FR-009**: Le système DOIT signaler les worktrees ayant des modifications non commitées.
- **FR-010**: Le système DOIT signaler les worktrees en HEAD détachée et les worktrees dont le dossier est introuvable.
- **FR-011**: Le système DOIT afficher d'abord une portion récente de l'historique et permettre d'en charger davantage à la demande, jusqu'à 10 000 commits chargés au plus ; à cette limite, le bouton de chargement DOIT disparaître au profit du message « Limite de l'arbre atteinte (10 000 commits) ». Une liste complète de toutes les branches affichées et de tous les worktrees DOIT figurer en tête de vue, indépendamment des commits chargés ; un clic sur une entrée DOIT charger l'historique jusqu'à son commit et montrer ce commit dans l'arbre, dans la limite de 10 000 commits chargés ; au-delà, la vue DOIT indiquer que le commit est trop ancien pour être affiché dans l'arbre et proposer son identifiant complet à copier.
- **FR-012**: La vue DOIT se mettre à jour quand des commits, des branches ou des worktrees changent dans le dépôt pendant qu'elle est ouverte.
- **FR-013**: La vue est en lecture seule : elle ne DOIT déclencher aucune opération git qui modifie le dépôt.
- **FR-014**: Le système DOIT afficher par défaut les branches locales seulement ; la branche principale fait exception (FR-007) ; l'utilisateur DOIT pouvoir activer, depuis la vue, l'affichage des branches distantes, qui se distinguent alors visuellement des branches locales.
- **FR-015**: La vue DOIT être disponible dans l'application desktop, y compris pour un dépôt d'une machine appairée à distance. L'application mobile est hors périmètre.
- **FR-016**: Un clic sur un commit DOIT afficher son détail : message complet, auteur, date, identifiant complet copiable, branches et worktrees qui le contiennent, et liste des fichiers modifiés ; l'utilisateur DOIT pouvoir afficher le diff de chacun de ces fichiers pour ce commit. Pour un commit de fusion, les fichiers modifiés et leurs diffs DOIVENT être calculés par rapport au premier parent.
- **FR-017**: Chaque branche locale autre que la branche principale DOIT afficher, à côté de son étiquette, son nombre de commits d'avance et de retard sur la branche principale (FR-007).

### Key Entities

- **Dépôt** : un projet git suivi par Claudette ; possède un historique, des branches et des worktrees.
- **Commit** : un point de l'historique ; message, auteur, date, identifiant, un ou plusieurs parents.
- **Branche** : un nom pointant un commit de tête ; peut être extraite dans zéro ou un worktree.
- **Worktree** : un dossier de travail du dépôt ; extrait une branche ou un commit détaché ; peut correspondre à un espace de travail Claudette ; a un état (propre, modifié, introuvable).
- **Espace de travail Claudette** : l'espace de l'application associé à un worktree, vers lequel l'utilisateur peut naviguer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sur un dépôt de 10 branches et 5 worktrees, l'utilisateur identifie le worktree d'une branche donnée en moins de 5 secondes.
- **SC-002**: La vue s'affiche en moins de 2 secondes pour un dépôt de 50 000 commits.
- **SC-003**: 100 % des worktrees listés par git pour le dépôt apparaissent dans la vue, rattachés à la bonne branche ou au bon commit.
- **SC-004**: Un nouveau commit ou une nouvelle branche créés par un agent apparaissent dans la vue ouverte en moins de 5 secondes.
- **SC-005**: L'utilisateur atteint l'espace de travail d'une branche en une seule action depuis l'arbre.
- **SC-006**: Une modification non commitée dans un worktree est signalée dans la vue ouverte en moins de 10 secondes ; la marque disparaît dans le même délai quand le worktree redevient propre.

## Assumptions

- La vue porte sur un dépôt à la fois : celui de l'espace de travail sélectionné ; changer d'espace de travail vers un autre dépôt change l'arbre affiché.
- La branche principale est la branche de base que Claudette utilise déjà pour ce dépôt (réglage du dépôt, sinon la branche par défaut du dépôt distant, souvent origin/main).
- Premier chargement : les 200 commits les plus récents, puis chargement par tranches de 200 à la demande, jusqu'à 10 000 commits.
- Les opérations git (checkout, fusion, création de branche, suppression de worktree) sont hors périmètre.
- Les commits affichés sont ceux atteignables depuis les branches affichées (distantes comprises quand elles sont activées), la branche principale et les HEAD de tous les worktrees, y compris détachés.
- Un worktree est associé à un espace de travail Claudette quand son dossier correspond à celui d'un espace de travail connu de l'application.
- Le choix d'afficher ou non les branches distantes n'a pas besoin d'être conservé après la fermeture de l'application.
