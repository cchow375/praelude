import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  clampPanelWidth,
  clampPosition,
  pillStackIndex,
  PILL_STACK_STEP_PX,
  type Size,
} from "./dockState";
import { useDock, useDockContext } from "./DockProvider";
import "./dock.css";

interface DockPanelProps {
  /** Open union — "rep" | "paused" | "clock" are the known ids so far. */
  id: string;
  title: string;
  defaultPosition: { x: number; y: number };
  /** Target width in px. Panels with denser content (e.g. the rep HUD's
   * verdict buttons + streak + drawer) can ask for more room than the
   * default; it is still clamped to the viewport (never edge-to-edge, never
   * below MIN_PANEL_WIDTH) so the 720x520 dense-layout floor always holds. */
  width?: number;
  children: ReactNode;
}

// Arrow-key nudge for keyboard users, per the brief.
const KEYBOARD_STEP = 8;

// Historical default — the framework's original single-size panel (A2). New
// panels that need more room (Task A3's rep panel) pass their own `width`.
const DEFAULT_PANEL_WIDTH = 320;

// Fallback panel footprint used for clamp math before the panel has ever
// been laid out (first paint) or in jsdom, which reports a zero-size rect.
const FALLBACK_SIZE: Size = { width: 260, height: 200 };

type Drag = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

/**
 * Chrome for a persistent, draggable, non-modal dock surface: a title bar
 * (drag handle + minimize + close), a body, and a collapsed "pill" form when
 * minimized. Position and open/minimized state live in DockProvider and
 * persist to localStorage across launches.
 */
export function DockPanel({
  id,
  title,
  defaultPosition,
  width = DEFAULT_PANEL_WIDTH,
  children,
}: DockPanelProps) {
  const ctx = useDockContext();
  const dock = useDock(id);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    ctx.ensurePanel(id, defaultPosition);
    // Only register once per (id, defaultPosition) pair — re-registering on
    // every render would fight a user's drag/keyboard moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const panel = ctx.getPanel(id, defaultPosition);

  const panelSize = useCallback((): Size => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    return FALLBACK_SIZE;
  }, []);

  const moveClamped = useCallback(
    (x: number, y: number) => {
      const clamped = clampPosition(x, y, panelSize(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      ctx.move(id, clamped.x, clamped.y);
    },
    [ctx, id, panelSize],
  );

  // Window-level pointermove/pointerup while a drag is in progress — the
  // same pattern as components/FloatingPanel.tsx, which survives the pointer
  // leaving the title bar mid-drag.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const active = drag.current;
      if (!active) return;
      moveClamped(
        active.originX + (e.clientX - active.startX),
        active.originY + (e.clientY - active.startY),
      );
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moveClamped]);

  function beginDrag(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    ctx.focus(id);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: panel.x,
      originY: panel.y,
    };
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      dock.minimize();
      return;
    }
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -KEYBOARD_STEP;
    else if (e.key === "ArrowRight") dx = KEYBOARD_STEP;
    else if (e.key === "ArrowUp") dy = -KEYBOARD_STEP;
    else if (e.key === "ArrowDown") dy = KEYBOARD_STEP;
    else return;
    e.preventDefault();
    moveClamped(panel.x + dx, panel.y + dy);
  }

  // Fix wave item 7: a registered panel must never be fully invisible. The
  // old contract rendered NOTHING for a never-opened/closed panel (`open`
  // false) — with nothing to ever call `dock.open()` on its own (no toolbar,
  // no menu), a closed panel like the clock was permanently unreachable.
  // Closed now collapses into the SAME pill affordance as minimized, so
  // "closed" and "minimized" are visually identical (both a pill) — only
  // their persisted `open` flag differs, and that distinction still matters
  // for `close()` vs `minimize()`'s own semantics (see DockProvider).
  if (!panel.open || panel.minimized) {
    const stackIndex = pillStackIndex(ctx.state, id);
    return (
      <button
        type="button"
        className={panel.flashing ? "dock-pill dock-pill-flash" : "dock-pill"}
        style={{
          zIndex: panel.z,
          bottom: `calc(var(--s-3) + ${stackIndex * PILL_STACK_STEP_PX}px)`,
        }}
        onClick={dock.open}
        aria-label={`Restore ${title}`}
      >
        {title}
      </button>
    );
  }

  // Clamped against the CURRENT viewport on every render (not just at open
  // time), so a panel already open when the window shrinks to the 720x520
  // floor re-clamps rather than clipping/overflowing.
  const effectiveWidth = clampPanelWidth(width, window.innerWidth);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={0}
      className="dock-panel"
      style={{
        transform: `translate(${panel.x}px, ${panel.y}px)`,
        zIndex: panel.z,
        width: `${effectiveWidth}px`,
      }}
      onPointerDown={() => ctx.focus(id)}
      onKeyDown={onKeyDown}
    >
      <div className="dock-panel-titlebar" onPointerDown={beginDrag}>
        <span className="dock-panel-title">{title}</span>
        <button
          type="button"
          className="dock-panel-minimize"
          aria-label={`Minimize ${title}`}
          onClick={dock.minimize}
        >
          &minus;
        </button>
        <button
          type="button"
          className="dock-panel-close"
          aria-label={`Close ${title}`}
          onClick={dock.close}
        >
          &times;
        </button>
      </div>
      <div className="dock-panel-body">{children}</div>
    </div>
  );
}
