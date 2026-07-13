import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import "./Popover.css";

type Align = "start" | "center" | "end";

interface PopoverProps {
  /** The trigger element the popover is positioned against. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment of the panel relative to the anchor. */
  align?: Align;
  /** Gap between anchor and panel, in px. */
  offset?: number;
  /** Accessible label for the panel. */
  label?: string;
  /** A wider measured surface for forms such as Settings. */
  size?: "default" | "wide";
}

/**
 * Dependency-free anchored popover (no floating-ui — YAGNI). Positions a panel
 * below its anchor, animates in/out with a scale+fade spring, and dismisses on
 * outside-click or Escape. Keeps focus sane by moving focus into the panel on
 * open and restoring it to the anchor on close.
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  align = "end",
  offset = 8,
  label,
  size = "default",
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  // Keep the panel mounted through the exit animation. `render` gates the DOM;
  // `visible` drives the enter/exit CSS state.
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const position = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    // `getBoundingClientRect()` includes the entrance scale transform. Use the
    // untransformed layout width so a panel does not grow past the viewport
    // after positioning (especially the wide Settings surface).
    const panelWidth = panel.offsetWidth || p.width;

    let left: number;
    if (align === "start") left = a.left;
    else if (align === "center") left = a.left + a.width / 2 - panelWidth / 2;
    else left = a.right - panelWidth;

    // Clamp within the viewport with an 8px margin.
    const margin = 8;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
    const top = a.bottom + offset;

    setPos({ top, left });
  }, [anchorRef, align, offset]);

  // Mount on open.
  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  // After mount, measure/position then flip to visible on the next frame so the
  // enter transition actually runs.
  useLayoutEffect(() => {
    if (!render) return;
    position();
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [render, open, position]);

  // Reposition while open on resize/scroll.
  useEffect(() => {
    if (!open) return;
    const handler = () => position();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, position]);

  // Focus management + Escape + outside-click.
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);

    // Move focus into the panel for keyboard users.
    const focusRaf = requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      cancelAnimationFrame(focusRaf);
      // Restore focus to the trigger when closing.
      anchor?.focus?.();
    };
  }, [open, onClose, anchorRef]);

  if (!render) return null;

  const onTransitionEnd = () => {
    // Unmount only once the exit animation has finished.
    if (!open) {
      setRender(false);
      setPos(null);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      aria-labelledby={label ? undefined : labelId}
      tabIndex={-1}
      className="popover-panel"
      data-visible={visible}
      data-size={size}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
    </div>
  );
}
