import { useEffect, useRef, useState } from 'react';
import { DEFAULT_QUIZ_SETTINGS, QUIZ_RANGES, clampQuizSettings } from '@kg/shared';
import type { ClientMsg, QuizNumericKey, QuizSettings } from '@kg/shared';
import type { QuizStateMsg } from '../lib/socket';
import { CodeHeader } from '../room/CodeHeader';
import { LobbyPlayers } from '../room/LobbyPlayers';
import { NumberField } from '../room/NumberField';
import { hasSavedQuizSettings, loadQuizSettings, saveQuizSettings } from './settingsStorage';

const NUMERIC_FIELDS: { key: QuizNumericKey; label: string; unit?: string }[] = [
  { key: 'questionCount', label: 'Nombre de questions' },
  { key: 'answerSeconds', label: 'Temps pour répondre', unit: 's' },
  { key: 'maxPlayers', label: 'Joueurs maximum' },
];

type Theme = { theme: string; count: number };

/** `/api/themes`; null while loading, 'error' when it failed. */
function useThemes(): Theme[] | null | 'error' {
  const [themes, setThemes] = useState<Theme[] | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/themes')
      .then((r) => (r.ok ? (r.json() as Promise<Theme[]>) : Promise.reject(new Error(String(r.status)))))
      .then((t) => { if (live) setThemes(t); })
      .catch(() => { if (live) setThemes('error'); });
    return () => { live = false; };
  }, []);
  return themes;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

type Props = { code: string; state: QuizStateMsg; playerId: string; send: (m: ClientMsg) => void; notice: string | null; onStart: () => void };

export function QuizLobby({ code, state, playerId, send, notice, onStart }: Props) {
  const isHost = state.hostId === playerId;
  const isOwner = state.ownerId === playerId;
  const server = state.game.settings;
  const latest = useRef<QuizSettings>(server);
  const pending = useRef<QuizSettings | null>(null);
  const pendingClear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasHostAtMount = useRef(isHost);
  const sentSaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const themes = useThemes();

  // Owner, host at lobby entry, with saved settings: push them once (a promoted player must not overwrite the room).
  useEffect(() => {
    if (!isHost || !isOwner || !wasHostAtMount.current || sentSaved.current) return;
    sentSaved.current = true;
    if (!hasSavedQuizSettings()) return;
    const saved = loadQuizSettings();
    markPending(saved);
    send({ t: 'settings', settings: saved });
  }, [isHost, isOwner, send]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(pendingClear.current); }, []);

  // Follow the server unless a local edit has not been echoed back yet.
  useEffect(() => {
    if (pending.current && JSON.stringify(server) === JSON.stringify(clampQuizSettings(pending.current))) pending.current = null;
    if (!pending.current) latest.current = server;
  }, [server]);

  function markPending(next: QuizSettings) {
    latest.current = next;
    pending.current = next;
    clearTimeout(pendingClear.current);
    pendingClear.current = setTimeout(() => { pending.current = null; }, 3000);
  }

  function commit(next: QuizSettings, debounce = false) {
    markPending(next);
    saveQuizSettings(next);
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => send({ t: 'settings', settings: next }), 300);
    else send({ t: 'settings', settings: next });
  }

  function toggleTheme(theme: string) {
    const cur = latest.current.themes;
    commit({ ...latest.current, themes: cur.includes(theme) ? cur.filter((t) => t !== theme) : [...cur, theme] });
  }

  const list = Array.isArray(themes) ? themes : [];
  // Selected themes the database no longer holds still get a chip, so the host can drop them.
  const chips: Theme[] = [...list, ...server.themes.filter((t) => !list.some((x) => x.theme === t)).map((theme) => ({ theme, count: 0 }))];
  const available = server.themes.length === 0
    ? list.reduce((n, t) => n + t.count, 0)
    : chips.filter((t) => server.themes.includes(t.theme)).reduce((n, t) => n + t.count, 0);
  const connected = state.players.filter((p) => p.connected).length;
  const canStart = isHost && connected >= 2;

  return (
    <div className="lobby quiz-lobby">
      <CodeHeader code={code} game="quiz" />

      <div className="lobby-grid">
        <div className="lobby-side">
          <LobbyPlayers players={state.players} hostId={state.hostId} playerId={playerId} maxPlayers={server.maxPlayers} />
          <footer className="lobby-foot">
            {notice && <p className="error" role="alert">{notice}</p>}
            {isHost ? (
              <>
                <button className="btn btn-primary btn-big" disabled={!canStart} onClick={() => { onStart(); send({ t: 'start' }); }}>
                  Lancer la partie
                </button>
                {!canStart && <p className="muted">Il faut au moins 2 joueurs.</p>}
              </>
            ) : (
              <p className="muted">En attente du lancement par l'hôte…</p>
            )}
          </footer>
        </div>

        <section className="card settings">
          <h2>Réglages</h2>
          {!isHost && <p className="muted">Seul l'hôte peut modifier les réglages.</p>}
          <fieldset disabled={!isHost}>
            {NUMERIC_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                unit={f.unit}
                range={QUIZ_RANGES[f.key]}
                value={server[f.key]}
                onCommit={(v) => commit({ ...latest.current, [f.key]: v }, true)}
              />
            ))}

            <div className="themes">
              <span className="field-label">Thèmes</span>
              <div className="chips" role="group" aria-label="Thèmes">
                <button type="button" className="chip" aria-pressed={server.themes.length === 0} onClick={() => commit({ ...latest.current, themes: [] })}>
                  Tous les thèmes
                </button>
                {chips.map((t) => (
                  <button key={t.theme} type="button" className="chip" aria-pressed={server.themes.includes(t.theme)} onClick={() => toggleTheme(t.theme)}>
                    {t.theme} <span className="chip-count">{t.count}</span>
                  </button>
                ))}
              </div>
              {themes === null && <p className="muted">Chargement des thèmes…</p>}
              {themes === 'error' && <p className="muted">Impossible de charger les thèmes.</p>}
              {Array.isArray(themes) && (
                <p className="available" role="status">
                  {available === 0
                    ? 'Aucune question disponible.'
                    : `${plural(available, 'question disponible', 'questions disponibles')}${available < server.questionCount ? ` : la partie en comptera ${available}.` : '.'}`}
                </p>
              )}
            </div>
          </fieldset>
          {isHost && (
            <button className="btn btn-link" onClick={() => commit({ ...DEFAULT_QUIZ_SETTINGS, themes: [] })}>
              Réglages par défaut
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
