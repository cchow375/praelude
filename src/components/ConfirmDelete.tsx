import {
  cloneElement,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Popover } from "./Popover";
import "./ConfirmDelete.css";

export interface ConfirmDeleteProps {
  label: string; // "this block and its 9 reps"
  onConfirm: () => Promise<void>;
  children: ReactElement<ComponentPropsWithRef<"button">>; // the trigger
}

/**
 * Wraps a trigger element in a destructive-confirmation popover, matching the
 * project's `Popover` interaction pattern (anchored, dismiss on outside-click
 * or Escape). Confirm invokes `onConfirm` and closes; Cancel just closes.
 */
export function ConfirmDelete({ label, onConfirm, children }: ConfirmDeleteProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const trigger = cloneElement(children, {
    ref: anchorRef,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) setOpen(true);
    },
  });

  async function confirm() {
    await onConfirm();
    setOpen(false);
  }

  return (
    <span className="confirm-delete-anchor">
      {trigger}
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
