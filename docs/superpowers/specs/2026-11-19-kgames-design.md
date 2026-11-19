# Site de mini-jeux entre potes — Document de conception

Date : 2026-11-19
Statut : brouillon, à valider

Légende : **[décidé]** = choisi par le porteur du projet ; **[proposition]** = choix de Claude, à corriger si besoin ; **[au builder]** = laissé à l'implémentation.

## 1. Intention

Un petit site de jeux navigateur façon KGames, pour une bande d'environ 4 potes qui sont **tout le temps ensemble sur Discord en vocal**. Deux jeux pour commencer :

1. **Pictionary** dans l'esprit de skribbl.io, mais avec un vrai outil de dessin (niveau Gartic Phone, avec Ctrl+Z) et des devinettes moins assistées.
2. **Quiz de culture G** en réponses libres, où **ce sont les joueurs qui valident les réponses** — le fun vient de voir les mauvaises réponses des autres.

Le site doit être gratuit à héberger. Le porteur est dev mais délègue le code.

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- Lancer une partie en quelques secondes : un pseudo, un code de salle à coller dans Discord, c'est parti.
- Pictionary : outils de dessin riches, annuler/rétablir, dessin fluide en temps réel chez tous.
- Pictionary : deviner doit rester difficile ; le dessin est le vrai indice.
- Quiz : réponses libres, révélation publique, validation par vote du groupe.
- Banque de questions alimentée à la fois à la main (page admin) et par des questions générées par Claude à partir de thèmes.

### Non-objectifs (v1)
- Comptes utilisateurs, profils, historique de stats.
- Matchmaking public, salons publics, spectateurs.
- Chat vocal ou chat de discussion (Discord s'en charge).
- Anti-triche poussé (au-delà de garder les secrets côté serveur).
- Dessin optimisé tactile/mobile. **[proposition]** Cible desktop ; le quiz doit rester utilisable sur mobile.
- Questions avec image/son.
- Interface multilingue (tout en français).

### Anti-objectifs (échec même si "ça marche")
- **Quiz : validation automatique des réponses.** [décidé] Les variantes acceptées servent seulement de repère visuel.
- **Pictionary : une réponse proche ("close") ou correcte visible dans le chat par les autres.** [décidé]
- **Pictionary : indices qui mâchent le travail** (lettres révélées tôt et en nombre). [décidé]
- Dessin saccadé ou désynchronisé entre joueurs ; Ctrl+Z qui ne s'applique pas chez tout le monde.
- Friction d'accès (inscription, installation).
- Serveur qui dort et met une minute à se réveiller au début d'une soirée.

## 3. Contraintes
- **Hébergement gratuit.** [décidé]
- 4 joueurs typiquement ; **[proposition]** maximum 8 par salle.
- Les joueurs sont en vocal en permanence : ils peuvent crier une réponse, donc l'interface ne doit jamais aider à fuiter le mot / les réponses (secrets gardés côté serveur).
- Navigateurs desktop modernes (Chrome, Firefox, Edge).

## 4. Approches envisagées

| Approche | Pour | Contre |
|---|---|---|
| **A. Cloudflare Workers + Durable Objects + D1 + Pages** — un Durable Object par salle fait office de serveur arbitre (WebSocket) | Tout gratuit sur une plateforme, pas de mise en veille/cold start notable, serveur autoritaire (secrets protégés, chronos fiables) | Spécifique à Cloudflare |
| B. Supabase Realtime + Postgres, navigateur de l'hôte = arbitre | Rapide à monter, connecteur dispo | Projet gratuit mis en pause après 1 semaine d'inactivité ; mot/réponses visibles via devtools car tout transite par les clients |
| C. Node + Socket.IO sur Render free | Classique, portable | Serveur qui s'endort (≈1 min de réveil), base de données à prévoir à part |

**Choix : A** [décidé]. Raison : seule option gratuite qui donne à la fois un arbitre serveur (indispensable pour cacher mot et réponses à des joueurs en vocal) et aucune attente au réveil.

## 5. Architecture technique

- **Langage** : TypeScript partout. [proposition]
- **Front** : React + Vite, déployé sur Cloudflare Pages. [proposition]
- **Back** : un Worker (routes HTTP : création de salle, API admin) + **un Durable Object par salle** (état de partie, WebSockets, chronos via alarms). Utiliser l'API WebSocket Hibernation et les Durable Objects à stockage SQLite (ceux du plan gratuit). [proposition]
- **Données** : D1 (SQLite) pour la banque de questions et les listes de mots par défaut. L'état des parties vit uniquement dans le Durable Object (rien de persistant en base). [proposition]
- **Structure du repo** [proposition] : monorepo (pnpm workspaces)
  - `apps/web` — front
  - `apps/worker` — Worker + Durable Object + migrations D1
  - `packages/shared` — types du protocole WebSocket, logique de jeu sous forme de fonctions pures (machine à états par jeu), normalisation de texte, scoring. Cette logique est testée unitairement.
- **Protocole** : messages JSON typés (union discriminée) client ↔ serveur. Le serveur envoie à chaque client une **vue filtrée** de l'état (ex. le mot n'est envoyé qu'au dessinateur et aux joueurs qui l'ont trouvé).

