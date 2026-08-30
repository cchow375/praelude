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

/** Fallback panel footprint used for clamp math before a panel's real
 * rendered size is known — before first paint (DockPanel.tsx's `panelSize`),
 * or in jsdom, which always reports a zero-size rect. `ensurePanel`
 * (DockProvider.tsx) does NOT use this — it derives each panel's real
 * per-panel size from its own `width` prop + `dockPanelMaxHeight` instead
 * (round 2 fix: a shared constant here silently corrupted wide panels'
 * legitimately-dragged positions, see `reclampPanel`'s doc comment). */
export const DOCK_PANEL_FALLBACK_SIZE: Size = { width: 260, height: 200 };

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

/** Persisted positions can predate a resize or display change; never trust
 * them past the current viewport. Unlike the become-visible clamp effect
 * (DockPanel.tsx), which only runs on a false->true `open` transition, this
 * covers a case that effect never sees: a panel that mounts ALREADY open
 * (restored from localStorage as `open: true`) fires no such transition, so
 * `ensurePanel` (DockProvider.tsx) is the only seam that ever gets a chance
 * to catch a stale off-viewport position for it. Pure — same spirit as
 * `clampPosition`: the caller supplies size/viewport.
 *
 * Round 2 fix: `size` MUST be the panel's own real configured size (its
 * `width` prop run through `clampPanelWidth`, its height from the y-aware
 * `dockPanelMaxHeight` — exactly what DockPanel renders at), never a shared
 * fallback constant. The first pass here used `DOCK_PANEL_FALLBACK_SIZE`
 * (260x200) for every panel; RepPanel renders at 440px wide, so a
 * legitimately-dragged position well within its real 440px footprint could
 * measure as out-of-range under the narrower fallback and get silently
 * shifted — corrupting a good drag with no resize or display change
 * involved, then persisting the wrong position via `saveDockState`. */
