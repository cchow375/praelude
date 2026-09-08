import { useLayoutEffect, useState, type KeyboardEventHandler, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Menus stay in the viewport, including the bottom shelf and compact windows. */
export function LibraryMenu({ anchor, menuRef, label, folder = false, onKeyDown, onFocusLeave, children }: {
  anchor: HTMLElement | null;
  menuRef: RefObject<HTMLDivElement | null>;
  label: string;
  folder?: boolean;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onFocusLeave: () => void;
  children: ReactNode;
}) {
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8));
      let top = bounds.bottom + 6;
      if (top + height > window.innerHeight - 8) top = Math.max(8, Math.min(bounds.top - height - 6, window.innerHeight - height - 8));
      setPosition((previous) => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(menu);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, menuRef]);
  return createPortal(<div ref={menuRef} className={`piece-context-menu piece-library-floating-menu${folder ? " piece-folder-menu" : ""}`} role="menu" aria-label={label} onKeyDown={onKeyDown} onBlur={(event) => {
    const next = event.relatedTarget;
    // Native pickers and browser window changes can temporarily leave no DOM
    // target. A real move to another control dismisses without reclaiming focus.
    if (next instanceof Node && !event.currentTarget.contains(next) && !anchor?.contains(next)) onFocusLeave();
  }} style={position}>{children}</div>, document.body);
}
