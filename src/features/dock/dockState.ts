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

/** Clamp a candidate (x, y) so at least MIN_VISIBLE_PX of the panel stays
 * on screen in every direction, given the panel's own size and the current
 * viewport. Pure — the caller supplies both sizes so this never touches
 * `window` (jsdom has no real layout, so tests inject fixed numbers). */
export function clampPosition(
  x: number,
  y: number,
  size: Size,
  viewport: Size,
): { x: number; y: number } {
  const minX = MIN_VISIBLE_PX - size.width;
  const maxX = viewport.width - MIN_VISIBLE_PX;
  const minY = MIN_VISIBLE_PX - size.height;
  const maxY = viewport.height - MIN_VISIBLE_PX;
  return {
    // When the panel is larger than the viewport allows for a valid range
    // (max < min), prefer keeping the panel fully anchored at min.
    x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
  };
}

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
