# Feature Specification: Volet ADB lié au workspace

**Feature Branch**: `sgueniot-ua/worktree-adb-panel`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "permettre d'afficher adb dans un volet comme pour le terminal. le adb en relation avec le worktree en cours de visualisation"

## Clarifications

### Session 2026-11-21

- Q: Que montre le volet ADB ? → A: les logs de l'appareil (logcat), en lecture seule ; actions
  sur l'appareil (installer l'APK, lancer un intent) envisagées plus tard.
- Q: Comment un workspace est-il relié à un appareil ? → A: choix manuel mémorisé, sinon émulateur
  dédié à la branche, sinon unique appareil connecté, sinon demande à l'utilisateur.
- Q: La création d'un workspace crée-t-elle un émulateur ? → A: non, rien en v1.
- Q: Terminal et ADB ouverts ensemble, comment les placer ? → A: côte à côte en bas, terminal à
  gauche, ADB à droite, séparateur déplaçable.
- Q: Qui voit le bouton du volet ADB ? → A: seulement les dépôts où le mode Android est activé,
  réglage par dépôt, désactivé par défaut.
- Q: Que deviennent les logs d'un workspace quitté ou d'un volet fermé ? → A: la session continue
  en fond jusqu'à l'archivage, la suppression du workspace, la désactivation du mode Android ou la
  fermeture de l'app.
- Q: Défilement quand des logs arrivent ? → A: suit le bas ; se fige si l'utilisateur remonte, avec
  un bouton pour revenir aux derniers logs.
- Q: Appareil choisi à la main déconnecté ? → A: le volet attend cet appareil, sans repli.
- Q: Valeurs par défaut ? → A: 500 lignes à l'ouverture, 50 000 lignes gardées par workspace,
  raccourci ⌘⇧A (Ctrl+Shift+A sous Linux et Windows), ⌘/Ctrl+F dans le volet pour chercher, choix
  manuel gardé à l'archivage et effacé à la suppression.
- Q: Volet ouvert et passage à un workspace sans mode Android ? → A: le volet se masque, puis
  réapparaît au retour sur un workspace Android.
- Q: Quelle branche identifie l'émulateur dédié ? → A: la branche extraite dans le worktree,
  relue à chaque résolution ; après un renommage, un émulateur à l'ancien nom n'est plus reconnu.
- Q: Appareil dont le débogage USB n'est pas autorisé ? → A: message « Autorise le débogage USB sur
  l'appareil », puis reprise automatique une fois autorisé.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ouvrir le volet ADB du workspace affiché (Priority: P1)

Un développeur Android travaille sur plusieurs workspaces (un worktree chacun), chacun avec son
appareil Android de test. Depuis le workspace qu'il regarde, il ouvre un volet ADB, à la manière
du volet terminal, et voit les logs de l'appareil associé à ce workspace, sans quitter
Claudette ni chercher quel appareil correspond à quelle branche.

Contenu du volet : le flux des logs de l'appareil (logcat), en lecture seule, avec recherche dans
l'historique affiché. Le volet n'accepte pas de saisie de commandes.

**Why this priority**: c'est la valeur centrale de la demande ; sans elle, rien d'autre n'a de sens.

**Independent Test**: activer le mode Android du dépôt, ouvrir un workspace associé à un appareil
connecté, ouvrir le volet ADB, et
constater que le contenu affiché vient de cet appareil-là, et d'aucun autre.

**Acceptance Scenarios**:

1. **Given** un workspace affiché dont l'appareil associé est connecté, **When** l'utilisateur
   ouvre le volet ADB, **Then** le volet s'affiche et montre les logs de cet appareil, au fil de
   l'eau.
2. **Given** le volet ADB ouvert, **When** l'utilisateur le referme, **Then** le volet disparaît et
   la zone de travail reprend sa place, comme pour le volet terminal.
3. **Given** deux appareils connectés en même temps, associés à deux workspaces différents,
   **When** l'utilisateur ouvre le volet ADB dans le workspace A, **Then** seul l'appareil de A
   est montré.
4. **Given** le volet ADB ouvert avec des logs affichés, **When** l'utilisateur cherche un texte,
   **Then** les occurrences sont trouvées dans les logs affichés et il peut passer de l'une à
   l'autre.
