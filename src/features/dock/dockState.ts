// Pure state + localStorage persistence for the Practice Dock floating-panel
// framework. No React here — DockProvider owns the React lifecycle, this
// module owns the data shape, the clamp/z-order math, and the storage
// round-trip so both can be unit-tested without a DOM.

export interface DockPanelState {
  x: number;
  y: number;
  minimized: boolean;
  open: boolean;
  z: number;
  /** Task A6: a transient "just happened" signal (e.g. a countdown
   * completing while minimized) so the pill can flash. Not persisted
   * meaningfully across launches — it is cleared moments after being set,
   * same as any other one-shot UI pulse; surviving in localStorage between
   * sessions would be harmless but is never relied upon. */
  flashing: boolean;
}

export type DockState = Record<string, DockPanelState>;

export interface Size {
  width: number;
  height: number;
}

export const DOCK_STORAGE_KEY = "ck.dock.v1";

// A dragged/keyboard-moved panel is never allowed to leave less than this
// many px of itself visible on screen — the title bar (drag handle, close,
// minimize buttons) must always stay reachable.
export const MIN_VISIBLE_PX = 48;

// A panel's requested width may exceed a short/narrow viewport (the 720x520
// dense-layout floor). Each side keeps at least this much clear so the panel
// can never claim the FULL viewport width edge-to-edge — some of the
// underlying workspace/nav rail must always stay visible around it.
export const PANEL_WIDTH_EDGE_MARGIN = 24;

/** The floor a clamped panel width never drops below, regardless of how
 * narrow the viewport is — below this a panel's own controls (verdict
 * buttons, title bar) stop being usable. */
export const MIN_PANEL_WIDTH = 200;

/** Clamp a panel's requested width to what the viewport can actually give it
 * (see PANEL_WIDTH_EDGE_MARGIN), without ever going below MIN_PANEL_WIDTH.
 * Pure — like clampPosition, the caller supplies viewportWidth so this never
 * touches `window` and stays trivially testable outside the DOM. */
export function clampPanelWidth(
  requestedWidth: number,
  viewportWidth: number,
): number {
  const available = viewportWidth - PANEL_WIDTH_EDGE_MARGIN * 2;
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.min(requestedWidth, Math.max(MIN_PANEL_WIDTH, available)),
  );
}

export function defaultPanelState(
  overrides: Partial<DockPanelState> = {},
): DockPanelState {
  return {
    x: 0,
    y: 0,
    minimized: false,
    open: false,
    z: 0,
    flashing: false,
    ...overrides,
  };
}

/** Clamp a candidate (x, y) so at least `minVisible` px of the panel stays
 * on screen in every direction, given the panel's own size and the current
 * viewport. Pure — the caller supplies both sizes so this never touches
 * `window` (jsdom has no real layout, so tests inject fixed numbers).
 *
 * `minVisible` defaults to MIN_VISIBLE_PX (the drag/keyboard-nudge floor —
 * a user actively dragging only needs enough of the panel left reachable to
 * grab it back). Residuals fix wave: the become-visible path (mount-open,
 * pill-restore, open()) uses the larger MIN_VISIBLE_ON_OPEN_PX floor instead
 * — see DockPanel.tsx — because a panel a user did not just finish dragging
 * must show its title bar AND a first row of content, not just a sliver. */
export function clampPosition(
  x: number,
  y: number,
  size: Size,
  viewport: Size,
  minVisible: number = MIN_VISIBLE_PX,
): { x: number; y: number } {
  const minX = minVisible - size.width;
  const maxX = viewport.width - minVisible;
  const minY = minVisible - size.height;
  const maxY = viewport.height - minVisible;
  return {
    // When the panel is larger than the viewport allows for a valid range
    // (max < min), prefer keeping the panel fully anchored at min.
    x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
  };
}

/** Residuals fix wave round 2 (defect 1 REFUTED on first pass — see below):
 * the floor used the FIRST time a panel becomes visible (mount already-open,
 * pill-restore click, or a programmatic `open()`) — deliberately larger than
 * the drag floor (MIN_VISIBLE_PX) and now EQUAL to `DOCK_PANEL_MIN_HEIGHT_PX`
 * (below) so the two stay in lockstep: this is the floor the become-visible
 * clamp (and `resolveCollision`'s own final fallback) hold `y` to, and it is
 * exactly the minimum height a panel's OWN box is ever squeezed to. Keeping
 * them equal is what guarantees a panel's bottom edge can never land past the
 * viewport — see `dockPanelMaxHeight`'s doc comment for the full argument. */
