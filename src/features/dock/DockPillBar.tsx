import { useLayoutEffect, useRef } from "react";
import { useDockContext } from "./DockProvider";
import "./dock.css";

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
 * Collapses to zero height via `.dock-pill-bar:empty` in dock.css — CSS
 * reacts to whether any pill has actually portaled in, not a separately
 * tracked pill count that could drift out of sync with it. */
export function DockPillBar() {
  const ctx = useDockContext();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    ctx.setPillBarNode(ref.current);
    return () => ctx.setPillBarNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // §4b: a bare row of pills reads as decoration, not as tools you can open —
  // that was one of two premises `before-today-720x520.png` confirmed. The
  // label is rendered into the SAME node the pills portal into (the ref
  // target), and only when a pill actually exists, so `.dock-pill-bar:empty`
  // still governs the true empty case (nothing minimized/closed) and the row
  // keeps collapsing to zero height then — no dead space added.
  const hasPills = Object.values(ctx.state).some(
    (panel) => !panel.open || panel.minimized,
  );

  return (
    <div
      ref={ref}
      id="dock-pill-bar"
      className="dock-pill-bar"
      role="toolbar"
      aria-label="Practice tools"
    >
      {hasPills && <span className="dock-pill-bar-label">Tools</span>}
    </div>
  );
}
