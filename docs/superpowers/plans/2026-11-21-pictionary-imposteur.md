# Pictionary — mode Imposteur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A second Pictionary mode: one random imposter per manche who only knows the category; players add one stroke each in turn on a shared drawing; then discussion, secret vote, imposter's last-chance guess, points.

**Owner decisions (2026-11-21):** mode chosen in the Pictionary lobby (« Classique » / « Imposteur »); category public, word hidden from the imposter; random turn order, the imposter may start; optional random starter scribble (on by default); one continuous stroke per turn in the player's own colour; 2 table rounds; 20 s per stroke; discussion (host can skip) then secret vote; tie → imposter escapes; caught imposter types a guess; imposter escapes or guesses the word → imposter +2, else every drawer +1; settings: manches, table rounds, seconds per stroke, starter scribble; min 3 players.

## Global Constraints

- Settings (defaults, inclusive ranges) added to `PictionarySettings`: `mode: 'classique' | 'imposteur'` ('classique'); `impRounds` 3 [1,10] (manches); `impTableRounds` 2 [1,4]; `impStrokeSeconds` 20 [10,60]; `impDiscussSeconds` 60 [0,180] (0 = straight to vote); `impScribble` true. Existing Classique settings and behaviour unchanged.
- Timings: role reveal `IMP_REVEAL_MS = 4000`; vote 30 s; guess 30 s; result `IMP_RESULT_MS = 6000`.
- Secrecy: the word is never sent to the imposter (nor anyone's view of who the imposter is) until the result; votes hidden until the result; the imposter sees « Tu es l'imposteur » + category.
- Player colours: a fixed palette of 12 distinct colours, assigned by order in `turnOrder` for the manche; the server only accepts a stroke whose colour is the current drawer's colour, tool 'pen', size 6.
- Guess check: `classifyGuess(guess, word, false) === 'correct'` (accents/case/spaces-insensitive, no "close").
- Word bank: bundled `packages/shared/src/pictionary/imposter-words-fr.json` = `Record<category, string[]>`, ≥ 12 categories × ≥ 25 concrete, drawable words each (Animaux, Nourriture, Objets de la maison, Métiers, Sports, Lieux, Moyens de transport, Vêtements & accessoires, Instruments de musique, Personnages de fiction, Nature & météo, Fête & loisirs), lowercase, French, no duplicates across categories.
- French copy; minimum 3 connected players to start in this mode (Classique keeps 2).

## Review Focus

1. The imposter's view (state messages) never contains the word, before or during drawing, discussion, vote, guess (raw-frame check in worker test).
2. The current drawer disconnects mid-turn → turn passes immediately; the manche continues.
3. A stroke from a non-current player, wrong colour or after the turn ended → rejected, not relayed.
4. Tie vote → imposter escapes, no guess phase.
5. Fewer than 3 connected at the start of a manche → gameOver.

---

### Task 1: Shared + worker — imposter rules

**Files:** Create `packages/shared/src/pictionary/imposter.ts`, `packages/shared/src/pictionary/imposter-words-fr.json`; modify `pictionary/{settings,game,view}.ts`, `src/protocol.ts`, `src/index.ts`, `apps/worker/src/games.ts`; tests `packages/shared/test/imposter.test.ts`, `apps/worker/test/imposter.test.ts`.

**Interfaces — Produces:**
```ts
// Phase adds: 'impReveal' | 'impDrawing' | 'impDiscuss' | 'impVote' | 'impGuess' | 'impResult'
type ImposterState = {
  manche: number;                  // 1-based
  category: string; word: string; imposterId: string;
  order: string[];                 // turn order for this manche (random)
  colors: Record<string, string>;  // playerId → hex colour
  turn: number;                    // index into order × impTableRounds
  strokeId: string | null;         // id of the current turn's stroke once started
  votes: Record<string, string>;   // voterId → targetId
  accused: string | null; guess: string | null; imposterWon: boolean | null;
  scribble: DrawAction | null;
};
// PictionaryState adds: imp: ImposterState | null
// GameEvent adds:
| { type: 'impStrokeDone'; by: string }
| { type: 'impVote'; by: string; target: string }
| { type: 'impGuess'; by: string; text: string }
| { type: 'impSkip'; by: string }                   // host: end discussion early
// ClientMsg adds: { t:'impDone' } | { t:'impVote'; target: string } | { t:'impGuess'; text: string } | { t:'impSkip' }
type ImposterView = {
  manche: number; manches: number; category: string;
  isImposter: boolean; word: string | null;          // null for the imposter until impResult
  order: string[]; colors: Record<string, string>;
  currentDrawer: string | null; tableRound: number; tableRounds: number;
  voted: string[];                                   // who has voted (ids only) during impVote
  myVote: string | null;
  result: { imposterId: string; accused: string | null; guess: string | null; imposterWon: boolean; votes: Record<string,string> } | null; // impResult only
};
// PictionaryView adds: imp: ImposterView | null; mode
pickImposterWord(rng, used: string[]): { category: string; word: string }
makeScribble(rng, id: string): DrawAction   // one smooth random curve, grey #9ca3af, size 6, within 800×600
```
Rules: `start` in imposteur mode → manche 1. Manche start: needs ≥3 connected else gameOver; random imposter among connected; random order of connected; colours; new history (+ scribble action if enabled); `impReveal` 4 s → `impDrawing`. Drawing: current drawer = `order[turn % order.length]` (skip disconnected); accepts `draw add` of a stroke (pen, own colour, size 6) only when no stroke yet this turn, `append` to that stroke, then `impStrokeDone` (or turn timeout) ends the turn; undo/redo/clear rejected. After `order.length × impTableRounds` turns → `impDiscuss` (`impDiscussSeconds`, 0 → skip) → host `impSkip` or timeout → `impVote` (30 s; ends early when every connected player voted; self-vote rejected) → count: strict max on one player; tie or nobody → imposter escapes → `impResult`; accused ≠ imposter → imposter wins → `impResult`; accused = imposter → `impGuess` (30 s, only the imposter's `impGuess` accepted, one try) → `impResult` with `imposterWon` = guess correct. Points on entering `impResult`. `impResult` 6 s → next manche or `gameOver`. Chat guessing disabled in this mode. `restart` → lobby as today.
Worker: map the four new client messages; relay draw ops to everyone except the current drawer; existing draw batching applies.

- [ ] **Step 1: Write failing tests**: settings defaults/ranges/mode; word bank shape (≥12 categories × ≥25, unique, lowercase); full manche flow with 3 players (reveal → 6 strokes → discuss → vote → imposter caught → guess correct → imposter +2) and a variant (caught, wrong guess → drawers +1 each); tie → escape; wrong accused → imposter +2; strokes rejected (not current drawer, wrong colour, second stroke same turn, undo); drawer disconnect passes turn; <3 connected at manche start → gameOver; views: imposter never has the word before impResult; votes hidden until impResult; worker raw-frame secrecy test for the imposter socket; Classique tests unchanged.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: shared + worker tests PASS; `pnpm --filter web build` compiles (minimal web changes)**
- [ ] **Step 5: Commit** `feat(pictionary): imposter mode rules`

### Task 2: Web — imposter mode UI

**Files:** modify `apps/web/src/pictionary/{Lobby,DrawingCanvas,Toolbar}.tsx`, `pages/PictionaryRoom.tsx`, `room/gameSounds.ts`, `styles.css`; create `apps/web/src/pictionary/imposter/{RoleCard,TurnBar,Discussion,Vote,Guess,ImpResult}.tsx`; `apps/web/e2e/imposter.py`.

- Lobby: mode switch « Classique / Imposteur » (host), Imposteur settings fields (manches, tours de table, secondes par trait, discussion, gribouillis de départ) with the same host-settings flow; « 3 joueurs minimum » hint.
- RoleCard (4 s): « Catégorie : Animaux » + either « Le mot : girafe » or a big « Tu es l'imposteur 🤫 ».
- Drawing: notebook header shows category (+ word for non-imposters, « ??? » for the imposter); TurnBar lists the order with each player's colour dot and highlights the current drawer + countdown; only the current drawer can draw, with no toolbar except a « J'ai fini » button; stroke colour fixed to their colour; pointerup ends the turn (sends `impDone`); others watch live.
- Discussion: countdown, « Passer au vote » (host).
- Vote: buttons per other player (with colour dot), « En attente : … ».
- Guess: imposter gets an input « Quel était le mot ? »; others see « {nom} tente sa chance… ».
- ImpResult: reveals imposter, the word, votes per player, the guess, who scored.
- Sounds: your turn starts (`turnStart`), vote/result reuse existing sounds.
- [ ] **Step 1: Implement**
- [ ] **Step 2: `apps/web/e2e/imposter.py`** (3 players, 1 manche, 1 table round, short timers): imposter's DOM never contains the word before the result; non-current player can't draw; strokes appear for everyone in the drawer's colour; vote → guess → result; screenshots `/home/claude/out/imp-*.png` (role card, drawing turn, vote, result); re-run the other e2e scripts
- [ ] **Step 3: `pnpm test`, build — PASS; commit** `feat(web): pictionary imposter mode`
