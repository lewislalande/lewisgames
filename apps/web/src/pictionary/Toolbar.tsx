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
const dot = (s: number) => Math.round(Math.sqrt(s) * 3.4);

type Props = {
  value: ToolState;
  onChange: (v: ToolState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

export function Toolbar({ value, onChange, onUndo, onRedo, onClear }: Props) {
  const set = (patch: Partial<ToolState>) => onChange({ ...value, ...patch });
  const shape = value.tool === 'rect' || value.tool === 'ellipse';
  return (
    <div className="toolbar" role="toolbar" aria-label="Outils de dessin">
      <div className="tb-group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            className={`tb-btn${value.tool === t.tool ? ' on' : ''}`}
            aria-pressed={value.tool === t.tool}
            title={`${t.label} (${t.key})`}
            data-tool={t.tool}
            onClick={() => set({ tool: t.tool })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tb-group palette" aria-label="Couleurs">
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
        <input type="color" className="color-pick" aria-label="Autre couleur" value={value.color} onChange={(e) => set({ color: e.target.value })} />
      </div>

      <div className="tb-group">
        <label className="tb-range">
          Taille <span className="tb-val">{value.size}</span>
          <input type="range" min={1} max={80} value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        </label>
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

      <div className="tb-group">
        <button type="button" className="tb-btn" title="Annuler (Ctrl+Z)" onClick={onUndo}>↶ Annuler</button>
        <button type="button" className="tb-btn" title="Rétablir (Ctrl+Y)" onClick={onRedo}>↷ Rétablir</button>
        <button type="button" className="tb-btn danger" onClick={onClear}>Tout effacer</button>
      </div>
    </div>
  );
}
