# Socle + Pictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable site where friends create a room, share a code, and play the Pictionary described in the spec (rich drawing tools with undo/redo, hidden correct/close guesses, drawer-chosen hint letters, every setting configurable).

**Architecture:** pnpm monorepo. All game rules live in `packages/shared` as pure, unit-tested functions (a reducer per game plus per-player view filters). A Cloudflare Worker routes HTTP and hands each room's WebSocket to one Durable Object (`RoomDO`), which runs the reducer, persists state, sets alarms for timers and sends each player a filtered view. A React + Vite front, served by the same Worker as static assets, renders the views and the canvas.

**Tech Stack:** TypeScript, pnpm workspaces, Cloudflare Workers + Durable Objects (SQLite-backed, WebSocket Hibernation API), Workers Static Assets, React 19 + Vite, Vitest (+ `@cloudflare/vitest-pool-workers` for the worker).

**Spec:** `docs/superpowers/specs/2026-11-19-kgames-design.md` (sections 1–7, 9–11). Quiz (§8), D1 and admin are a later plan.

## Global Constraints

- Free Cloudflare plan only; Durable Objects must be SQLite-backed (`new_sqlite_classes` migration).
- All UI copy in French. Correct-guess system message: `« {nom} a trouvé ! »`. Close-guess private notice: `« tu chauffes ! »`.
- No accounts: pseudo + token in `localStorage` (keys `kg.name`, `kg.token`, `kg.pictionarySettings`).
- Room code: 5 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O). Direct link: `/pictionary/<CODE>`.
- Canvas logical size 800×600, white background; eraser paints `#ffffff`.
- Secrets never leave the server to players who shouldn't see them: the word goes only to the drawer, players who found it, and everyone after the turn ends; word choices only to the drawer; correct and close guesses are never broadcast.
- Settings (defaults, inclusive ranges): rounds 3 [1,10]; drawSeconds 80 [30,240]; chooseSeconds 15 [5,30]; wordChoices 3 [1,5]; maxHints 2 [0,5]; hintUnlockPct 67 [0,100]; closeDetection true; maxPlayers 8 [2,12]; customWords []; customWordsMode `'mixed'` | `'only'`.
- Deviation from spec §5, Claude's call: the front is served by Workers Static Assets instead of Pages (same free tier, one deploy, same origin for the WebSocket).
- Phase 1 word list is a bundled JSON file (`packages/shared/src/pictionary/words-fr.json`); D1 arrives with the quiz plan.

## Review Focus

