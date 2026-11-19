export type Tool = 'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse';
export type ToolState = { tool: Tool; color: string; size: number; opacity: number; filled: boolean };

export const DEFAULT_TOOL_STATE: ToolState = { tool: 'pen', color: '#000000', size: 6, opacity: 1, filled: false };

export const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'pen', label: 'Crayon', key: 'B' },
  { tool: 'eraser', label: 'Gomme', key: 'E' },
  { tool: 'fill', label: 'Remplissage', key: 'F' },
  { tool: 'line', label: 'Ligne', key: 'L' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
];

export const PALETTE = [
  '#000000', '#4d4d4d', '#999999', '#ffffff', '#7a1f1f', '#e53935',
  '#ff8a80', '#f57c00', '#ffb74d', '#fdd835', '#fff59d', '#2e7d32',
  '#66bb6a', '#b9f6ca', '#00838f', '#4dd0e1', '#1565c0', '#64b5f6',
  '#283593', '#7e57c2', '#d1c4e9', '#c2185b', '#f48fb1', '#795548',
];

export const SIZE_PRESETS = [2, 6, 12, 24, 48];
/** Preview dot diameter (px) for a size preset, compressed so 48 still fits the button. */
const dot = (s: number) => Math.round(Math.sqrt(s) * 3);

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS: Record<Tool | 'undo' | 'redo' | 'clear', React.ReactNode> = {
  pen: svg(<><path d="M4 20l1.2-4.6L16 4.6a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" /><path d="M14 6.6l3.4 3.4" /></>),
  eraser: svg(<><path d="M9.5 19.5L3.8 13.8a1.8 1.8 0 0 1 0-2.6l7.4-7.4a1.8 1.8 0 0 1 2.6 0l5.4 5.4a1.8 1.8 0 0 1 0 2.6l-8 7.7z" /><path d="M7 10.6l6.4 6.4" /><path d="M9.5 19.5H20" /></>),
  fill: svg(<><path d="M4.5 11.5L11 5l7 7-6.5 6.5a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z" /><path d="M4.5 11.5h13" /><path d="M8 3.5l2.5 2.5" /><path d="M20 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" /></>),
  line: svg(<path d="M5 19L19 5" />),
  rect: svg(<rect x="4" y="6" width="16" height="12" rx="1.5" />),
  ellipse: svg(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />),
  undo: svg(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>),
  redo: svg(<><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>),
  clear: svg(<><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></>),
};

type Props = {
  value: ToolState;
  onChange: (v: ToolState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

/**
 * Three panels around the notebook (palette left, tools right, sizes below). The root uses
 * `display: contents` so the room grid can place each panel; it stays the one toolbar.
 */
export function Toolbar({ value, onChange, onUndo, onRedo, onClear }: Props) {
  const set = (patch: Partial<ToolState>) => onChange({ ...value, ...patch });
  const shape = value.tool === 'rect' || value.tool === 'ellipse';
  return (
    <div className="toolbar" role="toolbar" aria-label="Outils de dessin">
      <section className="panel tb-palette" aria-label="Couleurs">
        <h2 className="panel-title">Palette</h2>
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${value.color === c ? ' on' : ''}`}
              style={{ background: c }}
              aria-label={`Couleur ${c}`}
              aria-pressed={value.color === c}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
        <div className="tb-current">
          <span className="current-swatch" style={{ background: value.color }} aria-hidden="true" />
          <input type="color" className="color-pick" aria-label="Autre couleur" title="Autre couleur" value={value.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
      </section>

      <section className="panel tb-tools" aria-label="Outils">
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={`tool-btn${value.tool === t.tool ? ' on' : ''}`}
              aria-pressed={value.tool === t.tool}
              title={`${t.label} (${t.key})`}
              data-tool={t.tool}
              onClick={() => set({ tool: t.tool })}
            >
              {ICONS[t.tool]}
              <span className="sr-only">{t.label}</span>
              <kbd className="key" aria-hidden="true">{t.key}</kbd>
            </button>
          ))}
        </div>
        <div className="tb-actions">
          <button type="button" className="act-btn" title="Annuler (Ctrl+Z)" onClick={onUndo}>{ICONS.undo}<span>Annuler</span></button>
          <button type="button" className="act-btn" title="Rétablir (Ctrl+Y)" onClick={onRedo}>{ICONS.redo}<span>Rétablir</span></button>
          <button type="button" className="act-btn danger" onClick={onClear}>{ICONS.clear}<span>Tout effacer</span></button>
        </div>
      </section>

      <div className="panel tb-bottom">
        <div className="presets">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              className={`preset${value.size === s ? ' on' : ''}`}
              aria-label={`Taille ${s}`}
              aria-pressed={value.size === s}
              onClick={() => set({ size: s })}
            >
              <span style={{ width: dot(s), height: dot(s) }} />
            </button>
          ))}
        </div>
        <label className="tb-range">
          Taille <span className="tb-val">{value.size}</span>
          <input type="range" min={1} max={80} value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        </label>
        <label className="tb-range">
          Opacité <span className="tb-val">{Math.round(value.opacity * 100)} %</span>
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(value.opacity * 100)}
            onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="check tb-check">
          <input type="checkbox" checked={value.filled} disabled={!shape} onChange={(e) => set({ filled: e.target.checked })} /> Formes pleines
        </label>
      </div>
    </div>
  );
}
