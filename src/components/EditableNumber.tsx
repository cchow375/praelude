import { useEffect, useState } from "react";
import "./EditableField.css";

export interface EditableNumberProps {
  value: number | null;
  onSave: (next: number | null) => Promise<void>;
  min?: number;
  max?: number;
  step?: number;
  allowNull?: boolean;
  ariaLabel: string;
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function format(v: number | null): string {
  return v === null ? "—" : String(v);
}

/**
 * Inline numeric edit primitive: double-click to edit, Enter/blur commits
 * optimistically (clamped to min/max, rolling back on `onSave` rejection),
 * Esc cancels. When `allowNull`, clearing the field saves `null`.
 */
export function EditableNumber({
  value,
  onSave,
  min,
  max,
  step = 1,
  allowNull,
  ariaLabel,
}: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(value);
  const [draft, setDraft] = useState(format(value));

  useEffect(() => {
    setDisplay(value);
  }, [value]);

  function parse(raw: string): number | null {
    if (raw.trim() === "") return allowNull ? null : (display ?? 0);
    const n = Number(raw);
    if (Number.isNaN(n)) return display;
    return clamp(n, min, max);
  }

  async function commit() {
    setEditing(false);
    const next = parse(draft);
    if (next === display) return;
    const prev = display;
    setDisplay(next); // optimistic
    try {
      await onSave(next);
    } catch {
      setDisplay(prev); // rollback
    }
  }

  function cancel() {
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        className="editable-field"
        data-empty={display === null}
        onDoubleClick={() => {
          setDraft(format(display));
          setEditing(true);
        }}
      >
        {format(display)}
      </span>
    );
  }

  return (
    <input
      className="editable-field-input"
      type="number"
      aria-label={ariaLabel}
      autoFocus
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      }}
    />
  );
}