1. A player refreshes mid-turn → same seat, same score, full drawing history replayed (Task 7 test `reconnect restores seat and drawing`).
2. Guess typed with different case, accents, hyphens or extra spaces (`"ARC EN  ciel"` for `arc-en-ciel`, `"elephant"` for `éléphant`) → counted correct (Task 1 tests).
3. The drawer disconnects mid-turn → the turn ends, the game continues with the next drawer (Task 6 test `drawer leaving ends the turn`).
4. The host leaves the lobby → the next connected player becomes host and can change settings and start (Task 4 test `host transfers on leave`).
5. A non-drawer sends draw/undo/reveal messages, or a player who already found keeps typing → ignored, nothing leaks (Task 6 tests `non-drawer cannot draw or reveal`, `finder guesses are ignored`).

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, README.md
packages/shared/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                     re-exports
  src/text.ts                      normalize, levenshtein, classifyGuess
  src/room.ts                      players, host, join/leave, room codes
  src/protocol.ts                  ClientMsg / ServerMsg unions
  src/pictionary/settings.ts       PictionarySettings, DEFAULT_SETTINGS, clampSettings
  src/pictionary/scoring.ts        guesserPoints, drawerPoints
  src/pictionary/hints.ts          maskWord, canReveal
  src/pictionary/drawing.ts        DrawAction, DrawingHistory ops
  src/pictionary/game.ts           PictionaryState, reduce
  src/pictionary/view.ts           PictionaryView, viewFor
  src/pictionary/words-fr.json     default words
  test/*.test.ts
apps/worker/
  package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts
  src/index.ts                     fetch router
  src/room-do.ts                   RoomDO
  test/room.test.ts
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx, src/App.tsx, src/styles.css
  src/lib/identity.ts, src/lib/socket.ts
  src/pages/Home.tsx, src/pages/PictionaryRoom.tsx
  src/pictionary/Lobby.tsx, Toolbar.tsx, DrawingCanvas.tsx, renderer.ts,
                 WordBar.tsx, Chat.tsx, Scoreboard.tsx, Timer.tsx,
                 WordChoice.tsx, TurnEnd.tsx, GameOver.tsx
  test/renderer.test.ts
```

---

### Task 1: Monorepo scaffold + text matching

**Files:**
- Create: root `package.json` (scripts `test`, `build`, `dev`, `deploy` delegating with `pnpm -r`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, ES2022, `moduleResolution: bundler`), `.gitignore`
- Create: `packages/shared/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/text.ts}`
- Test: `packages/shared/test/text.test.ts`

**Interfaces:**
- Produces: `normalize(s: string): string`, `levenshtein(a: string, b: string): number`, `classifyGuess(guess: string, word: string, closeDetection: boolean): 'correct' | 'close' | 'wrong'`. Package name `@kg/shared`, consumed as TS source (`"main": "src/index.ts"`).

- [ ] **Step 1: `git init`, create the scaffold, `pnpm install` (vitest, typescript as root dev deps)**
- [ ] **Step 2: Write the failing tests**

```ts
expect(normalize('  ARC-en  Ciel ')).toBe('arc en ciel');
expect(normalize('Éléphant')).toBe('elephant');
expect(normalize("L’œuf")).toBe('l oeuf');
expect(classifyGuess('ARC EN  ciel', 'arc-en-ciel', true)).toBe('correct');
expect(classifyGuess('elephant', 'éléphant', true)).toBe('correct');
expect(classifyGuess('chta', 'chat', true)).toBe('wrong');          // distance 2, len < 8
expect(classifyGuess('chot', 'chat', true)).toBe('close');          // distance 1, len < 8
expect(classifyGuess('chien', 'chat', true)).toBe('wrong');
expect(classifyGuess('telephonne', 'téléphone', true)).toBe('close'); // distance 1
expect(classifyGuess('tlephonne', 'téléphone', true)).toBe('close');  // distance 2, len ≥ 8
expect(classifyGuess('chot', 'chat', false)).toBe('wrong');
expect(classifyGuess('', 'chat', true)).toBe('wrong');
```

- [ ] **Step 3: Run `pnpm --filter @kg/shared test` — expect FAIL (module not found)**
- [ ] **Step 4: Implement `src/text.ts`**: normalize = lowercase → `œ→oe`, `æ→ae` → NFD and strip `\p{M}` → replace `[-'’_]` with space → collapse whitespace → trim. Close threshold: 1 if normalized word length < 8, else 2; distance 0 is `correct`.
- [ ] **Step 5: Run tests — expect PASS**
- [ ] **Step 6: Commit** `feat: monorepo scaffold and guess matching`

### Task 2: Pictionary settings, scoring, hints

**Files:**
- Create: `packages/shared/src/pictionary/{settings.ts,scoring.ts,hints.ts}`
- Test: `packages/shared/test/pictionary-rules.test.ts`

**Interfaces:**
- Produces:
  - `type PictionarySettings = { rounds; drawSeconds; chooseSeconds; wordChoices; maxHints; hintUnlockPct: number; closeDetection: boolean; maxPlayers: number; customWords: string[]; customWordsMode: 'mixed' | 'only' }`, `DEFAULT_SETTINGS`, `SETTING_RANGES: Record<numeric key, [min, max]>`, `clampSettings(input: unknown): PictionarySettings` (unknown keys dropped, numbers rounded and clamped, wrong types → default, customWords trimmed, deduped, empty removed, each ≤ 30 chars, max 500 words).
  - `guesserPoints(elapsedMs: number, drawMs: number, isFirst: boolean): number`, `drawerPoints(foundCount: number, guesserCount: number): number`.
  - `maskWord(word: string, revealed: number[]): string[]`, `isLetterIndex(word: string, i: number): boolean`, `hintsUnlocked(elapsedMs: number, drawMs: number, unlockPct: number): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
expect(clampSettings({ rounds: 99, drawSeconds: 5, maxHints: -1 })).toMatchObject({ rounds: 10, drawSeconds: 30, maxHints: 0 });
expect(clampSettings({ rounds: 'x' }).rounds).toBe(3);
expect(clampSettings({ customWords: [' chat ', 'chat', '', 'chien'] }).customWords).toEqual(['chat', 'chien']);
expect(guesserPoints(0, 80000, false)).toBe(100);
expect(guesserPoints(80000, 80000, false)).toBe(20);
expect(guesserPoints(40000, 80000, true)).toBe(70);   // 60 + 10 first bonus
expect(drawerPoints(3, 3)).toBe(100);
expect(drawerPoints(1, 3)).toBe(33);
expect(drawerPoints(0, 0)).toBe(0);
expect(maskWord('arc-en ciel', [])).toEqual(['_','_','_','-','_','_',' ','_','_','_','_']);
expect(maskWord('chat', [2])).toEqual(['_','_','a','_']);
expect(isLetterIndex('arc-en', 3)).toBe(false);
expect(hintsUnlocked(53000, 80000, 67)).toBe(false);
expect(hintsUnlocked(53600, 80000, 67)).toBe(true);
expect(hintsUnlocked(0, 80000, 0)).toBe(true);
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** `guesserPoints = round(20 + 80 × max(0, 1 − elapsed/drawMs)) + (isFirst ? 10 : 0)`. `drawerPoints = guesserCount === 0 ? 0 : round(100 × found/guesserCount)`. Mask keeps space, `-`, `'`, `’` visible; every other char hidden as `_` unless revealed.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: pictionary settings, scoring and hints`

### Task 3: Drawing history

**Files:**
- Create: `packages/shared/src/pictionary/drawing.ts`
- Test: `packages/shared/test/drawing.test.ts`

**Interfaces:**
- Produces:

```ts
type Point = [number, number];            // logical coords, 0..800 × 0..600, rounded to 1 decimal
type DrawAction =
  | { id: string; kind: 'stroke'; tool: 'pen' | 'eraser'; color: string; size: number; opacity: number; points: Point[] }
  | { id: string; kind: 'line' | 'rect' | 'ellipse'; color: string; size: number; opacity: number; filled: boolean; from: Point; to: Point }
  | { id: string; kind: 'fill'; color: string; opacity: number; at: Point }
  | { id: string; kind: 'clear' };
type DrawingHistory = { actions: DrawAction[]; redo: DrawAction[] };
emptyHistory(): DrawingHistory
addAction(h, a: DrawAction): DrawingHistory          // clears redo
appendPoints(h, id: string, pts: Point[]): DrawingHistory   // only if last action is that stroke
undo(h): DrawingHistory
redo(h): DrawingHistory
isValidAction(a: unknown): a is DrawAction           // shape/type check, size 1..80, opacity 0..1, color /^#[0-9a-f]{6}$/i, coords clamped range
```

- [ ] **Step 1: Write failing tests**: add two actions → undo → `actions.length === 1`, `redo.length === 1` → redo restores order; add after undo empties `redo`; undo on empty is a no-op; `appendPoints` on a non-last or non-stroke id is a no-op; `clear` is an action and is undoable (undo after clear brings back previous actions); `isValidAction` rejects `{kind:'stroke', color:'red'}` and size 500.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** (immutable updates).
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: drawing history with undo/redo`

### Task 4: Room logic

**Files:**
- Create: `packages/shared/src/room.ts`
- Test: `packages/shared/test/room.test.ts`

**Interfaces:**
- Produces:

```ts
type Player = { id: string; name: string; connected: boolean; joinedAt: number };
type Room = { code: string; game: 'pictionary'; hostId: string | null; players: Player[]; tokens: Record<string, string> /* token → playerId, server-only */ };
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
generateCode(rng: () => number): string                      // 5 chars
createRoom(code: string, game: 'pictionary'): Room
joinRoom(room, token: string, name: string, now: number, maxPlayers: number):
  { ok: true; room: Room; playerId: string; rejoined: boolean } | { ok: false; error: 'room_full' | 'bad_name' }
