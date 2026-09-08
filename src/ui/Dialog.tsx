import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./ui.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  label?: string;
  className?: string;
  children?: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]';
let openDialogs = 0;
let backgroundRoot: HTMLElement | null = null;
let backgroundWasInert = false;

function lockBackground() {
  if (openDialogs++ > 0) return;
  backgroundRoot = document.getElementById("root");
  backgroundWasInert = backgroundRoot?.hasAttribute("inert") ?? false;
  backgroundRoot?.setAttribute("inert", "");
}

function unlockBackground() {
  if (--openDialogs > 0) return;
  if (!backgroundWasInert) backgroundRoot?.removeAttribute("inert");
  backgroundRoot = null;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (ancestor === dialog) break;
    }
    return !Array.from(dialog.querySelectorAll("details:not([open])")).some((details) =>
      details.contains(element) && !details.querySelector("summary")?.contains(element));
  });
}

function isTopDialog(dialog: HTMLElement): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>("[data-praelude-modal]");
  return dialogs[dialogs.length - 1] === dialog;
}

/** Modal surface outside workspace clipping, with contained keyboard focus and
 * opener restoration. Only the uppermost dialog owns Tab and Escape. */
export function Dialog({ open, onClose, title, label, className, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBackground();
    const focusFirst = () => (focusableElements(dialog)[0] ?? dialog).focus();
    if (isTopDialog(dialog)) focusFirst();

    const onKey = (event: KeyboardEvent) => {
      if (!isTopDialog(dialog) || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const controls = focusableElements(dialog);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopDialog(dialog) && !dialog.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      unlockBackground();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ck-dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`ck-dialog${className ? ` ${className}` : ""}`}
        data-praelude-modal="true"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={!label && title != null ? titleId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {title != null ? <header id={titleId} className="ck-dialog-head">{title}</header> : null}
        <div className="ck-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