## 6. Socle commun (salles)

- Page d'accueil : liste des jeux, bouton « Créer une salle » par jeu, champ « Rejoindre avec un code ».
- Code de salle court (ex. 5 lettres sans caractères ambigus) + lien direct `/<jeu>/<code>` à coller dans Discord. [proposition]
- Pseudo demandé à l'arrivée, mémorisé en localStorage. Pas de compte. [décidé]
- Le créateur est l'**hôte** : il règle les paramètres et lance la partie. S'il part, l'hôte passe au joueur suivant. [proposition]
- **Reconnexion** : un jeton de joueur en localStorage permet de récupérer sa place (score compris) après un rafraîchissement ou une coupure. [proposition]
- Salle en lobby → partie → écran de fin (classement) → « Rejouer » dans la même salle avec les mêmes joueurs. [proposition]
- Une salle vide est détruite après un délai (ex. 10 min). [au builder]
- Rejoindre en cours de partie : possible, le joueur entre avec 0 point et participe au tour suivant. [proposition]

## 7. Jeu 1 — Pictionary

### 7.1 Outils de dessin (référence : Gartic Phone) [décidé dans l'esprit, détail en proposition]
- Crayon, gomme, pot de peinture (remplissage), ligne, rectangle, ellipse (contour ou plein).
- Épaisseur (curseur, plusieurs tailles), opacité.
- Palette de couleurs prédéfinie + sélecteur de couleur libre.
- **Annuler / Rétablir** : Ctrl+Z / Ctrl+Y (et Ctrl+Shift+Z), plus des boutons. [décidé]
- « Tout effacer » (annulable).
- Raccourcis clavier pour les outils. [au builder]

### 7.2 Synchronisation du dessin [proposition]
- Le dessin est une **liste ordonnée d'actions** (trait avec ses points, forme, remplissage, effacement total), pas une image.
- Les points d'un trait en cours sont envoyés par petits lots (≈ toutes les 30–50 ms) pour un rendu en direct chez les autres.
- Surface logique fixe (ex. 800×600) mise à l'échelle à l'affichage, pour que toutes les coordonnées et tous les rendus soient identiques partout.
- Annuler = retirer la dernière action du dessinateur ; tous les clients rejouent le dessin (avec instantanés intermédiaires en cache pour rester rapide). Rétablir = remettre l'action retirée tant qu'aucune nouvelle action n'a été faite.
- Le remplissage est recalculé de façon déterministe sur chaque client à partir du même historique. Si des différences d'anticrénelage posent problème, le builder peut choisir de dessiner sans anticrénelage ou d'utiliser une tolérance. [au builder]
- Un joueur qui (re)rejoint reçoit l'historique complet du dessin en cours.

