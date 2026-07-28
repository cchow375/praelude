import {
  cloneElement,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Popover } from "../../components/Popover";
import "../../components/ConfirmDelete.css";

// ---------------------------------------------------------------------------
// Typed-name archive confirmation. Reuses the ConfirmDelete idiom (an anchored
// Popover on a trigger) but gates Confirm behind typing the piece's exact name,
// mirroring the backend `piece_archive` typed-name requirement so removal is a
// deliberate, unambiguous act.
// ---------------------------------------------------------------------------

export interface ConfirmArchiveProps {
  /** The exact name the user must type (piece folder name or title). */
  expected: string;
  onConfirm: () => Promise<void>;
  children: ReactElement<ComponentPropsWithRef<"button">>;
}

export function ConfirmArchive({
  expected,
  onConfirm,
  children,
}: ConfirmArchiveProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const trigger = cloneElement(children, {
    ref: anchorRef,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) {
        setTyped("");
        setOpen(true);
      }
    },
  });

  const gateOpen =
    typed.trim() === expected.trim() && expected.trim().length > 0;

  async function confirm() {
    if (!gateOpen || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="confirm-delete-anchor">
      {trigger}
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        label="Confirm remove"
      >
        <div className="confirm-delete-body">
          <p className="confirm-delete-label">
            Type <strong>{expected}</strong> to remove this piece.
          </p>
          <input
            type="text"
            aria-label="Type the piece name to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
          <div className="confirm-delete-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="confirm-delete-danger"
              disabled={!gateOpen || busy}
              onClick={confirm}
            >
              Remove
            </button>
          </div>
        </div>
      </Popover>
    </span>
  );
}