5. **Given** le volet ADB ouvert, **When** l'utilisateur essaie de taper du texte dans les logs,
   **Then** rien n'est envoyé à l'appareil.
6. **Given** un dépôt dont le mode Android est désactivé, **When** l'utilisateur affiche un de ses
   workspaces, **Then** ni le bouton ni le raccourci du volet ADB ne sont disponibles.
7. **Given** le terminal ouvert, **When** l'utilisateur ouvre aussi le volet ADB, **Then** les deux
   se partagent la zone du bas, terminal à gauche et ADB à droite, et le séparateur entre eux se
   déplace.

---

### User Story 2 - Suivre le workspace affiché (Priority: P1)

Quand l'utilisateur passe d'un workspace à un autre, le volet ADB bascule sur l'appareil du
nouveau workspace, exactement comme le volet terminal montre les terminaux du workspace affiché.

**Why this priority**: « en relation avec le worktree en cours de visualisation » est explicite
dans la demande ; un volet figé sur un appareil tromperait l'utilisateur.

**Independent Test**: deux workspaces avec deux appareils distincts ; basculer de l'un à l'autre
avec le volet ouvert et vérifier que l'appareil montré change à chaque bascule.

**Acceptance Scenarios**:

1. **Given** le volet ADB ouvert sur le workspace A, **When** l'utilisateur sélectionne le
   workspace B, **Then** le volet montre l'appareil de B.
2. **Given** l'utilisateur revient au workspace A, **When** le volet se réaffiche, **Then** il
   retrouve la session ADB de A : contenu déjà affiché conservé, plus les logs reçus entre-temps.
3. **Given** le volet ADB ouvert sur un workspace Android, **When** l'utilisateur sélectionne un
   workspace dont le dépôt n'a pas le mode Android, **Then** le volet est masqué ; **When** il
   revient sur un workspace Android, **Then** le volet réapparaît.

---

### User Story 3 - Associer un appareil à un workspace (Priority: P2)

L'utilisateur sait quel appareil est associé au workspace affiché et peut changer cette
association.

Règle d'association, dans cet ordre :
1. l'appareil choisi à la main pour ce workspace, s'il y en a un ;
2. sinon l'émulateur dédié à la branche du workspace, s'il est démarré ;
3. sinon l'appareil prêt, s'il est le seul ;
4. sinon aucun : le volet demande à l'utilisateur de choisir parmi les appareils connectés.

Un choix manuel est mémorisé pour le workspace et l'utilisateur peut le changer ou l'effacer à
tout moment ; effacé, l'association redevient automatique (étapes 2 à 4).

**Why this priority**: nécessaire dès qu'il y a plusieurs appareils, mais un premier usage avec
un seul appareil reste possible sans elle.

**Independent Test**: changer l'appareil associé à un workspace, puis rouvrir le volet et vérifier
que le nouvel appareil est montré.

**Acceptance Scenarios**:

1. **Given** un workspace affiché, **When** l'utilisateur regarde le volet ADB, **Then** le nom de
   l'appareil associé est visible dans le volet.
2. **Given** plusieurs appareils connectés, **When** l'utilisateur change l'appareil associé au
   workspace, **Then** le volet montre le nouvel appareil.
3. **Given** l'émulateur dédié à la branche du workspace est démarré, avec d'autres appareils
   connectés, et aucun choix manuel, **When** l'utilisateur ouvre le volet, **Then** l'émulateur
   dédié est montré, sans question.
4. **Given** pas d'émulateur dédié démarré et un seul appareil connecté, sans choix manuel,
   **When** l'utilisateur ouvre le volet, **Then** cet appareil est montré.
5. **Given** pas d'émulateur dédié démarré, plusieurs appareils connectés et aucun choix manuel,
   **When** l'utilisateur ouvre le volet, **Then** le volet liste les appareils et demande lequel
   associer.
6. **Given** un choix manuel mémorisé pour le workspace, **When** l'application est relancée et
   le workspace rouvert, **Then** le même appareil est associé.
7. **Given** un choix manuel mémorisé, **When** l'utilisateur l'efface, **Then** l'association
   redevient automatique.

---

### Edge Cases

- Aucun appareil associé au workspace affiché : le volet l'indique clairement et dit comment en
  associer un, au lieu de montrer un autre appareil.
- L'appareil associé est déconnecté ou éteint : le volet l'indique ; il reprend quand l'appareil
  revient, sans action de l'utilisateur.
