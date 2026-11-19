import { useEffect, useId, useRef, useState } from 'react';
import { getSoundSettings, play, setSoundSettings, type SoundSettings } from '../lib/sound';

/** Speaker icon: with sound waves (🔊), or crossed out (🔇). */
function SpeakerIcon({ silent }: { silent: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {silent ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}

/** 🔊 / 🔇 button opening a small popover: volume slider and « Couper le son ». Saved in `kg.sound`. */
export function SoundControl() {
  const [s, setS] = useState<SoundSettings>(getSoundSettings);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const popId = useId();

  function update(next: SoundSettings) {
    setSoundSettings(next);
    setS(getSoundSettings());
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    slider.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const silent = s.muted || s.volume === 0;
  return (
    <div
      className="sound"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        }
      }}
      onBlur={(e) => {
        // Tabbing out of the popover closes it.
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={`sound-btn${silent ? ' silent' : ''}`}
        aria-label="Son"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <SpeakerIcon silent={silent} />
      </button>
      {open && (
        <div className="sound-pop" id={popId} role="dialog" aria-label="Son">
          <label className="sound-row">
            <span>Volume</span>
            <input
              ref={slider}
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.volume * 100)}
              onChange={(e) => update({ ...s, volume: Number(e.target.value) / 100 })}
              // A sample once the slider is released, so the new level can be heard.
              onPointerUp={() => play('submit')}
              onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') play('submit'); }}
            />
            <output className="sound-value">{Math.round(s.volume * 100)}</output>
          </label>
          <label className="sound-row sound-mute">
            <input type="checkbox" checked={s.muted} onChange={(e) => update({ ...s, muted: e.target.checked })} />
            <span>Couper le son</span>
          </label>
        </div>
      )}
    </div>
  );
}
