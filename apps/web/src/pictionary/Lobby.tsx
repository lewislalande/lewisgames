import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, IMP_MIN_PLAYERS, SETTING_RANGES, clampSettings } from '@kg/shared';
import type { ClientMsg, NumericSettingKey, PictionarySettings } from '@kg/shared';
import type { PictionaryStateMsg } from '../lib/socket';
import { CodeHeader } from '../room/CodeHeader';
import { LobbyPlayers } from '../room/LobbyPlayers';
import { NumberField } from '../room/NumberField';

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

const IMPOSTER_FIELDS: { key: NumericSettingKey; label: string; unit?: string }[] = [
  { key: 'impRounds', label: 'Manches' },
  { key: 'impTableRounds', label: 'Tours de table' },
  { key: 'impStrokeSeconds', label: 'Secondes par trait', unit: 's' },
  { key: 'impDiscussSeconds', label: 'Discussion', unit: 's' },
  { key: 'maxPlayers', label: 'Joueurs maximum' },
];

const MODES: { mode: PictionarySettings['mode']; label: string }[] = [
  { mode: 'classique', label: 'Classique' },
  { mode: 'imposteur', label: 'Imposteur' },
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

  const connected = state.players.filter((p) => p.connected).length;
  // Mirrors pickChoices: 'only' with fewer words than choices falls back to the default list.
  const tooFewCustom = server.customWordsMode === 'only' && state.game.customWordsCount < server.wordChoices;
  const imposter = server.mode === 'imposteur';
  const canStart = isHost && connected >= (imposter ? IMP_MIN_PLAYERS : 2);

  return (
    <div className="lobby">
      <CodeHeader code={code} game="pictionary" />

      <div className="lobby-grid">
        <div className="lobby-side">
          <LobbyPlayers players={state.players} hostId={state.hostId} playerId={playerId} maxPlayers={server.maxPlayers} />
          <footer className="lobby-foot">
            {isHost ? (
              <>
                <button className="btn btn-primary btn-big" disabled={!canStart} onClick={() => send({ t: 'start' })}>
                  Lancer la partie
                </button>
                {!canStart && <p className="muted">{imposter ? '3 joueurs minimum' : 'Il faut au moins 2 joueurs.'}</p>}
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
            <div className="mode-switch" role="radiogroup" aria-label="Mode de jeu">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  role="radio"
                  className="chip"
                  aria-checked={server.mode === m.mode}
                  onClick={() => server.mode !== m.mode && patch({ mode: m.mode })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {imposter && (
              <>
                <p className="muted mode-note">Tout le monde dessine le même mot, sauf l'imposteur qui ne connaît que la catégorie · 3 joueurs minimum</p>
                {IMPOSTER_FIELDS.map((f) => (
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
                  <input type="checkbox" checked={server.impScribble} onChange={(e) => patch({ impScribble: e.target.checked })} />
                  <span>Gribouillis de départ</span>
                </label>
              </>
            )}
            {!imposter && (
              <>
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
              </>
            )}
          </fieldset>
          {isHost && (
            <button className="btn btn-link" onClick={() => { setWordsText(''); wordsTouched.current = true; commit({ ...DEFAULT_SETTINGS, mode: server.mode, customWords: [] }); }}>
              Réglages par défaut
            </button>
          )}
        </section>
      </div>

    </div>
  );
}