disconnect(room, playerId: string): Room                    // connected=false, host transfer
connectedPlayers(room): Player[]
```
Name: trimmed, 1–20 chars, else `bad_name`. Rejoin with a known token reuses the player (name updated, connected=true) and ignores `maxPlayers`. New playerId = random 8-char id (pass via a `newId()` param or crypto.randomUUID slice — implementer's choice, but deterministic in tests). Host = first player; on host disconnect, host becomes the earliest-joined connected player, or `null` if none; a rejoining player becomes host when `hostId` is `null`.

- [ ] **Step 1: Write failing tests**: `generateCode` returns 5 chars all in alphabet; join two players → first is host; **`host transfers on leave`**: disconnect host → second becomes host; disconnect all → `hostId null`; reconnect with same token → same `playerId`, `rejoined: true`; ninth new player with maxPlayers 8 → `room_full`; full room still lets a known token rejoin; name `'   '` → `bad_name`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: room membership and host transfer`

### Task 5: Pictionary game — turn flow

**Files:**
- Create: `packages/shared/src/pictionary/game.ts`, `packages/shared/src/pictionary/words-fr.json` (≥ 300 common French nouns/expressions, mixed difficulty, lowercase with accents)
- Test: `packages/shared/test/game-flow.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```ts
type Phase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameOver';
type ChatEntry = { id: number; kind: 'guess' | 'system'; playerId?: string; text: string };
type PictionaryState = {
  phase: Phase; settings: PictionarySettings;
  turnOrder: string[]; turnIndex: number; round: number;           // round 1-based
  drawerId: string | null; wordChoices: string[]; word: string | null;
  phaseEndsAt: number | null; drawStartedAt: number | null;
  found: { playerId: string; at: number }[]; revealed: number[];
  scores: Record<string, number>; turnPoints: Record<string, number>;
  history: DrawingHistory; chat: ChatEntry[]; nextChatId: number; usedWords: string[];
};
type GameEvent =
  | { type: 'setSettings'; by: string; settings: unknown }
  | { type: 'start'; by: string }
  | { type: 'chooseWord'; by: string; index: number }
  | { type: 'guess'; by: string; text: string }
  | { type: 'revealLetter'; by: string; index: number }
  | { type: 'draw'; by: string; op: DrawOp }
  | { type: 'timeout' }
  | { type: 'playerJoined'; playerId: string }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'restart'; by: string };
