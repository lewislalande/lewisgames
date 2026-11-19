# kgames

Un petit site de mini-jeux à jouer entre potes, sans compte : on choisit un pseudo, on crée un salon, on envoie le lien sur Discord. Pour l'instant il y a le **Pictionary** (dessin et devinettes en temps réel) ; un **quiz** arrive ensuite.

Tourne entièrement sur l'offre gratuite de Cloudflare : un Worker, un Durable Object par salon (SQLite) et le front servi en fichiers statiques par le même Worker.

## Prérequis

- Node 22.12 ou plus
- pnpm (`corepack enable` suffit, la version est fixée dans `package.json`)
- Un compte Cloudflare gratuit (uniquement pour déployer)

## Installation

```sh
pnpm install
```

## Développement

```sh
pnpm dev
```

Lance ensemble `wrangler dev` (API et WebSocket sur http://localhost:8787) et `vite` (front sur http://localhost:5173, qui relaie `/api` vers le port 8787). Ouvre http://localhost:5173.

## Tests

```sh
pnpm test      # tests unitaires : shared, worker, web
pnpm build     # typecheck + build du front
```

Deux scénarios de bout en bout (Playwright + Chrome, à lancer à la main, hors `pnpm test`) :

```sh
pip install playwright
pnpm --filter web build
pnpm --filter worker dev          # dans un autre terminal, port 8787

python3 apps/web/e2e/draw-sync.py   # synchro du dessin entre 3 puis 2 joueurs
python3 apps/web/e2e/full-game.py   # partie complète à 3 joueurs
```

Options : `--base <url>` et `--chrome <chemin>` (par défaut `/usr/bin/google-chrome`).

## Déploiement

Première fois, depuis `apps/worker` :

```sh
cd apps/worker
pnpm exec wrangler login
```

Ensuite, à la racine :

```sh
pnpm run deploy
```

Utilise bien `pnpm run deploy` : `pnpm deploy` est une commande intégrée de pnpm, différente. Le script construit le front puis lance `wrangler deploy`. Le site est publié sur `https://kgames.<ton-compte>.workers.dev` (`kgames` est le nom dans `apps/worker/wrangler.jsonc`).

## Inviter des amis

Dans le salon, partage le **code** à 5 lettres ou le **lien** direct (`/pictionary/<CODE>`) et colle-le dans Discord. Le bouton de copie du lien est dans le salon.

## Réglages du salon

Le créateur du salon (hôte) peut changer avant de lancer la partie :

- nombre de manches (1 à 10, défaut 3)
- durée de dessin (30 à 240 s, défaut 80)
- durée de choix du mot (5 à 30 s, défaut 15)
- nombre de mots proposés (1 à 5, défaut 3)
- nombre d'indices max (0 à 5, défaut 2) et seuil de déblocage des indices (0 à 100 %, défaut 67)
- détection « tu chauffes » (activée par défaut)
- nombre de joueurs max (2 à 12, défaut 8)
- mots personnalisés, mélangés à la liste ou exclusifs (« seulement mes mots »)

Les derniers réglages sont gardés dans le navigateur de l'hôte.

## Structure du projet

```
packages/shared/   règles du jeu, réglages, mots, protocole (partagé front/back)
apps/worker/       Cloudflare Worker + Durable Object (un salon = un objet), wrangler.jsonc
apps/web/          front React + Vite ; apps/web/e2e/ : scénarios Playwright
```

## Modifier la liste de mots

Édite `packages/shared/src/pictionary/words-fr.json` : un simple tableau JSON de mots ou expressions (avec accents, tirets autorisés). La comparaison des réponses ignore la casse, les accents, les tirets et les espaces en trop. Redéploie ensuite avec `pnpm run deploy`.
