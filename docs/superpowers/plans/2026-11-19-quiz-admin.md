# Quiz + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the culture-G quiz of spec §8 (free-text answers, one-by-one reveal, group voting ✅/½/❌, host tie-break) with a D1 question bank, a password-protected `/admin` page, and a first set of ~200 French questions.

**Architecture:** Same pattern as the Pictionary: the quiz rules are a pure reducer + per-player view in `packages/shared/src/quiz`. `RoomDO` becomes game-agnostic through a small adapter keyed by `room.game`. Questions and the Pictionary default words move to D1; the DO loads questions when the host starts a quiz. Admin is a JSON API under `/api/admin/*` (signed cookie) plus a React page at `/admin`.

**Tech Stack:** existing monorepo (TypeScript, Workers + SQLite DO, D1, React 19 + Vite, Vitest, `@cloudflare/vitest-pool-workers`, python Playwright e2e).

**Spec:** `docs/superpowers/specs/2026-11-19-kgames-design.md` §6, §8, §9 (phase 2 and 3), §10.

## Global Constraints

- Free Cloudflare plan only. D1 binding name `DB`, database name `kgames`; migrations in `apps/worker/migrations/`. Admin password = Worker secret `ADMIN_PASSWORD`; cookie signing key = secret `ADMIN_SECRET` (both documented in README; local dev uses `apps/worker/.dev.vars`, git-ignored, with a `.dev.vars.example` committed).
- **No automatic validation of quiz answers.** Accepted variants are only shown as a visual hint during the vote.
- Secrecy: during `answering`, nobody receives another player's answer text; the correct answer (and variants) reach nobody — host included — before the `reveal` step that shows it.
- All UI copy in French. Reuse the existing visual language (chunky purple cards, `styles.css`), no external requests.
- Quiz settings (defaults, inclusive ranges): questionCount 15 [5,50]; answerSeconds 30 [10,120]; maxPlayers 8 [2,12]; themes `string[]` (empty = all themes). Stored by the host in `localStorage` key `kg.quizSettings`.
- Points: ✅ 1, ½ 0.5, ❌ 0. Empty answer = ❌ without vote. Players don't vote on their own answer. Majority wins; tie → host decides; if the host is an author of the tied answer, the tie resolves to ½.
- Room links: `/quiz/<CODE>`; Pictionary links unchanged. `POST /api/rooms` accepts `{game: 'pictionary' | 'quiz'}`.
- Import format (also what Claude generates): `{"questions":[{"theme":string,"question":string,"answer":string,"variants":string[]}]}`; theme ≤ 40 chars, question ≤ 300, answer ≤ 100, ≤ 10 variants of ≤ 100 chars. Duplicate = same `normalize(question)`; duplicates are skipped on import and reported.

## Review Focus

1. A player refreshes during `answering` → their submitted answer and score are kept, they can still change it before the timer ends (Task 2 test `answer survives reconnect`).
2. A player disconnects during `voting` → voting completes without waiting for them (Task 2 test `disconnected voters are not awaited`).
3. Chosen themes hold fewer questions than `questionCount` → the game uses what exists; zero → start refused with error `no_questions` shown in the lobby (Task 3 tests).
4. Two answers that differ only by case/accents/spaces → one group, one vote, both authors credited (Task 1 test `groups by normalized text`).
5. Admin API without a valid cookie, or with a wrong password → 401, nothing written (Task 4 tests).

---

## File Structure

