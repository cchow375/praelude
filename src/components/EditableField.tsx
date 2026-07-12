import { useEffect, useState } from "react";
import "./EditableField.css";

export interface EditableFieldProps {
  value: string;
  onSave: (next: string) => Promise<void>; // rejects → rollback
  placeholder?: string;
  ariaLabel: string;
}

/**
 * Inline text edit primitive: double-click to edit, Enter/blur commits
 * optimistically (rolling back on `onSave` rejection), Esc cancels without
 * calling `onSave`.
 */
export function EditableField({ value, onSave, placeholder, ariaLabel }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(value);
  const [draft, setDraft] = useState(value);

  // Follow external updates while not mid-edit.
  useEffect(() => {
    setDisplay(value);
  }, [value]);

  async function commit() {
    setEditing(false);
    if (draft === display) return;
    const prev = display;
    setDisplay(draft); // optimistic
    try {
      await onSave(draft);
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
        data-empty={!display}
        onDoubleClick={() => {
          setDraft(display);
          setEditing(true);
        }}
      >
        {display || placeholder}
      </span>
    );
  }

  return (
    <input
      className="editable-field-input"
      aria-label={ariaLabel}
      autoFocus
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
