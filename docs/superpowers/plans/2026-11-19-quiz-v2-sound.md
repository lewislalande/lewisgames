# Quiz v2 (review at the end, accelerating timer) + Sound — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) The quiz plays all questions first, then reviews them one by one at the end; (2) the answering timer speeds up as players submit, scaled to the number of players; (3) synthesized sound effects with a volume control in both games.

**Owner decisions (2026-11-19):** transition between questions 1 s; at the end, each question shows all answers and the correct answer at once (no one-by-one reveal), players vote, host moves on, then the ranking; timer speed scales with the number of players; sound in both games, adjustable.

**Spec:** `docs/superpowers/specs/2026-11-19-kgames-design.md` §8 as amended here (this plan supersedes §8.1 steps 3–5 ordering).

## Global Constraints

- Voting rules unchanged: ✅ 1 / ½ 0.5 / ❌ 0; empty = ❌ without vote; no self-vote except self-vote groups (every present voter authored it → authors vote, tie → host decides even if author); majority; tie → host decides; host-author tie → ½ (not for self-vote groups); late joiners not awaited.
- Secrecy: during answering nobody receives another player's answer text or any correct answer; scores and points stay hidden until the review results of each question (scoreboard shows names only during answering).
- Timer: `rate = 1 + 2 × submittedConnected / connectedPlayers` (≥ 1, never decreases within a question — take the max with the previous rate). On rate change: `remainingVirtual = (phaseEndsAt − now) × oldRate; phaseEndsAt = now + remainingVirtual / newRate`. Displayed seconds = `(phaseEndsAt − now) × rate`.
- Transition between questions: `TRANSITION_MS = 1000`.
- Sound: Web Audio API synthesis only (no audio files, no external requests); setting stored in `localStorage` key `kg.sound` = `{ volume: 0..1, muted: boolean }`, default `{ volume: 0.6, muted: false }`; audio context resumed on the first user gesture; `prefers-reduced-motion` does not mute sound.
- French UI copy; Pictionary timer behaviour unchanged (sound only).

## Review Focus

1. A player refreshes during answering of question 3 → their earlier answers are kept and reviewed at the end.
2. Everyone submits instantly → rate ×3 and the remaining time shrinks, never negative; `phaseEndsAt` stays ≥ now.
3. A player leaves mid-answering → rate recomputed with the new connected count but never decreases.
4. Review of a question where nobody answered → result directly (0 pts), host moves on.
5. Sound disabled (muted) → no AudioContext created at all.

---

### Task 1: Shared quiz flow v2 + worker

**Files:** Modify `packages/shared/src/quiz/{game,view}.ts`, `packages/shared/src/protocol.ts` (if message set changes), `apps/worker/src/games.ts`; tests `packages/shared/test/quiz-game.test.ts`, `apps/worker/test/quiz.test.ts`.

**Interfaces — Produces:**
```ts
type QuizPhase = 'lobby' | 'answering' | 'transition' | 'voting' | 'deciding' | 'result' | 'gameOver';
// QuizState adds:
allAnswers: Record<string, string>[];   // per question index: playerId → final answer text (non-blank only), filled when answering ends
reviewIndex: number;                    // question under review
timeRate: number;                       // current answering speed (1 when not answering)
// removes: revealedCount, answerShown (reveal step gone)
const TRANSITION_MS = 1000;
// QuizView changes:
phase: QuizPhase; timeRate: number;
questionNumber: number;                 // answering: index+1; review phases: reviewIndex+1
reviewing: boolean;                     // true in voting/deciding/result
revealed: {groupId,text,authors}[];     // all groups of the reviewed question (empty while answering)
correct: {answer,variants} | null;      // reviewed question only, non-null in voting/deciding/result
scores: Record<string, number>;         // {} until the first review result; then cumulative
// removed: groupCount
```
Flow: `start` → answering(q0). Answering end (timeout or all connected submitted) → store `allAnswers[index]` (drafts used on timeout as today) → if more questions: `transition` (`phaseEndsAt = now + TRANSITION_MS`) → `timeout` → answering(next). After the last question: `reviewIndex = 0` → enter review of question 0: build groups from `allAnswers[0]`, phase `voting` (with existing eligibility/self-vote logic; zero groups → `result` directly). Host `next` in `result` → next review or `gameOver`. `next` in other phases is ignored (no reveal step). `closeVote`/`decide` unchanged.
Timer: on every `answer` with `final: true` (and on `playerLeft`/`playerJoined` during answering) recompute the rate per Global Constraints.