```
packages/shared/src/quiz/settings.ts     QuizSettings, DEFAULT_QUIZ_SETTINGS, QUIZ_RANGES, clampQuizSettings
packages/shared/src/quiz/grouping.ts     groupAnswers, resolveVotes, VoteValue
packages/shared/src/quiz/game.ts         QuizState, QuizEvent, quizReduce, Question
packages/shared/src/quiz/view.ts         QuizView, quizViewFor
packages/shared/src/quiz/import.ts       parseImport (validation + normalized dedupe key)
packages/shared/src/protocol.ts          (modify) quiz messages, state union, error codes
packages/shared/src/room.ts              (modify) GameKind = 'pictionary' | 'quiz'
packages/shared/test/quiz-*.test.ts
apps/worker/migrations/0001_init.sql     questions, words tables
apps/worker/src/games.ts                 GameAdapter for each kind
apps/worker/src/room-do.ts               (modify) use adapter, load questions/words from D1
apps/worker/src/questions.ts             D1 queries (pick, markUsed, themes, words)
apps/worker/src/admin.ts                 /api/admin/* handlers + cookie auth
apps/worker/src/index.ts                 (modify) routes: /api/themes, /api/admin/*
apps/worker/seed/questions-fr.json       first question set
apps/worker/scripts/seed.mjs             JSON → SQL for `wrangler d1 execute`
apps/worker/test/quiz.test.ts, admin.test.ts
apps/web/src/App.tsx, pages/Home.tsx     (modify) quiz routes and card
apps/web/src/pages/QuizRoom.tsx
apps/web/src/quiz/{QuizLobby,Answering,Reveal,Voting,QuestionResult,QuizGameOver}.tsx
apps/web/src/pages/Admin.tsx, src/admin/{Login,QuestionList,QuestionForm,ImportPanel,WordsPanel}.tsx
apps/web/e2e/quiz-game.py
```

---

### Task 1: Quiz settings, grouping and vote resolution

**Files:** Create `packages/shared/src/quiz/{settings.ts,grouping.ts}`; re-export from `src/index.ts`. Test: `packages/shared/test/quiz-rules.test.ts`.

**Interfaces — Produces:**
```ts
type QuizSettings = { questionCount: number; answerSeconds: number; maxPlayers: number; themes: string[] };
DEFAULT_QUIZ_SETTINGS; QUIZ_RANGES: Record<'questionCount'|'answerSeconds'|'maxPlayers', [number, number]>;
clampQuizSettings(input: unknown): QuizSettings      // like clampSettings: unknown keys dropped, numbers rounded+clamped, themes trimmed, deduped, ≤ 40 chars, ≤ 50 themes
type VoteValue = 'yes' | 'half' | 'no';
type AnswerGroup = { id: string; text: string; authors: string[] };     // text = first author's spelling, id = normalize(text)
groupAnswers(answers: Record<string, string>, order: string[]): AnswerGroup[]  // empty/whitespace answers excluded; groups ordered by first author in `order`
resolveVotes(votes: VoteValue[]): VoteValue | 'tie'  // majority = strictly most votes; equal top counts → 'tie'; no votes → 'tie'
```

- [ ] **Step 1: Write failing tests**: clamp defaults/ranges/types; **`groups by normalized text`**: `{A:'Napoléon', B:'napoleon ', C:'Napoléon III', D:'  '}` → 2 groups, first `{id:'napoleon', text:'Napoléon', authors:['A','B']}`, D absent; `resolveVotes(['yes','yes','no'])` → `yes`; `['yes','no']` → `tie`; `['half','half','yes']` → `half`; `[]` → `tie`.
- [ ] **Step 2: Run `pnpm --filter @kg/shared test` — FAIL**
- [ ] **Step 3: Implement** (use `normalize` from `text.ts`)
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(quiz): settings, answer grouping, vote resolution`

### Task 2: Quiz reducer and views

**Files:** Create `packages/shared/src/quiz/{game.ts,view.ts}`. Test: `packages/shared/test/quiz-game.test.ts`.

**Interfaces:**
- Consumes: Task 1, `Room`/`connectedPlayers` from `room.ts`.
- Produces:
```ts
type Question = { id: number; theme: string; question: string; answer: string; variants: string[] };
type QuizPhase = 'lobby' | 'answering' | 'revealing' | 'voting' | 'deciding' | 'result' | 'gameOver';
type QuizState = {
  phase: QuizPhase; settings: QuizSettings; questions: Question[]; index: number;   // index into questions
  answers: Record<string, string>;            // current question, by playerId
  groups: AnswerGroup[]; revealedCount: number; answerShown: boolean;
  votes: Record<string, Record<string, VoteValue>>;   // groupId → voterId → vote
  outcomes: Record<string, VoteValue>;                // groupId → resolved value
  questionPoints: Record<string, number>; scores: Record<string, number>;
  phaseEndsAt: number | null;
};
type QuizEvent =
  | { type: 'setSettings'; by: string; settings: unknown }
  | { type: 'start'; by: string; questions: Question[] }   // DO loads them first
  | { type: 'answer'; by: string; text: string }
  | { type: 'next'; by: string }                            // host: reveal next / show answer / open vote / next question
  | { type: 'vote'; by: string; groupId: string; vote: VoteValue }
  | { type: 'closeVote'; by: string }                        // host
  | { type: 'decide'; by: string; groupId: string; vote: VoteValue }  // host, deciding phase
  | { type: 'timeout' } | { type: 'playerJoined'; playerId: string } | { type: 'playerLeft'; playerId: string }
  | { type: 'restart'; by: string };
