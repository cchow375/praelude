import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useDockContext } from "./DockProvider";
import "./dock.css";

const UTILITY_TOOLS = [
  { id: "clock", title: "Clock" },
  { id: "dynamics", title: "Dynamics" },
  { id: "rotation", title: "Practice rotation" },
] as const;

/** Residuals fix wave (defect 4, "pill occludes page content"): a REAL
 * layout element at the shell's bottom edge — mounted once, always present
 * — that minimized/closed panels' pills portal into (see DockPanel.tsx).
 * This is the "by construction" fix the brief preferred over a
 * fixed-overlay-plus-padding patch: a live-QA reproduction at 720x520 showed
 * a day sheet's carry-forward button sitting under the fixed pill stack on
 * the very FIRST (unscrolled) paint — no scroll-to-bottom involved, so
 * reserving space only at the scroll container's trailing edge could never
 * have caught it. A real grid row shrinks the scroll container's own
 * available height instead, so nothing can ever render underneath it, at
 * any scroll position.
 *
 * Collapses to zero height via `.dock-pill-bar:empty` in dock.css. Direct
 * Rep/Paused pills portal into it; its compact Tools disclosure is rendered
 * only while DockProvider has a restorable utility panel, so the row still
 * contains no dead placeholder when every panel is visible. */
export function DockPillBar() {
  const ctx = useDockContext();
  const ref = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const initialMenuFocus = useRef<"first" | "last">("first");
  const [toolsOpen, setToolsOpen] = useState(false);

  useLayoutEffect(() => {
    ctx.setPillBarNode(ref.current);
    return () => ctx.setPillBarNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The three low-frequency panels still own their real persisted dock state
  // and DockPanel open/minimize/close semantics. This component only replaces
  // their three always-visible restore pills with one compact disclosure. Rep
  // Counter and Paused Sets remain direct portal children of this bar because
  // they are the hot-loop/urgent controls where an extra click costs practice
  // time.
  const restorableUtilityTools = useMemo(
    () =>
      UTILITY_TOOLS.filter(({ id }) => {
        const panel = ctx.state[id];
        return panel != null && (!panel.open || panel.minimized);
      }),
    [ctx.state],
  );
  const utilityNeedsAttention = restorableUtilityTools.some(
    ({ id }) => ctx.state[id]?.flashing,
  );

  useEffect(() => {
    if (restorableUtilityTools.length === 0) setToolsOpen(false);
  }, [restorableUtilityTools.length]);

  // A real menu interaction, not hover-only CSS: it dismisses on an outside
  // press, remains reachable by Tab, and puts focus somewhere useful as soon
  // as a keyboard user opens it.
  useEffect(() => {
    if (!toolsOpen) return undefined;

    const items = toolsMenuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    if (items && items.length > 0) {
      const index = initialMenuFocus.current === "last" ? items.length - 1 : 0;
      items[index]?.focus();
    }

    function dismissOnOutsidePress(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    }
    window.addEventListener("pointerdown", dismissOnOutsidePress);
    return () => window.removeEventListener("pointerdown", dismissOnOutsidePress);
  }, [toolsOpen]);

  function openTools(initialFocus: "first" | "last" = "first") {
    initialMenuFocus.current = initialFocus;
    setToolsOpen(true);
  }

  function closeTools({ restoreFocus = false } = {}) {
    setToolsOpen(false);
    if (restoreFocus) toolsButtonRef.current?.focus();
  }

  function onToolsButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openTools("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openTools("last");
    } else if (event.key === "Escape" && toolsOpen) {
      event.preventDefault();
      closeTools({ restoreFocus: true });
    }
  }

  function onToolsMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      toolsMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeTools({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      closeTools();
      return;
    }
    if (items.length === 0) return;

    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next == null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div
      ref={ref}
      id="dock-pill-bar"
      className="dock-pill-bar"
      role="toolbar"
      aria-label="Practice tools"
    >
      {restorableUtilityTools.length > 0 && (
        <div ref={toolsRef} className="dock-pill-tools">
          <button
            ref={toolsButtonRef}
            type="button"
            className={`dock-pill dock-pill-tools-trigger${
              utilityNeedsAttention ? " dock-pill-flash" : ""
            }`}
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
            aria-controls="dock-pill-tools-menu"
            onClick={() => (toolsOpen ? closeTools() : openTools("first"))}
            onKeyDown={onToolsButtonKeyDown}
          >
            Tools
            <span className="dock-pill-tools-chevron" aria-hidden="true">
              {toolsOpen ? "▾" : "▴"}
            </span>
          </button>

          {toolsOpen && (
            <div
              ref={toolsMenuRef}
              id="dock-pill-tools-menu"
              className="dock-pill-tools-menu"
              role="menu"
              aria-label="More practice tools"
              onKeyDown={onToolsMenuKeyDown}
            >
              {restorableUtilityTools.map(({ id, title }) => {
                const needsAttention = ctx.state[id]?.flashing;
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className={`dock-pill-tools-item${
                      needsAttention ? " dock-pill-tools-item--urgent" : ""
                    }`}
                    onClick={() => {
                      ctx.open(id);
                      closeTools();
                    }}
                  >
                    <span>{title}</span>
                    {needsAttention && (
                      <span className="dock-pill-tools-status">Attention</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
