import { useEffect, useState } from 'react';

/** A bounded integer setting row; commits valid values as typed, clamps on blur. */
export function NumberField({ label, unit, range, value, onCommit }: {
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