type QuizEffect = { type: 'state' };
type QuizCtx = { now: number; room: Room };
quizInitialState(settings?: QuizSettings): QuizState
quizReduce(s: QuizState, e: QuizEvent, ctx: QuizCtx): { state: QuizState; effects: QuizEffect[] }
type QuizView = {
  phase; settings; questionNumber: number; questionCount: number;
  question: { theme: string; text: string } | null;
  answered: string[];                       // playerIds who submitted a non-empty answer
  myAnswer: string | null;
  revealed: { groupId: string; text: string; authors: string[] }[];   // only the first revealedCount groups
  correct: { answer: string; variants: string[] } | null;             // only once answerShown
  myVotes: Record<string, VoteValue>; voteCounts: Record<string, Record<VoteValue, number>> | null; // counts only in deciding/result
  pendingVoters: string[];                  // connected players who still have groups to vote on (voting)
  ties: string[];                           // groupIds awaiting host decision (deciding)
  outcomes: Record<string, VoteValue>; questionPoints: Record<string, number>; scores: Record<string, number>;
  phaseEndsAt: number | null; serverNow: number;
};
quizViewFor(s: QuizState, viewerId: string, now: number): QuizView
```

Rules:
- Host-only: `setSettings` (lobby/gameOver), `start` (lobby, ≥ 2 connected, `questions.length ≥ 1`; uses `min(questionCount, questions.length)`), `next`, `closeVote`, `decide`, `restart` (gameOver → lobby, settings kept, scores cleared).
- `answering`: `phaseEndsAt = now + answerSeconds·1000`; `answer` by any connected player replaces their text (trimmed, ≤ 100 chars). Ends on `timeout` or when every connected player has a non-empty answer → `revealing` with `groups = groupAnswers(answers, playerOrder)` (player order = `ctx.room.players` order), `revealedCount 0`, `phaseEndsAt null`.
- `revealing`: each host `next` increments `revealedCount`; once `revealedCount === groups.length`, the next `next` sets `answerShown = true`; the next `next` → `voting`. With 0 groups: first `next` shows the answer, second → `result` (nothing to vote).
- `voting`: `vote` by a connected player on a group they did not author, any number of changes. Eligible voters for a group = connected players not in `authors`. When every eligible voter has voted on every group (or host `closeVote`): resolve each group with `resolveVotes`; a group with no eligible voters resolves to `'tie'`. Ties where the host is an author → `half`; other ties → `deciding` (if any), else → `result`.
- `deciding`: host `decide` per tied group; when none left → `result`.
- Entering `result`: each author of a group gets 1 / 0.5 / 0 per outcome into `questionPoints` and `scores`.
- `result` + host `next` → next question (`answering`, answers/votes/groups cleared) or `gameOver` after the last.
- `playerLeft`: in `answering`, re-check "everyone answered"; in `voting`, re-check completion. `playerJoined` mid-game: score 0, can answer from the current question if still `answering`.
- Host disconnected and another player is host (room logic already transfers host) — no special case.
- View secrecy: `answers` text of others never in the view; `myAnswer` only own; `revealed` sliced; `correct` null until `answerShown`; vote counts hidden during `voting` (only `myVotes`).

- [ ] **Step 1: Write failing tests** (room of A host, B, C): start by B ignored; start with 0 questions ignored; full flow on 2 questions → `gameOver` with expected scores; answering ends early when all answered; **`answer survives reconnect`**: B answers, `playerLeft B` then `playerJoined B` → B's `myAnswer` kept and still editable; views during answering: A's view has no text of B's answer (`JSON.stringify` check), `correct` null for host A; reveal step-by-step counts; identical answers share one group; **`disconnected voters are not awaited`**: C leaves during voting, A and B votes complete it; tie on a group authored by host A → `half` without `deciding`; tie on B's group → `deciding`, `decide` by B ignored, by A resolves; empty answer gets 0 and no group; `closeVote` with missing votes resolves on cast votes; stale `timeout` ignored; restart keeps settings.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** (keep `game.ts` readable with named phase helpers)
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(quiz): game reducer and per-player views`