### 7.3 Déroulement d'une manche
- Chaque joueur dessine à tour de rôle ; **3 tours** par défaut (réglable 1–5). [proposition]
- Le dessinateur choisit parmi **3 mots** (15 s pour choisir, sinon un mot au hasard). [proposition]
- Temps de dessin : **80 s** par défaut (réglable). [proposition]
- La manche se termine quand tout le monde a trouvé ou à la fin du chrono ; le mot est alors révélé à tous avec un récap des points.

### 7.4 Deviner, indices et chat
- Le champ de chat sert aux **tentatives**. [proposition]
- **Mauvaise réponse** : affichée à tous dans le chat (c'est drôle). [proposition]
- **Bonne réponse** : jamais affichée ; tout le monde voit « X a trouvé ! » ; le joueur voit le mot. [décidé]
- **Réponse proche** : jamais affichée aux autres ; seul l'auteur voit « tu chauffes ! ». [décidé]
- Un joueur qui a trouvé ne peut plus envoyer de tentatives (évite les fuites dans le chat). [proposition]
- Comparaison : insensible à la casse, aux accents, aux espaces/tirets en trop. « Proche » = distance d'édition de 1 (2 pour les mots de 8 lettres et plus) après normalisation. [proposition]
- **Indices** [décidé : moins d'indices que skribbl, et **c'est le dessinateur qui choisit quelle lettre révéler** ; détail en proposition] :
  - Au départ, les devineurs ne voient que la longueur du mot (cases vides ; espaces et tirets d'union visibles).
  - Le dessinateur voit le mot en entier au-dessus du canevas ; quand les indices sont débloqués, il **clique sur une lettre** pour la révéler à tous. [proposition]
  - Indices débloqués à partir du seuil réglé (par défaut : le dernier tiers du temps), dans la limite du nombre max de lettres (par défaut 2). Avant le seuil, les lettres ne sont pas cliquables. [proposition]
  - **Aucune révélation automatique** : si le dessinateur ne clique pas, aucune lettre n'est révélée. [proposition]
  - Un petit compteur indique au dessinateur combien d'indices il lui reste ; tout le monde voit qu'une lettre vient d'être révélée. [proposition]

### 7.5 Paramètres de la salle [décidé : tout est réglable par l'hôte ; valeurs en proposition]
Réglés par l'hôte dans le lobby, conservés pour la partie suivante (« Rejouer ») et mémorisés dans son localStorage.

| Paramètre | Défaut | Plage |
|---|---|---|
| Nombre de tours | 3 | 1–10 |
| Temps de dessin | 80 s | 30–240 s |
| Temps pour choisir le mot | 15 s | 5–30 s |
| Nombre de mots proposés | 3 | 1–5 |
| Lettres que le dessinateur peut révéler au maximum | 2 | 0–5 |
| Déblocage des indices | dernier tiers du temps | réglable (en % du temps écoulé, 0 % = dès le début) |
| Détection « tu chauffes » | activée | on / off |
| Joueurs max | 8 | 2–12 |
| Mots perso | aucun | liste + « uniquement mes mots » / « mélangés » |

Les plages exactes sont laissées au builder ; l'exigence est que chaque valeur ci-dessus soit modifiable avant la partie.

### 7.6 Score [proposition]
- Deviner : points dégressifs selon le temps (ex. de 100 à 20 points), petit bonus pour le premier à trouver.
- Dessinateur : points proportionnels à la part de joueurs qui ont trouvé.
- Classement à la fin des tours.

### 7.7 Mots [proposition]
- Liste par défaut **en français**, quelques centaines de mots de difficultés variées, générée par Claude et stockée en D1.
- **Mots perso** : dans les paramètres de la salle, l'hôte colle une liste (séparée par des virgules ou des retours à la ligne), avec l'option « uniquement mes mots » ou « mélangés à la liste par défaut ». Liste mémorisée dans le localStorage de l'hôte, non persistée côté serveur.

### 7.8 Bonus post-v1 [proposition]
- Galerie des dessins de la partie à l'écran de fin, avec téléchargement en image.

## 8. Jeu 2 — Quiz de culture G

### 8.1 Déroulement [décidé : réponses libres, révélation, validation humaine ; détail en proposition]
1. **Paramètres** (hôte) : thèmes à inclure (tous par défaut), nombre de questions (**15** par défaut), temps de réponse (**30 s** par défaut).
2. **Question** : affichée à tous. Chacun tape sa réponse en texte libre ; il peut la modifier jusqu'à la fin du chrono. Personne ne voit les réponses des autres (on voit juste qui a répondu). La phase se termine quand tout le monde a validé ou à la fin du chrono.
3. **Révélation** : les réponses s'affichent **une par une, avec le nom de leur auteur** ; l'hôte avance avec « Suivant » (le rythme se fait en vocal). Puis la **bonne réponse** s'affiche, avec les variantes acceptées comme repère.
4. **Vote** : pour chaque réponse, les autres joueurs votent ✅ / ½ / ❌ (pas de vote sur sa propre réponse). Majorité ; en cas d'égalité, l'hôte tranche (s'il s'agit de sa propre réponse, l'égalité donne ½). [proposition] Une réponse vide vaut ❌ sans vote. Les réponses identiques après normalisation sont regroupées en un seul vote.
5. **Points** : 1 / 0,5 / 0. Petit classement intermédiaire, puis question suivante.
6. **Fin** : classement final, « Rejouer ».

### 8.2 Banque de questions [décidé : mélange saisie manuelle + génération par Claude]
- Table D1 `questions` : id, thème, texte de la question, bonne réponse, variantes acceptées (liste), source (`manuel` / `généré`), date de création, date de dernière utilisation. [proposition]
- Thèmes : texte libre avec autocomplétion sur les thèmes existants. [proposition]
- Anti-répétition : à la sélection, on privilégie les questions jamais ou le moins récemment utilisées dans les thèmes choisis. [proposition]
- La génération par Claude se fait **hors de l'application** (dans une conversation, sans appel d'API depuis le site, ce qui coûterait de l'argent) : Claude produit un fichier JSON, importé via `/admin`. [proposition]
- Les questions générées par Claude sont vérifiées (relecture de l'exactitude) avant import. [proposition]

### 8.3 Page admin [décidé : interface admin pour ajouter des questions]
- Route `/admin`, protégée par un mot de passe unique (secret Cloudflare) et un cookie de session. Réservée au porteur. [proposition]
- Lister, filtrer par thème, chercher, ajouter, modifier, supprimer des questions.
- **Import** d'un fichier JSON (format documenté, celui que Claude produit) avec un aperçu avant validation ; **export** de la banque. [proposition]
- **[proposition]** Gestion de la liste de mots par défaut du Pictionary dans cette même page.

### 8.4 Contenu de départ [proposition]
- Claude génère un premier lot de questions (ex. ~200, sur une dizaine de thèmes variés), au format d'import.
- Ensuite, le porteur donne des thèmes et Claude renvoie des fichiers à importer.

## 9. Ordre de réalisation [proposition]
1. Socle (repo, Worker, Durable Object salle, lobby, pseudo, reconnexion) + **Pictionary**.
2. **Quiz** + D1 + page admin.
3. Contenu : liste de mots, premier lot de questions.

Chaque étape est jouable et déployable seule.

## 10. Déploiement
- Le déploiement se fait sur le **compte Cloudflare du porteur** (plan gratuit) via `wrangler`. Le repo contient un README avec les étapes de mise en place : création de la base D1, secret du mot de passe admin, déploiement du Worker et du site.

## 11. Laissé au builder
- Choix des bibliothèques (gestion d'état front, style/CSS, tests), tant que ça reste léger.
- Design visuel détaillé de l'interface (une direction ludique et lisible ; pas de maquette imposée).
- Format exact des messages WebSocket, cadence d'envoi des points, stratégie d'instantanés du dessin.
- Barème exact des points dans les limites de 7.6.
- Durée de vie des salles vides, limites anti-spam du chat.
