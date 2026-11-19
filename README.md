# kgames

Un petit site de mini-jeux à jouer entre potes, sans compte : on choisit un pseudo, on crée un salon, on envoie le lien sur Discord. Il y a le **Pictionary** (dessin et devinettes en temps réel) et un **quiz** (questions de culture générale, vote des réponses entre joueurs).

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
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # une fois (mot de passe admin local)
pnpm --filter worker run db:migrate:local                # une fois, et après chaque nouvelle migration
pnpm --filter worker run seed:local                      # une fois : questions et mots
pnpm dev
```

`pnpm dev` lance ensemble `wrangler dev` (API et WebSocket sur http://localhost:8787) et `vite` (front sur http://localhost:5173, qui relaie `/api` vers le port 8787). Ouvre http://localhost:5173.

## Tests

```sh
pnpm test      # tests unitaires : shared, worker, web
pnpm build     # typecheck + build du front
```

Quatre scénarios de bout en bout (Playwright + Chrome, à lancer à la main, hors `pnpm test`) :

```sh
pip install playwright
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # une fois
pnpm --filter worker run db:migrate:local                # une fois
pnpm --filter web build
pnpm --filter worker dev          # dans un autre terminal, port 8787

python3 apps/web/e2e/draw-sync.py   # synchro du dessin entre 3 puis 2 joueurs
python3 apps/web/e2e/full-game.py   # partie complète de Pictionary à 3 joueurs
python3 apps/web/e2e/quiz-game.py   # partie de quiz à 3 joueurs
python3 apps/web/e2e/admin.py       # page d'administration
```

`quiz-game.py` et `admin.py` créent et suppriment leurs propres questions (thème « Culture e2e ») via l'API d'admin : le thème ne doit pas exister avant. Ils ont besoin du mot de passe de `.dev.vars`.

Options : `--base <url>` et `--chrome <chemin>` (par défaut `/usr/bin/google-chrome`).

## Base de données (D1)

Le quiz stocke ses questions (et la liste de mots du Pictionary) dans une base Cloudflare D1, gratuite elle aussi.

**Création** (une seule fois, après `wrangler login`) :

```sh
pnpm --filter worker exec wrangler d1 create kgames --binding DB --update-config
```

`--update-config` remplace l'entrée existante de `apps/worker/wrangler.jsonc` (le `database_id` factice `00000000-…`) par le vrai identifiant, sans en ajouter une seconde.

Si wrangler ne modifie pas le fichier (ou si tu préfères le faire à la main) : lance la même commande sans `--binding` ni `--update-config`, puis colle le `database_id` affiché dans l'entrée `d1_databases` déjà présente de `apps/worker/wrangler.jsonc`, à la place de `00000000-0000-0000-0000-000000000000`. Ne crée pas un deuxième bloc : le binding (`DB`) et le nom (`kgames`) ne changent pas.

**Migrations** (à relancer après chaque mise à jour qui en ajoute) :

```sh
pnpm --filter worker run db:migrate:local    # base locale de wrangler dev
pnpm --filter worker run db:migrate:remote   # base Cloudflare
```

**Questions du quiz** : 200 questions en français (10 thèmes × 20, vérifiées, voir `apps/worker/seed/FACTCHECK.md`) et la liste de mots du Pictionary sont insérées par :

```sh
pnpm --filter worker run seed:local
pnpm --filter worker run seed:remote
```

Le script est sans danger à relancer (`INSERT OR IGNORE` : rien n'est écrasé ni dupliqué). Pour semer un autre fichier : `node apps/worker/scripts/seed.mjs --remote mon-fichier.json` (même format que l'import, voir plus bas).

> La clé de déduplication d'une question ignore désormais aussi la ponctuation (« Quelle est X ? » = « Quelle est X? »). Les clés des lignes insérées avant ce changement ne sont pas recalculées ; sans importance tant qu'aucune donnée n'existe, sinon vide la base locale (`rm -rf apps/worker/.wrangler/state/v3/d1`) et refais migrations + seed.

## Administration du quiz

Page `/admin` (ex. `https://lewisgames.<ton-compte>.workers.dev/admin`), protégée par un mot de passe. Elle permet de :

- parcourir, rechercher et filtrer les questions par thème ; ajouter, modifier, supprimer une question ;
- importer un fichier JSON (aperçu, doublons ignorés et signalés) et exporter toutes les questions ;
- modifier la liste de mots du Pictionary.

### Secrets

Le mot de passe et la clé de signature du cookie de session sont deux secrets du Worker :

```sh
pnpm --filter worker exec wrangler secret put ADMIN_PASSWORD
pnpm --filter worker exec wrangler secret put ADMIN_SECRET
```