type DrawOp = { op: 'add'; action: DrawAction } | { op: 'append'; id: string; points: Point[] } | { op: 'undo' } | { op: 'redo' };
type Effect =
  | { type: 'state' }                                          // re-send views to everyone
  | { type: 'draw'; op: DrawOp }                               // relay to all except drawer
  | { type: 'private'; to: string; notice: 'close' | 'correct' };
type Ctx = { now: number; rng: () => number; room: Room; words: string[] };
initialState(settings?: PictionarySettings): PictionaryState
reduce(state: PictionaryState, event: GameEvent, ctx: Ctx): { state: PictionaryState; effects: Effect[] }
TURN_END_MS = 5000
```

Rules for this task (guessing/hints/drawing in Task 6):
- `setSettings`/`start`/`restart`: host only (`ctx.room.hostId`), `setSettings` only in `lobby`/`gameOver`; `start` needs ≥ 2 connected players. Start: `turnOrder` = connected players by `joinedAt`, scores reset, `round 1`, first turn begins.
- Turn begin → `choosing`: drawer = `turnOrder[turnIndex]` (skip disconnected), `wordChoices` = `settings.wordChoices` distinct words not in `usedWords` from the pool (`only` → customWords, falls back to default list if fewer than `wordChoices` custom words; `mixed` → default ∪ custom), `phaseEndsAt = now + chooseSeconds·1000`, history emptied, `found`/`revealed` cleared.
- `chooseWord` (drawer only, in `choosing`) or `timeout` in `choosing` (random choice) → `drawing`, `drawStartedAt = now`, `phaseEndsAt = now + drawSeconds·1000`.
- `timeout` in `drawing` → turn end. Turn end: drawer gets `drawerPoints`, `turnPoints` filled, system chat `« Le mot était : {mot} »`, phase `turnEnd`, `phaseEndsAt = now + TURN_END_MS`.
- `timeout` in `turnEnd` → next index; past the end of `turnOrder` → `round + 1`; past `settings.rounds` → `gameOver` (`phaseEndsAt null`).
- `playerJoined` during a game → appended to `turnOrder`, score 0. `playerLeft` of the drawer in `choosing`/`drawing` → turn ends immediately. Fewer than 2 connected players during a game → `gameOver`.
- `timeout` events whose `ctx.now < phaseEndsAt` are ignored (stale alarms).
- Every state change returns a `{type:'state'}` effect.

- [ ] **Step 1: Write failing tests** (helper builds a room of 3 players A,B,C and `ctx` with seeded rng): start by non-host ignored; start with 1 player ignored; start → `choosing`, drawer A, 3 choices; `chooseWord` by B ignored; A chooses → `drawing` with `phaseEndsAt = now + 80000`; choosing timeout picks a word; drawing timeout → `turnEnd`, word in system chat; full loop with `rounds: 1` → after 3 turns `gameOver`; **`drawer leaving ends the turn`**: `playerLeft A` during drawing → `turnEnd`, then next drawer is B; stale `timeout` ignored; `only` mode with 1 custom word and `wordChoices 3` uses the default list; settings changed in lobby persist into `restart`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement `reduce` for these events** (other events return state unchanged for now)
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: pictionary turn flow`

