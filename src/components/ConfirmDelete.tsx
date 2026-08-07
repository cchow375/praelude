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

/** One named destructive choice, for the (rare) case where a delete has more
 * than one honest outcome — e.g. Task C5's cascade-vs-promote choice when
 * deleting a region with children. Omit `actions` entirely for the normal
 * single-outcome case; that path is unchanged. */
export interface ConfirmDeleteAction {
  label: string; // "Delete sub-sections too"
  onSelect: () => Promise<void>;
  danger?: boolean; // styles like the default single Confirm button; defaults true
}

export interface ConfirmDeleteProps {
  label: string; // "this block and its 9 reps"
  onConfirm?: () => Promise<void>;
  /** Present 2+ named choices instead of the single default "Confirm"
   * button. When given, `onConfirm` is ignored. */
  actions?: ConfirmDeleteAction[];
  children: ReactElement<ComponentPropsWithRef<"button">>; // the trigger
}

/**
 * Wraps a trigger element in a destructive-confirmation popover, matching the
 * project's `Popover` interaction pattern (anchored, dismiss on outside-click
 * or Escape). Confirm invokes `onConfirm` and closes; Cancel just closes.
 */
export function ConfirmDelete({
  label,
  onConfirm,
  actions,
  children,
}: ConfirmDeleteProps) {
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
    await onConfirm?.();
    setOpen(false);
  }

  async function select(action: ConfirmDeleteAction) {
    await action.onSelect();
    setOpen(false);
  }

  return (
    <span className="confirm-delete-anchor">
      {trigger}
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        label="Confirm delete"
      >
        <div className="confirm-delete-body">
          <p className="confirm-delete-label">{label}</p>
          <div className="confirm-delete-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            {actions ? (
              actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={
                    action.danger === false ? "" : "confirm-delete-danger"
                  }
                  onClick={() => void select(action)}
                >
                  {action.label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="confirm-delete-danger"
                onClick={confirm}
              >
                Confirm
              </button>
            )}
          </div>
        </div>
      </Popover>
    </span>
  );
}
