import { useEffect, type ReactNode } from "react";
import "./ui.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  label?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Minimal modal for confirm cards. Hairline-bordered surface over a dim
 * backdrop; Escape and backdrop click both close. No decorative chrome.
 */
export function Dialog({
  open,
  onClose,
  title,
  label,
  className,
  children,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ck-dialog-backdrop" onClick={onClose}>
      <div
        className={`ck-dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {title != null ? (
          <header className="ck-dialog-head">{title}</header>
        ) : null}
        <div className="ck-dialog-body">{children}</div>
      </div>
    </div>
  );
}