### Task 6: Pictionary game — guessing, hints, drawing, views

**Files:**
- Modify: `packages/shared/src/pictionary/game.ts`
- Create: `packages/shared/src/pictionary/view.ts`
- Test: `packages/shared/test/game-play.test.ts`

**Interfaces:**
- Produces:

```ts
type PictionaryView = {
  phase: Phase; settings: PictionarySettings; round: number; drawerId: string | null;
  isDrawer: boolean; hasFound: boolean;
  word: string | null;            // only drawer / found / turnEnd / gameOver
  mask: string[] | null;          // for everyone during drawing (drawer too, to show revealed slots)
  revealed: number[]; hintsLeft: number;
  wordChoices: string[] | null;   // drawer only, choosing only
  phaseEndsAt: number | null; drawStartedAt: number | null; serverNow: number;
  found: string[]; scores: Record<string, number>; turnPoints: Record<string, number>;
  history: DrawingHistory; chat: ChatEntry[]; turnOrder: string[];
};
viewFor(state: PictionaryState, viewerId: string, now: number): PictionaryView
```

Rules:
- `guess` (in `drawing`, by a connected non-drawer who hasn't found; text trimmed, 1–100 chars): `correct` → push `found`, add `guesserPoints` (first bonus if `found` was empty), system chat `« {nom} a trouvé ! »`, private `correct`; `close` → private `close` only, nothing in chat; `wrong` → chat entry kind `guess`. All connected non-drawers found → turn end.
- `revealLetter` (drawer, `drawing`, `hintsUnlocked(now − drawStartedAt, …)`, `revealed.length < maxHints`, `isLetterIndex`, not already revealed) → push index.
- `draw` (drawer, `drawing`, `isValidAction` for `add`) → update history, effect `{type:'draw', op}` (no `state` effect). Stroke `append` max 200 points per message.
- Chat keeps the last 100 entries.

- [ ] **Step 1: Write failing tests**: correct guess → scores B > 0, chat has `« B a trouvé ! »` and no entry containing the word; close guess → no chat entry, private `close` to B only; wrong guess appears in chat; **`finder guesses are ignored`**: B guesses again after finding → state unchanged; all guessers found → `turnEnd`; **`non-drawer cannot draw or reveal`**: B sends `draw add` and `revealLetter` → no change; A reveals before unlock → ignored, after unlock → `revealed [i]`, a 3rd reveal with maxHints 2 → ignored, reveal on a `-` index → ignored; `viewFor` B during drawing → `word null`, `mask` has `_`, `wordChoices null`; `viewFor` B after finding → `word` set; `viewFor` A during choosing → `wordChoices` length 3, B → `null`; `draw` returns only a `draw` effect.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run all shared tests — expect PASS**
- [ ] **Step 5: Commit** `feat: pictionary guessing, hints, drawing and views`

### Task 7: Protocol, Worker and RoomDO

**Files:**
- Create: `packages/shared/src/protocol.ts`
- Create: `apps/worker/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.ts,src/index.ts,src/room-do.ts}`
- Test: `apps/worker/test/room.test.ts`

**Interfaces:**
- Produces:

```ts
// protocol.ts
type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | { t: 'settings'; settings: unknown } | { t: 'start' } | { t: 'restart' }
  | { t: 'choose'; index: number } | { t: 'guess'; text: string } | { t: 'reveal'; index: number }
  | { t: 'draw'; op: DrawOp };
type ServerMsg =
  | { t: 'welcome'; playerId: string }
  | { t: 'state'; players: { id: string; name: string; connected: boolean }[]; hostId: string | null; game: PictionaryView }
  | { t: 'draw'; op: DrawOp }
  | { t: 'notice'; notice: 'close' | 'correct' }
  | { t: 'error'; code: 'room_full' | 'bad_name' | 'not_found' | 'bad_message' };
parseClientMsg(raw: string): ClientMsg | null
```
- HTTP: `POST /api/rooms` body `{game:'pictionary'}` → `201 {code}` (Worker generates a code, calls DO `POST /init`; DO answers 409 if already initialised → retry up to 5 times). `GET /api/rooms/:code` → `200 {game}` or `404`. `GET /api/rooms/:code/ws` (Upgrade) → forwarded to DO; DO not initialised → close with `not_found`. DO id: `idFromName(code)`. Everything else → static assets with SPA fallback (`assets.not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`).
- RoomDO: WebSocket Hibernation (`ctx.acceptWebSocket`, `serializeAttachment({playerId})`). Persist `{room, game}` under storage key `state` after every event. After each reduce: `setAlarm(phaseEndsAt)` if set; when no player is connected, alarm at `now + 10 min` → `deleteAll()`. Effects: `state` → send each socket its own `state` message; `draw` → send to all sockets except the drawer's; `private` → send `notice` to that player's sockets. A socket that hasn't sent `hello` may only send `hello`. On `webSocketClose` → `disconnect` + `playerLeft` event.
- Dev script: `wrangler dev`; `wrangler.jsonc` has `assets.directory: "../web/dist"`, DO binding `ROOM`, migration `{tag:'v1', new_sqlite_classes:['RoomDO']}`.

- [ ] **Step 1: Write failing integration tests** with `@cloudflare/vitest-pool-workers` (install the vitest version its peer dependency requires): create room → `201`, code matches `/^[A-HJ-NP-Z]{5}$/`; `GET` unknown code → 404; two sockets say hello → both receive `state` with 2 players, first is host; host sends `start` → states have `phase:'choosing'`; drawer chooses, B guesses the word → B receives `notice correct`, C's next `state` chat contains `« B a trouvé ! »` and never the word; drawer `draw add` → B receives `draw`, drawer doesn't; **`reconnect restores seat and drawing`**: B closes and reconnects with same token → `welcome` with same playerId and `state.game.history.actions.length` unchanged; malformed JSON → `error bad_message`, socket stays open.
- [ ] **Step 2: Run `pnpm --filter worker test` — expect FAIL**
- [ ] **Step 3: Implement protocol, router and RoomDO**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: worker and room durable object`

### Task 8: Web scaffold, home and lobby

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html}`, `src/{main.tsx,App.tsx,styles.css}`, `src/lib/{identity.ts,socket.ts}`, `src/pages/{Home.tsx,PictionaryRoom.tsx}`, `src/pictionary/{Lobby.tsx,Scoreboard.tsx}`
- Test: `apps/web/test/identity.test.ts`

**Interfaces:**
- Consumes: Task 7 protocol, `SETTING_RANGES`, `DEFAULT_SETTINGS`.
- Produces: `getToken(): string` (creates and stores `kg.token` once), `getName(): string | null`, `setName(n: string)`; `useRoomSocket(code: string, name: string): { status: 'connecting' | 'open' | 'closed'; playerId: string | null; state: StateMsg | null; send(m: ClientMsg): void; onDraw(cb): () => void; onNotice(cb): () => void; error: string | null }` — reconnects with backoff (1 s, 2 s, 4 s, max 10 s), re-sends `hello` on each open. Vite dev proxy `/api` → `http://localhost:8787` with `ws: true`.
- Routing without a library: `/` → Home, `/pictionary/:code` → PictionaryRoom (code uppercased), anything else → Home.

Home: title, Pictionary card with « Créer une salle », a « Rejoindre » field (code) ; quiz card shown greyed « Bientôt ». Room page: if no name, a pseudo prompt first; then lobby: player list with host crown, « Copier le lien » button, settings form (every field of the settings table, number inputs bounded by `SETTING_RANGES`, custom words textarea split on commas/newlines, mode radio) editable by the host only and read-only for others, « Lancer la partie » (host, ≥ 2 players). The host's settings are saved to `kg.pictionarySettings` and sent on lobby entry. Errors `room_full`/`not_found` shown as French messages with a link home. Use the frontend-design skill for the visual direction (playful, readable).

- [ ] **Step 1: Write failing test**: `getToken()` twice returns same value and stores it; `setName(' Bob ')` then `getName()` → `'Bob'` (jsdom environment)
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement the files above**
- [ ] **Step 4: Run test — expect PASS; `pnpm --filter web build` succeeds; with `wrangler dev` + `vite`, two browser tabs join the same room and see each other in the lobby**
- [ ] **Step 5: Commit** `feat: web home, room connection and lobby`

### Task 9: Canvas renderer

**Files:**
- Create: `apps/web/src/pictionary/renderer.ts`
- Test: `apps/web/test/renderer.test.ts`

**Interfaces:**
- Produces: `floodFill(img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number, rgba: [number, number, number, number], tolerance = 32): void`; `renderAction(ctx: CanvasRenderingContext2D, a: DrawAction): void`; `class Renderer { constructor(canvas: HTMLCanvasElement); reset(h: DrawingHistory): void; apply(op: DrawOp, h: DrawingHistory): void }` — keeps a snapshot every 20 actions so undo replays from the nearest snapshot instead of from zero. Strokes: round caps/joins, `globalAlpha = opacity`; a stroke is drawn on an offscreen layer then composited so opacity doesn't stack on overlapping segments. Shapes: `filled` → fill, else stroke with `size`. Fill: read the composited canvas, `floodFill` with tolerance, put back. All coordinates in 800×600 logical space; the canvas element has that intrinsic size and is scaled with CSS.

- [ ] **Step 1: Write failing tests on `floodFill`**: 10×10 white image with a black vertical line at x=5 → fill at (1,1) red colours x<5 only; tolerance lets a near-white pixel (250,250,250) be filled; filling with the same colour terminates; out-of-bounds start is a no-op
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** (scanline or stack-based, no recursion)
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat: canvas renderer and flood fill`

### Task 10: Drawing canvas and toolbar

**Files:**
- Create: `apps/web/src/pictionary/{DrawingCanvas.tsx,Toolbar.tsx}`
- Modify: `apps/web/src/pages/PictionaryRoom.tsx`

**Interfaces:**
- Consumes: `Renderer`, `useRoomSocket().send/onDraw`, `addAction/appendPoints/undo/redo` from shared (the drawer applies ops locally at once, then sends them).
- Produces: `<DrawingCanvas history={DrawingHistory} canDraw={boolean} onOp={(op: DrawOp) => void} subscribe={onDraw} />`, `<Toolbar value={ToolState} onChange onUndo onRedo onClear />` with `type ToolState = { tool: 'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse'; color: string; size: number; opacity: number; filled: boolean }`.

Toolbar: tools above; palette of 24 colours + `<input type="color">`; size slider 1–80 with 5 presets; opacity slider 10–100 %; filled toggle for rect/ellipse; undo, redo, « Tout effacer ». Keyboard (drawer only, ignored while typing in an input): Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo, `B` pen, `E` eraser, `F` fill, `L` line, `R` rect, `O` ellipse. Pointer events with pointer capture; stroke points batched every 40 ms into `append` ops; shapes preview locally while dragging and are sent once as `add` on release. Non-drawers render incoming `draw` ops and reset on each `state` whose history length differs from theirs.

- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify manually** with two tabs: every tool draws identically in both tabs, Ctrl+Z / Ctrl+Y undo and redo in both, fill matches, a refresh of the guesser's tab shows the same drawing
- [ ] **Step 3: Commit** `feat: drawing canvas and toolbar`

### Task 11: Game screen

**Files:**
- Create: `apps/web/src/pictionary/{WordBar.tsx,Chat.tsx,Timer.tsx,WordChoice.tsx,TurnEnd.tsx,GameOver.tsx}`
- Modify: `apps/web/src/pages/PictionaryRoom.tsx`, `apps/web/src/pictionary/Scoreboard.tsx`

**Interfaces:**
- Consumes: `PictionaryView`, `send`, `onNotice`, `hintsUnlocked`, `isLetterIndex`.

Layout: scoreboard (left), canvas + toolbar (centre, toolbar for the drawer only), chat (right), word bar + timer (top).
- **Timer**: counts down to `phaseEndsAt` corrected by `serverNow` offset.
- **WordBar**: guessers see `mask` slots and the letter count; drawer sees the full word, each letter clickable once `hintsUnlocked` (computed locally from `drawStartedAt`) with « Indices restants : n » and a tooltip before unlock; revealed slots highlighted for all.
- **Chat**: input placeholder « Ta réponse… », disabled for the drawer and after finding (placeholder « Tu as trouvé ! »); guesses in normal style, system lines in accent colour; `notice close` shows « tu chauffes ! » next to the input for 2 s; `notice correct` shows the word in the word bar.
- **WordChoice**: modal for the drawer during `choosing` with the choices as buttons; others see « {nom} choisit un mot… ».
- **TurnEnd**: overlay with the word and `turnPoints` for 5 s.
- **GameOver**: podium of final scores, « Rejouer » (host → `restart`, back to lobby with same settings) and « Accueil ».

- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify manually** with three tabs a full 1-round game: close guess shows « tu chauffes ! » only to its author; correct guess shows « X a trouvé ! » to others without the word; drawer reveals letters only after the unlock point and no more than maxHints; settings changed in the lobby (e.g. drawSeconds 30, maxHints 0) take effect; game over → Rejouer returns to lobby
- [ ] **Step 3: Commit** `feat: pictionary game screen`

### Task 12: README, deploy and final check

**Files:**
- Create: `README.md` (French): prerequisites (Node 22, pnpm, free Cloudflare account), `pnpm install`, `pnpm dev` (runs `wrangler dev` and `vite` together), `pnpm test`, deployment (`pnpm --filter web build && pnpm --filter worker exec wrangler deploy`, first-time `wrangler login`), project layout, how to edit `words-fr.json`.
- Modify: root `package.json` `dev` script (run both with `concurrently` or `pnpm -r --parallel dev`).

- [ ] **Step 1: Write README and dev script**
- [ ] **Step 2: Run `pnpm test` at the root — all suites PASS; `pnpm build` — PASS; `pnpm exec tsc -b` or per-package `tsc --noEmit` — no errors**
- [ ] **Step 3: Run `wrangler deploy --dry-run` from `apps/worker` — bundles without error**
- [ ] **Step 4: Commit** `docs: readme and deploy scripts`