- L'appareil est branché mais le débogage USB n'y est pas autorisé : le volet affiche « Autorise
  le débogage USB sur l'appareil » et reprend seul une fois l'autorisation donnée.
- La branche du worktree est renommée ou changée : l'émulateur dédié est recherché sous le nouveau
  nom ; un émulateur créé sous l'ancien nom n'est plus reconnu comme dédié.
- L'outil ADB est introuvable sur la machine : le volet affiche un message explicite, le reste de
  l'application fonctionne normalement.
- Le workspace est archivé ou supprimé : sa session ADB s'arrête.
- Workspace distant (machine appairée) : le volet est indisponible — voir Assumptions.
- Volume de logs élevé : le volet reste fluide et ne bloque pas le reste de l'interface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Dans un workspace dont le dépôt a le mode Android activé, l'utilisateur MUST pouvoir
  ouvrir et fermer un volet ADB par un bouton à côté de celui du volet terminal et par un
  raccourci clavier configurable, par défaut ⌘⇧A sous macOS et Ctrl+Shift+A sous Linux et
  Windows.
- **FR-001a**: Chaque dépôt MUST avoir un réglage « mode Android », désactivé par défaut. Mode
  désactivé : ni bouton, ni raccourci actif, ni commande du volet ADB pour les workspaces de ce
  dépôt, et aucun appel à ADB pour eux.
- **FR-001b**: Terminal et volet ADB ouverts ensemble MUST partager la zone du bas côte à côte,
  terminal à gauche, ADB à droite, avec un séparateur déplaçable ; ouvert seul, chacun occupe
  toute la largeur.
- **FR-002**: Le volet ADB MUST montrer uniquement l'appareil associé au workspace affiché.
- **FR-003**: Quand le workspace affiché change, le volet MUST basculer sur l'appareil du nouveau
  workspace sans action de l'utilisateur.
- **FR-003a**: Quand le workspace affiché appartient à un dépôt sans mode Android (ou est
  distant), le volet MUST être masqué, et MUST réapparaître au retour sur un workspace Android si
  l'utilisateur ne l'a pas fermé entre-temps.
- **FR-004**: Chaque workspace MUST garder sa propre session ADB : revenir à un workspace retrouve
  le contenu déjà affiché pour lui pendant la session de l'application.
- **FR-004a**: Une session ouverte MUST continuer à recevoir les logs quand l'utilisateur quitte le
  workspace ou ferme le volet, jusqu'à l'archivage ou la suppression du workspace, la
  désactivation du mode Android de son dépôt ou la fermeture de l'application.
- **FR-005**: Le volet MUST afficher le nom de l'appareil associé et son état (connecté,
  déconnecté, non autorisé, absent) ; pour un appareil non autorisé, le message MUST être
  « Autorise le débogage USB sur l'appareil », avec reprise automatique une fois autorisé.
- **FR-006**: Le volet MUST afficher au fil de l'eau les logs (logcat) de l'appareil associé,
  en lecture seule, et permettre de chercher un texte dans les logs affichés.
- **FR-006a**: Le volet MUST suivre les derniers logs tant que l'utilisateur est en bas ; s'il
  remonte, l'affichage se fige et un bouton ramène aux derniers logs, qui reprend le suivi.
- **FR-006b**: À l'ouverture d'une session, le volet MUST montrer au plus les 500 dernières lignes
  déjà présentes sur l'appareil, puis le direct ; il MUST garder au plus 50 000 lignes par
  workspace, les plus anciennes sortant d'abord.
- **FR-006c**: ⌘F (Ctrl+F sous Linux et Windows) MUST ouvrir la recherche du volet quand le focus
  y est, sans ouvrir la recherche du chat ni celle du terminal.
- **FR-007**: L'association workspace → appareil MUST suivre, dans l'ordre : choix manuel
  mémorisé du workspace ; sinon émulateur dédié à la branche, s'il est démarré ; sinon l'unique
  appareil prêt (connecté et autorisé) ; sinon demande à l'utilisateur.
- **FR-007d**: La branche qui identifie l'émulateur dédié MUST être celle extraite dans le
  worktree au moment de la résolution.
- **FR-007a**: Le choix manuel MUST être mémorisé par workspace, survivre au redémarrage de
  l'application, être gardé à l'archivage et effacé à la suppression du workspace, et pouvoir être
  changé ou effacé par l'utilisateur.