### Task 3: Protocol, D1 and game-agnostic RoomDO

**Files:**
- Modify: `packages/shared/src/protocol.ts`, `packages/shared/src/room.ts`
- Create: `packages/shared/src/quiz/import.ts`, `apps/worker/migrations/0001_init.sql`, `apps/worker/src/{games.ts,questions.ts}`, `apps/worker/.dev.vars.example`
- Modify: `apps/worker/src/room-do.ts`, `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`, `apps/worker/vitest.config.ts` (apply D1 migrations in tests)
- Test: `apps/worker/test/quiz.test.ts`, `packages/shared/test/quiz-import.test.ts`

**Interfaces:**
- Produces:
```ts
// room.ts
type GameKind = 'pictionary' | 'quiz';   // Room.game: GameKind; createRoom(code, game: GameKind)
// protocol.ts — ClientMsg adds:
| { t: 'answer'; text: string } | { t: 'next' } | { t: 'vote'; groupId: string; vote: VoteValue }
| { t: 'closeVote' } | { t: 'decide'; groupId: string; vote: VoteValue }
// ServerMsg 'state' becomes a union on `kind`:
| { t: 'state'; kind: 'pictionary'; players; hostId; ownerId; game: PictionaryView }
| { t: 'state'; kind: 'quiz'; players; hostId; ownerId; game: QuizView }
// ErrorCode adds 'no_questions' (sent to the host only, socket stays open)
// import.ts
type ImportedQuestion = Omit<Question, 'id'>;
parseImport(json: unknown): { ok: ImportedQuestion[]; errors: { index: number; reason: string }[] }  // limits from Global Constraints
questionKey(q: string): string     // normalize(q), used as dedupe key
```
- `0001_init.sql`: `questions(id INTEGER PRIMARY KEY, theme TEXT NOT NULL, question TEXT NOT NULL, question_key TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, variants TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manuel', created_at INTEGER NOT NULL, last_used_at INTEGER)`, index on `theme`; `words(word TEXT PRIMARY KEY)`.
- `questions.ts`: `pickQuestions(db, themes: string[], n: number): Promise<Question[]>` (themes empty = all; order `last_used_at IS NULL DESC, last_used_at ASC, random()`), `markUsed(db, ids: number[], now)`, `listThemes(db): Promise<{ theme: string; count: number }[]>`, `loadWords(db): Promise<string[]>`.
- `games.ts`: a `GameAdapter` per kind exposing `initial()`, `maxPlayers(state)`, `reduce(state, event, ctx)`, `view(state, playerId, now, room)`, `toEvent(msg, playerId)` (null if the message doesn't belong to that game). RoomDO uses only the adapter; Pictionary behaviour and tests unchanged. Pictionary words: `loadWords(DB)` at `start`, falling back to `DEFAULT_WORDS` when the table is empty; quiz `start`: DO calls `pickQuestions(settings.themes, settings.questionCount)`, sends `no_questions` to the host if empty, else reduces `start` with them and `markUsed`.
- HTTP: `GET /api/themes` → `[{theme, count}]`. `POST /api/rooms` accepts `quiz`.

- [ ] **Step 1: Write failing tests**: `parseImport` accepts the documented format, rejects over-limit fields with indexed reasons, trims; worker: `POST /api/rooms {game:'quiz'}` → 201; seed 3 questions via D1, two sockets hello → `state` with `kind:'quiz'`; host start → `answering` with a question; guesser's frames never contain the other player's answer text or the correct answer before `answerShown`; `no_questions` when the selected theme is empty (socket stays open, phase stays lobby); **fewer questions than questionCount** → `questionCount` in view = available count; `GET /api/themes` counts; `markUsed` sets `last_used_at`; all existing pictionary worker tests still pass.
- [ ] **Step 2: Run `pnpm --filter worker test` and `pnpm --filter @kg/shared test` — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(worker): quiz rooms, D1 questions, game adapters`

### Task 4: Admin API

**Files:** Create `apps/worker/src/admin.ts`; modify `apps/worker/src/index.ts`. Test: `apps/worker/test/admin.test.ts`.

**Interfaces — Produces** (all JSON; all except login require cookie `kg_admin`):
- `POST /api/admin/login {password}` → 204 + `Set-Cookie: kg_admin=<exp>.<hmac>; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=2592000` (HMAC-SHA256 of `exp` with `ADMIN_SECRET`, constant-time compare of password); wrong password → 401. `POST /api/admin/logout` → clears cookie. `GET /api/admin/me` → 204 or 401.
- `GET /api/admin/questions?theme=&q=&page=1` → `{ items: (Question & {source, createdAt, lastUsedAt})[], total, page, pageSize: 50 }` (q = substring on question/answer, case-insensitive).
- `POST /api/admin/questions` (one `ImportedQuestion`) → 201 `{id}`; 409 on duplicate key; 400 on invalid. `PUT /api/admin/questions/:id` → 200; `DELETE /api/admin/questions/:id` → 204.
- `POST /api/admin/import {questions:[...], source?: 'manuel'|'généré'}` → `{ inserted, duplicates: number, errors }` (uses `parseImport`, batch inserts with `INSERT OR IGNORE`).
- `GET /api/admin/export` → the import format with every question.
- `GET /api/admin/words` → `{words}`; `PUT /api/admin/words {words: string[]}` replaces the list (trimmed, deduped by `normalize`, ≤ 30 chars, ≤ 5000 words).
- Mutating admin routes require header `Content-Type: application/json` (CSRF guard with SameSite=Strict).

- [ ] **Step 1: Write failing tests**: every admin route → 401 without cookie, nothing written; wrong password 401; login → cookie → CRUD round trip; tampered or expired cookie → 401; duplicate create → 409; import with 2 valid + 1 duplicate + 1 invalid → `{inserted:2, duplicates:1, errors:[{index:3,…}]}`; export round-trips through import (0 inserted, all duplicates); words PUT/GET; search `q` and `theme` filters; pagination.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** (Web Crypto `crypto.subtle` for HMAC)
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(worker): admin API for questions and words`

### Task 5: Web — quiz routing, home and lobby

**Files:** Modify `apps/web/src/App.tsx`, `src/pages/Home.tsx`, `src/lib/socket.ts` (state union), `src/pages/PictionaryRoom.tsx` (narrow on `kind`). Create `src/pages/QuizRoom.tsx`, `src/quiz/QuizLobby.tsx`.

**Interfaces:**
- Consumes: Task 3 protocol, `GET /api/themes`, `clampQuizSettings`, `QUIZ_RANGES`.
- `useRoomSocket` returns `state: StateMsg | null` where `StateMsg` is the union; each room page ignores/flags a state of the wrong `kind` (« Cette salle n'est pas une salle de quiz » with a link to the right page).
- Home: quiz card enabled (« Créer une salle » → `POST /api/rooms {game:'quiz'}` → `/quiz/<code>`); the join field detects the game via `GET /api/rooms/:code` and navigates to the right path.
- QuizLobby: same layout/style as the Pictionary lobby (code tiles, « Copier le lien », players, « Lancer la partie »); settings: questionCount, answerSeconds, maxPlayers (number fields bounded by `QUIZ_RANGES`), themes as toggle chips from `/api/themes` with counts (« Tous les thèmes » chip = empty list), total available questions shown; host-only editing; host settings flow identical to Pictionary (`kg.quizSettings`, sent once on lobby entry by the owner only, debounced edits). `error no_questions` → banner « Aucune question dans ces thèmes. Ajoute-en depuis la page admin. »
- Non-lobby phases: placeholder « Partie en cours… » + scoreboard (Task 6 replaces).

- [ ] **Step 1: Write failing unit test** (`apps/web/test/quiz-settings-storage.test.ts`): saving/loading `kg.quizSettings` round-trips through `clampQuizSettings`; corrupted JSON → defaults
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: `pnpm --filter web test` PASS, `pnpm --filter web build` PASS; existing pictionary e2e scripts still ALL OK**
- [ ] **Step 5: Commit** `feat(web): quiz rooms, home card and lobby`

### Task 6: Web — quiz game screens

**Files:** Create `apps/web/src/quiz/{Answering,Reveal,Voting,QuestionResult,QuizGameOver}.tsx`; modify `src/pages/QuizRoom.tsx`, `src/styles.css`. Create `apps/web/e2e/quiz-game.py`.

Layout: players/scores card left, main "notebook" card centre (same frame as the Pictionary notebook: header band with the theme as label, « QUESTION 3/15 » and the round timer badge).
- **Answering**: question in big type; input « Ta réponse… » (max 100, Enter submits, can be changed — button « Modifier » after submit, shows « Réponse envoyée ✓ »); players list shows a check next to who answered; timer.
- **Reveal**: answer cards appear one by one (flip/slide-in animation, reduced-motion safe) with the author names; host button « Suivant » (« Montrer la réponse » on the last, then « Passer au vote »); others see « {hôte} fait défiler les réponses… ». When `correct` is set: big green « Bonne réponse : … » card with variants listed small (« Aussi accepté : … »).
- **Voting**: correct answer pinned at top; one card per group with ✅ / ½ / ❌ buttons (own groups show « Ta réponse » and no buttons); chosen button highlighted; « En attente de : … » list from `pendingVoters`; host button « Terminer le vote ».
- **Deciding**: host sees tied cards with the three buttons and « Égalité — à toi de trancher »; others see « {hôte} tranche les égalités… ».
- **QuestionResult**: each group with its outcome badge and points (+1, +0,5, +0), then scoreboard sorted; host « Question suivante » / « Voir le classement » on the last.
- **QuizGameOver**: same podium component style as the Pictionary GameOver (reuse it if it can take `scores` + names), « Rejouer » (host) / « Accueil ».

- [ ] **Step 1: Implement**
- [ ] **Step 2: Write and run `apps/web/e2e/quiz-game.py`** (3 players, 2 questions seeded through the admin import API with a test password in `.dev.vars`): answers hidden from others during answering (DOM text check); identical answers grouped; reveal one by one; nobody sees the correct answer before « Montrer la réponse »; votes, a tie decided by the host; scores match; game over → Rejouer → lobby. Screenshots of each phase to `/home/claude/out/quiz-*.png`. Also re-run both Pictionary e2e scripts.
- [ ] **Step 3: Commit** `feat(web): quiz game screens`

### Task 7: Web — admin page

**Files:** Create `apps/web/src/pages/Admin.tsx`, `src/admin/{Login,QuestionList,QuestionForm,ImportPanel,WordsPanel}.tsx`, `src/admin/api.ts`; modify `App.tsx` (`/admin`).

- **Login** (password field, « Se connecter »; errors « Mot de passe incorrect »). `GET /api/admin/me` decides login vs dashboard; « Se déconnecter ».
- **Questions tab**: search box, theme filter (from `/api/themes`), paginated table (thème, question, réponse, variantes, source, dernière utilisation), inline « Modifier » (form: thème with `<datalist>` autocomplete, question, réponse, variantes one per line) and « Supprimer » (confirm with an in-page confirmation, not `window.confirm`), « + Ajouter une question ».
- **Import tab**: choose a `.json` file or paste JSON → client-side `parseImport` preview (count valid, list errors) → « Importer » → shows inserted/duplicates/errors; « Exporter la banque » downloads `questions-<date>.json`.
- **Mots du Pictionary tab**: textarea (one word per line) with count, « Enregistrer ».
- Same visual language; desktop layout.

- [ ] **Step 1: Write failing unit test** `apps/web/test/admin-api.test.ts`: `api.ts` sends `Content-Type: application/json` on mutations and maps 401 to `{ unauthorized: true }` (fetch mocked)
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: PASS; `pnpm --filter web build`; quick Playwright check (login, add, edit, delete, import a 2-question file, export) with screenshots `/home/claude/out/admin-*.png`**
- [ ] **Step 5: Commit** `feat(web): admin page`

### Task 8: Content, seed scripts and docs

**Files:** Create `apps/worker/seed/questions-fr.json`, `apps/worker/scripts/seed.mjs`; modify `apps/worker/package.json` (scripts `db:migrate:local`, `db:migrate:remote`, `seed:local`, `seed:remote`), `README.md`, `.gitignore` (`.dev.vars`).

- `questions-fr.json`: **200 questions**, 20 per theme: Géographie, Histoire, Sciences, Nature & animaux, Cinéma & séries, Musique, Sport, Jeux vidéo, Littérature & BD, Cuisine & gastronomie. Mixed difficulty (about 1/3 easy, 1/2 medium, 1/6 hard), short unambiguous answers (≤ 4 words ideally), sensible variants (spellings, with/without article, abbreviations), French-speaking audience in 2026, no questions whose answer may have changed recently (no "current" office holders, records likely broken, etc.). Each answer must be factually verified. Source `généré`.
- `seed.mjs`: reads a questions JSON (default the seed file) and the default words (`DEFAULT_WORDS` JSON), validates with the same limits as `parseImport`, writes SQL with `INSERT OR IGNORE` (escaped) to a temp file, then runs `wrangler d1 execute kgames --local|--remote --file <tmp>`.
- README: D1 creation (`wrangler d1 create kgames`, paste the id in `wrangler.jsonc`), migrations, secrets (`wrangler secret put ADMIN_PASSWORD` / `ADMIN_SECRET`), `.dev.vars` for local, seeding, the admin page, the import format (for Claude-generated files), quiz rules summary.

- [ ] **Step 1: Write `seed.mjs` + a test** (`apps/worker/test/seed.test.ts` or a node test) that the SQL generator escapes quotes and skips invalid entries
- [ ] **Step 2: Write the 200 questions**; run `parseImport` on the file (0 errors, 200 unique keys, 20 per theme)
- [ ] **Step 3: Fact-check pass**: re-verify every answer (a separate careful pass, web search where unsure); fix or replace doubtful ones
- [ ] **Step 4: `pnpm --filter worker run db:migrate:local && pnpm --filter worker run seed:local`, then play one quiz round via `quiz-game.py` against the seeded DB**
- [ ] **Step 5: README + commit** `feat: first question set, seed scripts, docs`
