import { useRef, useState } from "react";
import { Popover } from "./Popover";
import "./ConfirmDelete.css";

export interface ConfirmDeleteProps {
  label: string; // "this block and its 9 reps"
  onConfirm: () => Promise<void>;
  children: React.ReactNode; // the trigger
}

/**
 * Wraps a trigger element in a destructive-confirmation popover, matching the
 * project's `Popover` interaction pattern (anchored, dismiss on outside-click
 * or Escape). Confirm invokes `onConfirm` and closes; Cancel just closes.
 */
export function ConfirmDelete({ label, onConfirm, children }: ConfirmDeleteProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  async function confirm() {
    await onConfirm();
    setOpen(false);
  }

  return (
    <span ref={anchorRef} className="confirm-delete-anchor" onClick={() => setOpen(true)}>
      {children}
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Confirm delete">
        <div className="confirm-delete-body">
          <p className="confirm-delete-label">{label}</p>
          <div className="confirm-delete-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="confirm-delete-danger" onClick={confirm}>
              Confirm
            </button>
          </div>
        </div>
      </Popover>
    </span>
  );
}