export function reclampPanel(
  p: DockPanelState,
  size: Size,
  viewport: Size,
): DockPanelState {
  const { x, y } = clampPosition(p.x, p.y, size, viewport, MIN_VISIBLE_PX);
  return x === p.x && y === p.y ? p : { ...p, x, y };
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

/** The origin the tray -> clock default-position chain stacks down from
 * (PausedSetsTray.tsx / ClockPanel.tsx), deliberately INDEPENDENT of
 * RepPanel's own default `y`.
 *
 * Real-use fix wave (item 4, round 4): the chain used to start at RepPanel's
 * `DEFAULT_POSITION.y`, so every tweak to where the rep panel starts shoved
 * the tray and clock down by the same amount. Rounds 2-3 moved rep from 16
 * to 108, which pushed `ClockPanel.DEFAULT_POSITION.y` from a measured-good
 * 504 (inside the 720x520 floor, Start/Reset reachable without inner
 * scrolling) to 596 (past the floor entirely, Start/Reset off-screen at a
 * ~1440x900 window). Pinning the chain's origin here decouples the STARTING
 * point of the two — rep's default is tuned against the shell topbar, the
 * chain is tuned against the dense-layout floor, and moving `DOCK_CHAIN_BASE_Y`
 * no longer moves RepPanel's own `y`, nor vice versa.
 *
 * The decoupling is NOT total, though: `RepPanel.ASSUMED_MAX_HEIGHT =
 * dockPanelMaxHeight(520, RepPanel.DEFAULT_POSITION.y)` still feeds the
 * chain through that second argument, because a taller/shorter rep panel
 * genuinely does need more/less room reserved above the tray. This is
 * benign for RepPanel's current `y: 108` (chain stays 340/504), but is not
 * inert in general — e.g. `y: 340` would shrink `ASSUMED_MAX_HEIGHT` to 164
 * and shift the chain to 204/368. What actually prevents a SILENT
 * regression is `dockDefaultLayout.test.ts`'s "keeps both chained defaults
 * (tray and clock) inside the 520px floor" test, which pins
 * `PAUSED_DEFAULT_POSITION.y === 340` and `CLOCK_DEFAULT_POSITION.y === 504`
 * — any future change to RepPanel's `y` that shifts the chain fails that
 * assertion instead of shipping unnoticed.
 * 16 is the value the chain was measured good at. */
export const DOCK_CHAIN_BASE_Y = 16;

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

/* ---------------------------------------------------------------------------
 * The stacking contract (real-use fix wave, item 4, round 4)
 * ---------------------------------------------------------------------------
 * `panel.z` above is a *relative focus rank*, not a CSS z-index. Rendering it
 * directly (DockPanel.tsx used to do exactly that) started every panel at
 * `z: 0`/`1` — BELOW ordinary page content, which in this app routinely uses
 * z-index 1-8 (`.score-toolbar` is 4, `.score-atlas-draft-dock` is 8; see the
 * survey in task-4-report.md). The result: a "floating" panel rendered
 * BEHIND the page from mount, its own title bar (drag handle, minimize,
 * close) unclickable until an unrelated body click happened to bump
 * `nextZ` past the page. No default POSITION can fix that — the panel is
 * painted over wherever it sits — which is why three rounds of coordinate
 * tuning failed before this.
 *
 * The contract, in one place:
 *
 *   ordinary page content (1-8)  <  DOCK PANELS (10-39)  <  everything that
 *   is a genuinely global transient overlay:
 *     40  `.ck-ns-picker-scrim` (DaySheet.css), `.measure-map-panel-backdrop`
 *     50  `.heard-pill` (HeardPill.css), `.voice-feedback` (VoiceToast.css)
 *     60  `.day-sheet-overlay`
 *     90  shell rep-error             95  shell voice draft
 *    100  `.ck-dialog-backdrop` (ui.css), `.popover-panel`
 *    120  `.receipt-center`
 *
 * A dock panel is chrome the user parks over the page on purpose, so it must
 * beat page content unconditionally. It is NOT a modal, an alert, or a
 * dialog, so it must lose to every one of those. `dockPanelZIndex` maps the
 * unbounded focus rank into that window by RANK, not by raw value, so the
 * range can never be escaped no matter how many times a user clicks around
 * (raw `panel.z` grows without bound; the rendered index does not).
 * `dockStacking.test.ts` pins this contract. */
export const DOCK_Z_BASE = 10;

/** One below the lowest global-overlay layer (40). With `DOCK_Z_BASE` this
 * gives 30 distinct panel slots — the dock has 3 panels, so the cap is pure
 * defence against a future dock growing past the window.
 *
 * That defence is not free past 30 panels, though: `dockPanelZIndex` clamps
 * with `Math.min(DOCK_Z_BASE + rank, DOCK_Z_CEILING)`, so once the panel
 * count exceeds the 30 available slots, the excess panels all tie at the
 * ceiling instead of getting a distinct rank — e.g. with 40 panels open, the
 * 11 highest-ranked ones (ranks 29-39) all render at z-index 39, and
 * strict top-to-bottom focus ordering among THAT group is lost (ties
 * resolve by id, not by focus recency). Unreachable at the dock's current
 * size (3 panels, nowhere near 30), so this is a note for whoever adds
 * panel #31, not a live bug. */
export const DOCK_Z_CEILING = 39;

/** The CSS z-index a panel actually renders at: its rank among all panels'
 * focus ranks (`panel.z`), lifted into the [DOCK_Z_BASE, DOCK_Z_CEILING]
 * window. Ties (e.g. every panel still at the initial `z: 0`) break by id so
 * the order is stable rather than dependent on object key order. Pure — same
 * spirit as `clampPosition`/`pillStackIndex`: the caller supplies the state.
 *
 * Relative focus ordering is preserved exactly: `raiseZ` gives the focused
 * panel the strictly-largest `panel.z`, so it also gets the strictly-largest
 * rank, so it renders on top of its siblings. */
export function dockPanelZIndex(state: DockState, id: string): number {
  const ranked = Object.keys(state).sort((a, b) => {
    const dz = state[a].z - state[b].z;
    return dz !== 0 ? dz : a < b ? -1 : a > b ? 1 : 0;
  });
  const rank = ranked.indexOf(id);
  return Math.min(DOCK_Z_BASE + (rank < 0 ? 0 : rank), DOCK_Z_CEILING);
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

/** Real-use fix wave (item 4): the user-invoked "Reset panel layout" escape
 * hatch (SettingsPanel.tsx, Appearance section) for a dragged-into-a-corner
 * dock. Clears the persisted blob (best-effort, same as every other storage
 * access in this module — jsdom/private-browsing have no `localStorage`) and
 * dispatches `"ck:dock-reset"` so any mounted `DockProvider` can snap every
 * registered panel back to its own default position AND its initial
 * open/minimized flags — a reset that leaves a panel lost-minimized is not a
 * reset. Pure side effect, no return value: the provider owns re-deriving
 * state from the event, this module only owns the storage half. */
export function resetDockLayout(): void {
  try {
    window.localStorage?.removeItem(DOCK_STORAGE_KEY);
  } catch {
    /* storage is best-effort everywhere in this module */
  }
  window.dispatchEvent(new Event("ck:dock-reset"));
}