- [ ] **Step 1: Update/write failing tests**: full 2-question flow answering→transition→answering→voting(q0)→result→next→voting(q1)→result→next→gameOver; transition lasts 1000 ms and stale timeouts ignored; scores `{}` in views before the first review result; no answer text of others and no correct answer in any view during answering/transition; refresh (playerLeft+playerJoined) keeps earlier `allAnswers`; nobody answered q1 → its review goes straight to `result`; rate: 4 players, 1 submit → 1.5 and `phaseEndsAt` recomputed exactly; 4 submits ends the phase; withdraw (`final:false`) doesn't lower the rate; player leaves → rate uses new connected count, max with previous; all existing voting/self-vote/tie tests adapted to the review phase.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** (+ worker adapter: alarm on `phaseEndsAt` already generic; update worker quiz tests to the new flow incl. secrecy test)
- [ ] **Step 4: `pnpm --filter @kg/shared test`, `pnpm --filter worker test` — PASS; `pnpm --filter web build` must still compile (minimal web fixes allowed, real UI in Task 2)**
- [ ] **Step 5: Commit** `feat(quiz): review at the end, accelerating timer`

### Task 2: Web quiz screens v2

**Files:** Modify `apps/web/src/pages/QuizRoom.tsx`, `src/quiz/{Answering,Voting,QuestionResult,QuizScoreboard,format}.tsx`; delete `src/quiz/Reveal.tsx` if unused; `src/styles.css`; `apps/web/e2e/quiz-game.py`.

- Answering: timer badge shows displayed seconds (rate-adjusted) and a `×1,5`-style speed chip that pulses when the rate rises; scoreboard shows ✓ for submitted players, no scores.
- Transition: full-card « Question suivante… » (1 s), with the next question number.
- Review header: « Correction — question n/N » with the theme; correct answer card pinned at top; all answers at once with authors; voting UI as today; host « Terminer le vote »; result shows outcomes and points; host button « Question suivante » / « Voir le classement ».
- Game over unchanged.
- [ ] **Step 1: Implement**
- [ ] **Step 2: Update and run `quiz-game.py`** (3 players, 2 questions: answers hidden during answering, transition shown, speed chip appears after a submit, review shows all answers + correct answer at once, votes, tie, scores, ranking) + screenshots `/home/claude/out/quizv2-*.png` (look at them, 1280×800 no scroll); re-run Pictionary e2e
- [ ] **Step 3: Commit** `feat(web): quiz review at the end, speed chip`

### Task 3: Sound

**Files:** Create `apps/web/src/lib/sound.ts`, `apps/web/src/room/SoundControl.tsx`; modify `QuizRoom.tsx`, `PictionaryRoom.tsx` (+ the components that emit events), `styles.css`; test `apps/web/test/sound.test.ts`.

**Interfaces:** `sound.ts` exports `getSoundSettings(): {volume, muted}`, `setSoundSettings(s)`, `play(name: SoundName)`, `startTicking(getRate: () => number)` / `stopTicking()`; `type SoundName = 'tick' | 'submit' | 'found' | 'close' | 'reveal' | 'timeUp' | 'turnStart' | 'podium'`. Lazy `AudioContext` created on first `play` while not muted; all sounds short oscillator/noise envelopes (≤ 400 ms, podium ≤ 1.5 s jingle), master gain = volume.
- Ticking: last 10 displayed seconds of a timed phase (quiz answering: interval = 1000 ms / rate; Pictionary drawing: 1 s, faster last 3 s), stops on phase change/unmount.
- Events: quiz — own submit `submit`, another player's submit (answered list grows) soft `reveal`, timer end `timeUp`, ranking `podium`; Pictionary — turn start `turnStart`, someone finds `found`, own close guess `close`, timer end `timeUp`, game over `podium`.
- SoundControl: 🔊/🔇 button in the room header opening a small popover with a volume slider and a mute toggle; same in both games and the lobby; persisted to `kg.sound`.
- [ ] **Step 1: Write failing tests** (fake AudioContext): settings round-trip and clamping; muted → `play` creates no AudioContext; ticking interval follows `getRate`; `stopTicking` clears it
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement and wire**
- [ ] **Step 4: PASS; build; run all e2e scripts (sound must not break them)**
- [ ] **Step 5: Commit** `feat(web): sound effects with volume control`