Choisis un mot de passe long et aléatoire (par ex. `openssl rand -base64 24`), et une clé `ADMIN_SECRET` tout aussi longue et aléatoire. Changer `ADMIN_SECRET` déconnecte toutes les sessions d'admin en cours.

En local, copie `apps/worker/.dev.vars.example` vers `apps/worker/.dev.vars` (ignoré par git) et adapte les deux valeurs. Ne le commite jamais.

### Format d'import

```json
{
  "questions": [
    { "theme": "Géographie", "question": "Quelle est la capitale de l'Australie ?", "answer": "Canberra", "variants": ["Canbera"] }
  ]
}
```

- `theme` : 40 caractères max ; `question` : 300 ; `answer` : 100 ; `variants` (facultatif) : 10 au plus, 100 caractères chacune (orthographes, avec/sans article, abréviations).
- Une question est un doublon si son texte est identique à la casse, aux accents, aux espaces et à la ponctuation près : elle est ignorée et signalée. Les entrées invalides sont signalées par numéro, les autres sont importées.
- Pour faire générer un fichier par Claude : donne-lui les thèmes voulus, ce format exact, et demande des réponses courtes, non ambiguës et qui ne changent pas avec le temps.

## Règles du quiz

- L'hôte règle le nombre de questions (5 à 50, défaut 15), le temps de réponse (10 à 120 s, défaut 30), le nombre de joueurs (2 à 12, défaut 8) et les thèmes (aucun = tous).
- Chacun tape sa réponse en secret ; personne ne voit celle des autres avant la fin du temps.
- Les réponses sont ensuite révélées une par une, puis la bonne réponse est montrée. **Rien n'est validé automatiquement** : les variantes acceptées ne sont qu'un indice visuel.
- Les joueurs votent sur chaque réponse (sauf la leur) : ✅ 1 point, ½ 0,5 point, ❌ 0. La majorité l'emporte ; en cas d'égalité, l'hôte tranche (s'il est l'auteur de la réponse, ce sera ½). Pas de réponse = ❌ sans vote.
- Deux réponses identiques à la casse, aux accents et aux espaces près forment un seul vote, crédité à tous leurs auteurs.

## Déploiement

### Automatique (GitHub Actions)

La base D1 `kgames` existe déjà sur le compte Cloudflare et son id est dans `wrangler.jsonc`. Chaque push sur `main` lance `.github/workflows/deploy.yml` : tests, migrations D1, build du front, `wrangler deploy`, puis pose des secrets admin.

À configurer une fois dans GitHub → *Settings → Secrets and variables → Actions* :

| Secret | Contenu |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Jeton créé sur dash.cloudflare.com → *My Profile → API Tokens*, modèle « Edit Cloudflare Workers », en ajoutant la permission *Account → D1 → Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | L'id du compte (dashboard → *Workers & Pages*, colonne de droite) |
| `ADMIN_PASSWORD` | Mot de passe de `/admin` (long et aléatoire) |
| `ADMIN_SECRET` | Clé de signature des cookies admin (longue chaîne aléatoire, ex. `openssl rand -hex 32`) |

Ensuite, une seule fois : onglet *Actions* → **Seed questions** → *Run workflow* pour charger les 200 questions et les mots du Pictionary. Ne le relance pas après avoir supprimé des questions dans l'admin : il les rajouterait.

### À la main

Première fois, depuis `apps/worker` :

```sh
cd apps/worker
pnpm exec wrangler login
```

Puis crée la base, applique les migrations, pose les secrets et sème les questions (sections ci-dessus). Ensuite, à la racine :

```sh
pnpm run deploy
```

Utilise bien `pnpm run deploy` : `pnpm deploy` est une commande intégrée de pnpm, différente. Le script construit le front puis lance `wrangler deploy`. Le site est publié sur `https://lewisgames.<ton-compte>.workers.dev` (`lewisgames` est le nom dans `apps/worker/wrangler.jsonc`).

## Inviter des amis

Dans le salon, partage le **code** à 5 lettres ou le **lien** direct (`/pictionary/<CODE>` ou `/quiz/<CODE>`) et colle-le dans Discord. Le bouton de copie du lien est dans le salon.

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
apps/worker/       Cloudflare Worker + Durable Object (un salon = un objet), D1, wrangler.jsonc, migrations/, seed/
apps/web/          front React + Vite ; apps/web/e2e/ : scénarios Playwright
```

## Modifier la liste de mots

Depuis la page `/admin`, onglet « Mots du Pictionary » : un mot ou une expression par ligne, puis « Enregistrer » (la liste est remplacée d'un coup, sans redéploiement). La comparaison des réponses ignore la casse, les accents, les tirets et les espaces en trop.

`packages/shared/src/pictionary/words-fr.json` n'est que la liste de départ (insérée par `seed:local` / `seed:remote`) et le secours si la base n'a aucun mot : ce n'est plus là qu'on modifie la liste.