- **FR-007b**: La création d'un workspace MUST NOT créer ni démarrer d'émulateur.
- **FR-007c**: Un appareil choisi à la main et déconnecté MUST être attendu : le volet indique
  qu'il est déconnecté et ne bascule jamais seul sur un autre appareil.
- **FR-008**: Sans appareil associé, avec un appareil déconnecté ou sans outil ADB disponible, le
  volet MUST afficher un message explicite qui dit quoi faire, et ne MUST PAS montrer un autre
  appareil.
- **FR-009**: Un appareil qui revient après une déconnexion MUST être repris par le volet sans
  action de l'utilisateur.
- **FR-010**: L'ouverture du volet ADB MUST NOT modifier les onglets ni les sessions du
  terminal ; seule la largeur du terminal change quand les deux sont ouverts (FR-001b).
- **FR-011**: La session ADB d'un workspace archivé ou supprimé MUST s'arrêter.
- **FR-012**: La documentation utilisateur MUST décrire le mode Android, le volet, son raccourci
  et ses réglages.

### Key Entities

- **Appareil Android** : appareil physique ou émulateur visible par ADB ; identifiant, nom
  lisible, état (connecté, hors ligne, absent).
- **Émulateur dédié à une branche** : émulateur dont le nom identifie le dépôt et la branche du
  workspace (voir Assumptions).
- **Association workspace → appareil** : relie un workspace à au plus un appareil ; règle selon
  FR-007 ; seul le choix manuel est mémorisé.
- **Session ADB** : logs affichés pour un workspace (FR-006), propres à ce workspace ; durée de vie
  selon FR-004a et FR-011.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Depuis un workspace associé à un appareil connecté, l'utilisateur voit les logs de
  cet appareil en moins de 3 secondes après l'ouverture du volet.
- **SC-002**: Lors d'un changement de workspace, le volet montre l'appareil du nouveau workspace
  en moins de 1 seconde, dans 100 % des bascules testées.
- **SC-003**: Avec deux appareils connectés et deux workspaces, aucune bascule ne montre
  l'appareil de l'autre workspace (0 erreur sur 20 bascules).
- **SC-004**: Avec un flux de 2 000 lignes de logs par seconde pendant 60 secondes, un caractère
  tapé dans le chat apparaît en moins de 100 ms et le défilement du volet reste fluide.
- **SC-005**: Un utilisateur qui n'a jamais vu le volet l'ouvre et identifie l'appareil montré
  sans aide, au premier essai.

## Assumptions

- Les utilisateurs visés sont des développeurs Android qui ont déjà l'outil ADB (Android SDK)
  installé ; Claudette ne l'installe pas.
- Le volet reprend l'apparence et le comportement d'ouverture du volet terminal (panneau en bas
  de la zone de travail, hauteur partagée avec le terminal, contenu propre au workspace).
- L'état ouvert/fermé et la taille du volet sont des états d'interface non persistés, comme pour
  le terminal ; seule l'association workspace → appareil, si elle est manuelle, est mémorisée.
- Émulateur dédié : on reprend la convention de nommage existante des émulateurs par branche,
  `task-<dépôt>-<branche>` (dépôt et branche réduits aux caractères lettres, chiffres, `.`, `_`,
  `-`, nom tronqué à 60 caractères), où la branche est celle extraite dans le worktree
  (FR-007d). Un émulateur qui ne suit pas cette convention n'est jamais
  pris pour l'émulateur dédié ; il reste associable par l'unique appareil connecté ou à la main.
- Hors périmètre de cette version : workspaces distants (machine appairée) et application mobile
  Claudette ; le volet n'est proposé que pour les workspaces locaux.
- Hors périmètre : création, démarrage ou suppression d'émulateurs depuis Claudette (en
  particulier à la création d'un workspace), saisie de commandes dans le volet, capture d'écran ou
  recopie de l'écran de l'appareil.
- Évolutions envisagées pour une version ultérieure, hors de cette spec : raccourcis d'actions
  sur l'appareil du workspace (installer l'APK du worktree, lancer un intent…), et création
  d'un émulateur dédié à la création du workspace.
- Le volet fonctionne sur macOS, Linux et Windows, partout où l'outil ADB est disponible.
