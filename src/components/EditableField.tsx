import { useEffect, useRef, useState } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const committing = useRef(false);
  const skipNextBlur = useRef(false);
  const externalValueAtEditStart = useRef(value);
  const externalChangedDuringEdit = useRef(false);

  // Follow external updates while not mid-edit.
  useEffect(() => {
    if (editing) externalChangedDuringEdit.current = true;
    else setDisplay(value);
  }, [value]);

  useEffect(() => {
    if (editing || !restoreTriggerFocus.current) return;
    restoreTriggerFocus.current = false;
    triggerRef.current?.focus();
  }, [editing]);

  function beginEditing() {
    // Escape may unmount the input without a browser blur. Never carry that
    // one-shot suppression into the next edit cycle.
    skipNextBlur.current = false;
    externalValueAtEditStart.current = value;
    externalChangedDuringEdit.current = false;
    setDraft(display);
    setEditing(true);
  }

  function externalChangedWhileEditing() {
    return externalChangedDuringEdit.current
      || value !== externalValueAtEditStart.current;
  }

  async function commit(restoreFocus = false) {
    if (committing.current) return;
    committing.current = true;
    restoreTriggerFocus.current = restoreFocus;
    setEditing(false);
    try {
      const externalChanged = externalChangedWhileEditing();
      if (draft !== display) {
        // If native/parent state changed during this edit, it is the truthful
        // rollback target; otherwise preserve the last optimistic display.
        const prev = externalChanged ? value : display;
        setDisplay(draft); // optimistic
        try {
          await onSave(draft);
        } catch {
          setDisplay(prev); // rollback
        }
      } else if (externalChanged) {
        setDisplay(value);
      }
    } finally {
      committing.current = false;
    }
  }

  function cancel(restoreFocus = false) {
    skipNextBlur.current = true;
    restoreTriggerFocus.current = restoreFocus;
    if (externalChangedWhileEditing()) setDisplay(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="editable-field"
        data-empty={!display}
        aria-label={`Edit ${ariaLabel}`}
        onClick={beginEditing}
        onDoubleClick={beginEditing}
      >
        {display || placeholder}
      </button>
    );
  }

  return (
    <input
      className="editable-field-input"
      aria-label={ariaLabel}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (skipNextBlur.current) {
          skipNextBlur.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(true);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel(true);
        }
      }}
    />
  );
}
