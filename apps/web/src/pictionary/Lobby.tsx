import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, SETTING_RANGES, clampSettings } from '@kg/shared';
import type { ClientMsg, NumericSettingKey, PictionarySettings } from '@kg/shared';
import type { PictionaryStateMsg } from '../lib/socket';
import { avatarColor } from './Scoreboard';

const SETTINGS_KEY = 'kg.pictionarySettings';

const NUMERIC_FIELDS: { key: NumericSettingKey; label: string; unit?: string }[] = [
  { key: 'rounds', label: 'Manches' },
  { key: 'drawSeconds', label: 'Temps pour dessiner', unit: 's' },
  { key: 'chooseSeconds', label: 'Temps pour choisir le mot', unit: 's' },
  { key: 'wordChoices', label: 'Mots proposés' },
  { key: 'maxHints', label: 'Indices maximum' },
  { key: 'hintUnlockPct', label: 'Premier indice après', unit: '% du temps' },
  { key: 'maxPlayers', label: 'Joueurs maximum' },
];

function loadSaved(): PictionarySettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? clampSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const splitWords = (text: string) => text.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

type Props = { code: string; state: PictionaryStateMsg; playerId: string; send: (m: ClientMsg) => void };

export function Lobby({ code, state, playerId, send }: Props) {
  const isHost = state.hostId === playerId;
  // Only the room's creator sees (and edits) the custom word list; a promoted host can replace it.
  const isOwner = state.ownerId === playerId;
  const server = state.game.settings;
  const latest = useRef<PictionarySettings>(server);
  const pending = useRef<PictionarySettings | null>(null);
  const pendingClear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasHostAtMount = useRef(isHost);
  const sentSaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wordsTouched = useRef(false);
  const [wordsText, setWordsText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [copied, setCopied] = useState(false);

  // Host with saved settings: push them once on lobby entry.
  useEffect(() => {
    // Only the owner, host at lobby entry, pushes; a promoted player must not overwrite the room.
    if (!isHost || !isOwner || !wasHostAtMount.current || sentSaved.current) return;
    sentSaved.current = true;
    const saved = loadSaved();
    if (saved) {
      markPending(saved);
      setWordsText(saved.customWords.join('\n'));
      wordsTouched.current = true;
      send({ t: 'settings', settings: saved });
    }
  }, [isHost, isOwner, send]);

  // Show the server's custom words until the host edits the box.
  useEffect(() => {
    if (isHost && isOwner && !wordsTouched.current) setWordsText(server.customWords.join('\n'));
  }, [isHost, isOwner, server.customWords]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(pendingClear.current); }, []);

  // Follow the server unless a local edit has not been echoed back yet.
  useEffect(() => {
    if (pending.current && JSON.stringify(server) === JSON.stringify(clampSettings(pending.current))) pending.current = null;
    if (!pending.current) latest.current = server;
  }, [server]);

  function markPending(next: PictionarySettings) {
    latest.current = next;
    pending.current = next;
    clearTimeout(pendingClear.current);
    pendingClear.current = setTimeout(() => { pending.current = null; }, 3000);
  }

  function commit(next: PictionarySettings, debounce = false) {
    markPending(next);
    // A non-owner never holds the real list: keep their own saved words, and send no list so the
    // server keeps the owner's.
    const saved = isOwner ? next : { ...next, customWords: loadSaved()?.customWords ?? [] };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    const wire: Partial<PictionarySettings> = isOwner ? next : { ...next, customWords: undefined };
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => send({ t: 'settings', settings: wire }), 300);
    else send({ t: 'settings', settings: wire });
  }

  function replaceWords() {
    clearTimeout(timer.current);
    send({ t: 'settings', settings: { ...latest.current, customWords: splitWords(replaceText) } });
    setReplaceText('');
  }

  function patch(p: Partial<PictionarySettings>) {
    commit({ ...latest.current, ...p });
  }

  function onWords(text: string) {
    wordsTouched.current = true;
    setWordsText(text);
    commit({ ...latest.current, customWords: splitWords(text) }, true);
  }

  async function copy() {
    const url = `${location.origin}/pictionary/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copie ce lien :', url);
    }
  }

  const connected = state.players.filter((p) => p.connected).length;
  // Mirrors pickChoices: 'only' with fewer words than choices falls back to the default list.
  const tooFewCustom = server.customWordsMode === 'only' && state.game.customWordsCount < server.wordChoices;
  const canStart = isHost && connected >= 2;

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div>
          <p className="muted">Code de la salle</p>
          <div className="code-tiles" aria-label={`Code ${code}`}>
            {code.split('').map((c, i) => (
              <span key={i} className="tile">{c}</span>
            ))}
          </div>
        </div>
        <button className="btn" onClick={copy}>{copied ? 'Lien copié' : 'Copier le lien'}</button>
      </header>

      <div className="lobby-grid">
        <div className="lobby-side">
          <section className="card players">
            <h2>Joueurs ({state.players.length}/{server.maxPlayers})</h2>
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.id} className={`${p.connected ? '' : 'away'}${p.id === playerId ? ' me' : ''}`}>
                  <span className="avatar" style={{ background: avatarColor(p.id) }} aria-hidden="true">{[...p.name][0]?.toUpperCase()}</span>
                  <span className="player-name">
                    {p.id === state.hostId && <span className="crown" title="Hôte" aria-label="Hôte">♛</span>}
                    {p.name}
                    {p.id === playerId && <span className="you"> (toi)</span>}
                    {!p.connected && <span className="you"> (absent)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <footer className="lobby-foot">
            {isHost ? (
              <>
                <button className="btn btn-primary btn-big" disabled={!canStart} onClick={() => send({ t: 'start' })}>
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
                range={SETTING_RANGES[f.key]}
                value={server[f.key]}
                onCommit={(v) => patch({ [f.key]: v })}
              />
            ))}
            <label className="row check">
              <input type="checkbox" checked={server.closeDetection} onChange={(e) => patch({ closeDetection: e.target.checked })} />
              <span>Prévenir quand on chauffe</span>
            </label>

            <div className="words">
              <span className="field-label">Mots personnalisés</span>
              {isHost && isOwner ? (
                <textarea
                  value={wordsText}
                  onChange={(e) => onWords(e.target.value)}
                  rows={4}
                  placeholder="Un mot par ligne, ou séparés par des virgules"
                />
              ) : (
                <p>
                  {state.game.customWordsCount} mots perso
                  {state.game.customWordsCount > 0 && (server.customWordsMode === 'only' ? ' (uniquement ceux-là)' : ' (mélangés aux mots du jeu)')}
                </p>
              )}
              {isHost && !isOwner && (
                <>
                  <label className="field-label" htmlFor="replace-words">Remplacer les mots perso</label>
                  <textarea
                    id="replace-words"
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    rows={4}
                    placeholder="Nouvelle liste : un mot par ligne, ou séparés par des virgules"
                  />
                  <button type="button" className="btn" onClick={replaceWords}>Remplacer les mots perso</button>
                </>
              )}
              {isHost && (
                <div className="radios" role="radiogroup" aria-label="Utilisation des mots personnalisés">
                  <label>
                    <input type="radio" name="mode" checked={server.customWordsMode === 'mixed'} onChange={() => patch({ customWordsMode: 'mixed' })} />
                    Mélangés aux mots du jeu
                  </label>
                  <label>
                    <input type="radio" name="mode" checked={server.customWordsMode === 'only'} onChange={() => patch({ customWordsMode: 'only' })} />
                    Uniquement mes mots
                  </label>
                </div>
              )}
              {tooFewCustom && (
                <p className="muted" role="note">Pas assez de mots perso : la liste par défaut sera utilisée</p>
              )}
            </div>
          </fieldset>
          {isHost && (
            <button className="btn btn-link" onClick={() => { setWordsText(''); wordsTouched.current = true; commit({ ...DEFAULT_SETTINGS, customWords: [] }); }}>
              Réglages par défaut
            </button>
          )}
        </section>
      </div>

    </div>
  );
}

function NumberField({ label, unit, range, value, onCommit }: {
  label: string;
  unit?: string;
  range: [number, number];
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const [min, max] = range;
  return (
    <label className="row">
      <span className="field-label">{label}</span>
      <span className="num">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            const n = Number(text);
            if (text.trim() === '' || !Number.isFinite(n)) setText(String(value));
            else {
              const c = Math.min(max, Math.max(min, Math.round(n)));
              setText(String(c));
              if (c !== value) onCommit(c);
            }
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max && Number.isInteger(n)) onCommit(n);
          }}
        />
        <small>{unit ?? ''}</small>
      </span>
    </label>
  );
}
