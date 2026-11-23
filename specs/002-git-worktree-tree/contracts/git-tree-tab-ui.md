# Contrat UI : onglet « Arbre git »

Ce contrat décrit ce que l'utilisateur voit et peut faire ; c'est lui que vérifient les tests de composants et le quickstart. Les libellés sont donnés en anglais, langue de référence de `locales/en/sidebar.json`.

## Point d'entrée

- Un quatrième onglet du panneau latéral droit, après Files, Changes et Tasks, libellé « Git tree » (FR-001).
- L'onglet actif est mémorisé par espace de travail, comme les autres (`rightSidebarTabByWorkspace`).
- L'arbre porte sur le dépôt de l'espace de travail sélectionné. Changer d'espace de travail vers un autre dépôt recharge l'arbre.

## Zones de la vue (de haut en bas)

1. **Barre d'outils** : une case « Show remote branches », non cochée par défaut (FR-014).
2. **Liste des références** (FR-011) : toutes les branches affichées et tous les worktrees, indépendamment des commits chargés.
   - La branche principale est en tête, marquée « base ».
   - Chaque branche affiche ses compteurs, par exemple `↑3 ↓2` (FR-017), et la marque de son worktree s'il y en a un.
   - Un clic sur une entrée amène son commit dans l'arbre, en chargeant plus d'historique si nécessaire (`until_hash`), puis le sélectionne.
   - Si le commit est au-delà de 10 000 commits, l'arbre ne bouge pas et un bandeau affiche « This commit is too old to show in the tree », avec le hash complet et un bouton de copie (FR-011).
3. **Arbre** : une ligne par commit. On y voit le graphe (lanes colorées), les étiquettes de refs, les marques de worktree, le message résumé, l'auteur, la date relative et le hash court (FR-002, FR-003).
4. **Pied de l'arbre** (FR-011) : le bouton « Load more » s'il reste de l'historique et que moins de 10 000 commits sont chargés. Au-delà, le bouton disparaît, remplacé par le message « Tree limit reached (10,000 commits) ».
5. **Détail du commit**, panneau sous l'arbre, ouvert au clic sur une ligne (FR-016) :
   - le message complet, l'auteur, la date et le hash complet avec un bouton de copie ;
   - les refs et les worktrees qui contiennent le commit ;
   - les fichiers modifiés, avec leur statut ;
   - un clic sur un fichier ouvre son diff dans le visualiseur de diff existant, calculé par rapport au premier parent.

## Marque de worktree

| Cas | Apparence | Action |
|---|---|---|
| Espace de travail Claudette | nom de l'espace de travail, style plein | clic : sélectionne cet espace de travail (FR-008) |
| Worktree externe | nom du dossier, style contour, info-bulle « Not a Claudette workspace — <chemin> » | aucune navigation (FR-005) |
| Dépôt principal | libellé « main checkout » | sélectionne l'espace de travail du dépôt, s'il existe |
| Détaché | suffixe « detached », marque posée sur le commit | comme ci-dessus selon le cas (FR-010) |
| Modifié | point indicateur, info-bulle « Uncommitted changes » | (FR-009) |
| Introuvable | style barré, info-bulle « Folder not found » | aucune navigation (FR-010) |

Plusieurs étiquettes sur un même commit s'affichent en ligne et peuvent passer à la ligne. Au-delà de 3, un « +N » ouvre la liste complète, pour que rien ne se recouvre.

## États de la vue

| État | Affichage |
|---|---|
| Chargement initial | squelette de lignes |
| Dépôt sans commit | « This repository has no commits yet. » |
| Erreur | « Could not read the git history. » + détail + bouton « Retry » ; le reste de l'application reste utilisable |
| Hôte non compatible | « This machine does not support the git tree yet. » |
| Rafraîchissement | silencieux ; la sélection et la position de défilement sont conservées si le commit sélectionné existe toujours |

## Accessibilité

- Les lignes de commit et les entrées de la liste sont focalisables et s'activent au clavier (Entrée).
- Le graphe SVG est décoratif (`aria-hidden`). Le sens de chaque ligne est porté par le texte : message, refs, worktrees, compteurs.
- Les états « modifié », « détaché », « introuvable » et « externe » ont un libellé textuel accessible, pas seulement une couleur.