export const MIN_VISIBLE_ON_OPEN_PX = 160;

/** Residuals fix wave round 2: the floor a panel's OWN clamped box height is
 * never squeezed below, regardless of how little room is left below its `y`
 * — matches `MIN_VISIBLE_ON_OPEN_PX` (the `y` clamp keeps at least this much
 * room below any panel's top on open, so the two together guarantee a panel
 * box can ALWAYS render at least this tall without its bottom edge crossing
 * the viewport edge). */
export const DOCK_PANEL_MIN_HEIGHT_PX = MIN_VISIBLE_ON_OPEN_PX;

/** Small clearance kept between a panel's bottom edge and the viewport's own
 * bottom edge — purely cosmetic (so the panel never touches the very edge),
 * not load-bearing for the containment guarantee itself. */
export const DOCK_PANEL_BOTTOM_MARGIN_PX = 16;

/** Residuals fix wave (defect 2, "rep panel overlaps tray"): the vertical
 * budget any SINGLE dock panel's body is allowed to CLAIM at the 720x520
 * dense-layout floor when it has the whole viewport to itself — mirrored by
 * `.dock-panel`'s CSS `max-height` (dock.css). Past this the body scrolls
 * internally (`.dock-panel-body { overflow-y: auto }`) instead of the panel
 * growing outward. This is what makes default-position stacking math
 * "honest": earlier code guessed at a real rendered height (RepPanel's old
 * `ASSUMED_MAX_HEIGHT = 260`, which live QA showed undershot the real
 * ~450-500px drawer); now the number IS a ceiling enforced by CSS, not a
 * guess about content that could grow past it. */
export const DOCK_PANEL_HEIGHT_MARGIN_PX = 220;

/**
 * Residuals fix wave ROUND 2 (defect 1 REFUTED): round 1 clamped the
 * panel's POSITION but gave every panel the SAME fixed max-height
 * (`viewportHeight - DOCK_PANEL_HEIGHT_MARGIN_PX`) regardless of where it
 * actually ended up — with the rep panel expanded (eating most of the
 * viewport) and the clock pushed below it by `resolveCollision`'s
 * last-resort fallback, the clock's box still rendered its FULL fixed
 * max-height starting from a `y` deep in the viewport, so its own bottom
 * edge landed WELL PAST the viewport bottom. `.dock-panel-body`'s
 * `overflow-y: auto` only helps for content taller than the panel's OWN
 * box — it cannot bring pixels back onto screen that are outside the
 * viewport because the BOX ITSELF extends past it; that is a fundamentally
 * different failure than "content taller than its box".
 *
 * The fix: a panel's max-height is now the SMALLER of (a) the fixed
 * per-viewport budget above (so one panel opening alone still can't hog the
 * entire screen, preserving room for others to stack) and (b) the actual
 * room left between its OWN `y` and the viewport bottom (so its box can
 * NEVER extend past the viewport, wherever collision-avoidance or clamping
 * put it). Combined with the `y`-clamp guaranteeing at least
 * `DOCK_PANEL_MIN_HEIGHT_PX` of room below any panel's top (see
 * `MIN_VISIBLE_ON_OPEN_PX`/`resolveCollision`), this makes "the box is
 * always fully on screen, and internal scroll is always genuinely reachable
 * for anything past its own visible height" a structural guarantee, not
 * something that can be defeated by an unlucky `y`. */
export function dockPanelMaxHeight(
  viewportHeight: number,
  panelY: number = 0,
): number {
  const fixedBudget = Math.max(
    DOCK_PANEL_MIN_HEIGHT_PX,
    viewportHeight - DOCK_PANEL_HEIGHT_MARGIN_PX,
  );
  const roomBelowY = viewportHeight - panelY - DOCK_PANEL_BOTTOM_MARGIN_PX;
  return Math.max(DOCK_PANEL_MIN_HEIGHT_PX, Math.min(fixedBudget, roomBelowY));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure axis-aligned-rectangle intersection test. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Residuals fix wave (defect 2): when a panel becomes visible, its
 * viewport-clamped candidate rect can still land on top of another panel
 * that is ALREADY visible (e.g. the rep panel's real drawer height eating
 * most of the 720x520 floor before the paused-sets tray opens below it).
 * Pushes the candidate below the bottom-most rect it collides with, then
 * re-clamps `y` to the viewport with `minVisible` (the caller passes
 * `MIN_VISIBLE_ON_OPEN_PX` — see dockState.ts round 2 notes above: this is
 * the SAME floor `dockPanelMaxHeight` relies on to guarantee a panel's own
 * box never extends past the viewport, so the two must be called with the
 * same number). No rect intersection wins over that floor when the two
 * conflict — a silently-overlapped panel is worse than one squeezed to its
 * minimum usable height. Pure. */
export function resolveCollision(
  candidate: Rect,
  others: Rect[],
  viewport: Size,
  minVisible: number = MIN_VISIBLE_PX,
): { x: number; y: number } {
  let y = candidate.y;
  for (const other of others) {
    if (rectsIntersect({ ...candidate, y }, other)) {
      y = Math.max(y, other.y + other.height + PANEL_STACK_GAP_PX);
    }
  }
  const maxY = viewport.height - minVisible;
  const minY = minVisible - candidate.height;
  y = Math.min(Math.max(y, minY), Math.max(minY, maxY));
  return { x: candidate.x, y };
}

/** Gap kept between two panels stacked by `resolveCollision`. */
export const PANEL_STACK_GAP_PX = 8;

/** Immutably merge `updates` into panel `id`, creating it from `fallback`
 * defaults first if it does not exist yet. */
export function withPanel(
  state: DockState,
  id: string,
  updates: Partial<DockPanelState>,
  fallback: Partial<DockPanelState> = {},
): DockState {
  const existing = state[id] ?? defaultPanelState(fallback);
  return { ...state, [id]: { ...existing, ...updates } };
}

/** Fix wave item 9: the shell's nav rail is a fixed 148px-wide column
 * (shell.css `.shell` grid-template-columns) — a dock panel default position
 * with x below this covers it. Kept here (not imported from CSS) so the
 * dock's pure layer stays framework-agnostic; DockPanel-hosting components
 * cross-check against it in their own default-position tests. */
export const NAV_RAIL_WIDTH = 148;

/** The minimum window size every dock surface must stay usable at (repeated
 * throughout this feature's tests/comments as "the 720x520 dense-layout
 * floor"). Exported so default-position math has one canonical source for
 * the number instead of several modules hardcoding `720`/`520` separately. */
export const DENSE_LAYOUT_FLOOR: Size = { width: 720, height: 520 };

/** Fix wave item 6: minimized/closed panels used to all pin to the exact
 * same fixed bottom-right coordinates (dock.css) — with more than one pill
 * up, only the topmost was clickable. Each currently-pill-form panel (closed
 * OR minimized — see item 7's collapse of "closed" into the same pill
 * affordance) gets a distinct vertical slot, in a stable id-sorted order so
 * the stack never reshuffles under the user while other panel state changes. */
export const PILL_STACK_STEP_PX = 44;

/** This panel's 0-based slot in the pill stack, among every OTHER panel
 * currently shown as a pill (closed or minimized). Pure — same spirit as
 * `clampPosition`/`clampPanelWidth`: the caller (DockPanel) supplies the
 * state, this never touches the DOM. */
export function pillStackIndex(state: DockState, id: string): number {
  const pillIds = Object.keys(state)
    .filter((key) => {
      const panel = state[key];
      return !panel.open || panel.minimized;
    })
    .sort();
  const index = pillIds.indexOf(id);
  return index < 0 ? 0 : index;
}

/** The z a panel must take to become the topmost — one above the current max. */
export function nextZ(state: DockState): number {
  const zs = Object.values(state).map((p) => p.z);
  return (zs.length ? Math.max(...zs) : 0) + 1;
}

/** Raise panel `id` to the top of the z-order (max z + 1). */
export function raiseZ(
  state: DockState,
  id: string,
  fallback: Partial<DockPanelState> = {},
): DockState {
  return withPanel(state, id, { z: nextZ(state) }, fallback);
}

export function loadDockState(): DockState {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DockState;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveDockState(state: DockState): void {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or unavailable (e.g. private browsing); persistence
    // is best-effort, never load-bearing for correctness within a session.
  }
}
