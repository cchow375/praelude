import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultPanelState,
  loadDockState,
  raiseZ,
  reclampPanel,
  saveDockState,
  withPanel,
  DOCK_PANEL_FALLBACK_SIZE,
  type DockPanelState,
  type DockState,
  type Rect,
} from "./dockState";

interface DockContextValue {
  state: DockState;
  /** Registers panel `id` with its default position the first time it
   * mounts. If the panel already exists (e.g. restored from localStorage, or
   * already registered by an earlier mount), its position is re-clamped
   * against the current viewport instead of being reused verbatim — a
   * persisted position can predate a resize or display change, and for a
   * panel that mounts already `open` this is the ONLY seam that ever gets a
   * chance to catch that (DockPanel's become-visible clamp effect only
   * fires on a false->true transition — see `reclampPanel` in dockState.ts
   * for the full argument). Never fights an active drag/keyboard move —
   * this only runs once per mount, same as the old no-op did. */
  ensurePanel: (id: string, defaultPosition: { x: number; y: number }) => void;
  getPanel: (
    id: string,
    defaultPosition: { x: number; y: number },
  ) => DockPanelState;
  open: (id: string) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  /** Task A6: pulses `flashing` true on panel `id`'s pill/chrome, then clears
   * it after FLASH_DURATION_MS. Fires even while the panel is minimized (a
   * countdown completing in the background is the whole point) and is a
   * pure visual pulse — it never opens/focuses the panel itself. */
  flash: (id: string) => void;
  /** Residuals fix wave (defect 2): each visible DockPanel reports its own
   * measured screen rect here after every paint (a ref, not `state` — purely
   * ephemeral, never persisted, and mutating it must never itself trigger a
   * re-render). `null` clears a panel's rect when it stops being visible. */
  reportRect: (id: string, rect: Rect | null) => void;
  /** Every OTHER currently-visible panel's last-reported rect, for the
   * become-visible collision check (see dockState.ts's `resolveCollision`). */
  getOtherRects: (id: string) => Rect[];
  /** Residuals fix wave (defect 4, "pill occludes page content"): the real
   * `#dock-pill-bar` shell layout element (DockPillBar.tsx) a pill portals
   * into once it exists, so pills live as normal flow content in a reserved
   * bottom row instead of a `position: fixed` overlay that can sit on top of
   * whatever real content happens to render underneath it. `null` when no
   * bar is mounted (any DockPanel rendered standalone, e.g. in a test) — the
   * pill then falls back to its old fixed-position rendering. */
  pillBarNode: HTMLElement | null;
  setPillBarNode: (node: HTMLElement | null) => void;
}

/** How long a pill stays in its "flashing" visual state after `flash(id)`. */
export const FLASH_DURATION_MS = 1500;

const DockContext = createContext<DockContextValue | null>(null);

/**
 * Mounted once at shell level (Task A3). Owns the dock's persisted state —
 * registered panels, their positions, open/minimized flags and z-order — and
 * writes it back to localStorage (`ck.dock.v1`) on every change.
 */
export function DockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DockState>(() => loadDockState());

  // Persist after every commit, not on the initial load (which is itself a
  // read of what's already stored).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveDockState(state);
  }, [state]);

  const ensurePanel = useCallback(
    (id: string, defaultPosition: { x: number; y: number }) => {
      setState((prev) => {
        const existing = prev[id];
        if (!existing) {
          return withPanel(prev, id, {}, { ...defaultPosition, z: 0 });
        }
        // Same size/viewport accessors DockPanel.tsx's own become-visible
        // clamp effect uses (DOCK_PANEL_FALLBACK_SIZE, window.inner*) — this
        // provider has no DOM ref to measure a real size from here.
        const reclamped = reclampPanel(existing, DOCK_PANEL_FALLBACK_SIZE, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        return reclamped === existing ? prev : { ...prev, [id]: reclamped };
      });
    },
    [],
  );

  const getPanel = useCallback(
    (id: string, defaultPosition: { x: number; y: number }): DockPanelState =>
      state[id] ?? defaultPanelState({ ...defaultPosition }),
    [state],
  );

  const open = useCallback((id: string) => {
    setState((prev) =>
      raiseZ(withPanel(prev, id, { open: true, minimized: false }), id),
    );
  }, []);

  const close = useCallback((id: string) => {
    setState((prev) => withPanel(prev, id, { open: false }));
  }, []);

  const minimize = useCallback((id: string) => {
    setState((prev) => withPanel(prev, id, { minimized: true }));
  }, []);

  const focus = useCallback((id: string) => {
    setState((prev) => raiseZ(prev, id));
  }, []);

  const move = useCallback((id: string, x: number, y: number) => {
    setState((prev) => withPanel(prev, id, { x, y }));
  }, []);

  const flash = useCallback((id: string) => {
    setState((prev) => withPanel(prev, id, { flashing: true }));
    window.setTimeout(() => {
      setState((prev) => withPanel(prev, id, { flashing: false }));
    }, FLASH_DURATION_MS);
  }, []);

  // Ephemeral, non-persisted, non-reactive: a plain ref, not `state` —
  // updating it must never itself cause a re-render (every DockPanel reports
  // its own rect on every paint while visible).
  const rectsRef = useRef<Record<string, Rect | null>>({});
  const reportRect = useCallback((id: string, rect: Rect | null) => {
    rectsRef.current[id] = rect;
  }, []);
  const getOtherRects = useCallback((id: string): Rect[] => {
    return Object.entries(rectsRef.current)
      .filter(([key, rect]) => key !== id && rect != null)
      .map(([, rect]) => rect as Rect);
  }, []);

  const [pillBarNode, setPillBarNode] = useState<HTMLElement | null>(null);

  const value = useMemo<DockContextValue>(
    () => ({
      state,
      ensurePanel,
      getPanel,
      open,
      close,
      minimize,
      focus,
      move,
      flash,
      reportRect,
      getOtherRects,
      pillBarNode,
      setPillBarNode,
    }),
    [
      state,
      ensurePanel,
      getPanel,
      open,
      close,
      minimize,
      focus,
      move,
      flash,
      reportRect,
      getOtherRects,
      pillBarNode,
    ],
  );

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

function useDockContext(): DockContextValue {
  const ctx = useContext(DockContext);
  if (!ctx) {
    throw new Error(
      "useDock/useDockContext must be used within a DockProvider",
    );
  }
  return ctx;
}

export { useDockContext };

/** `useDock(id)` — the panel-scoped control surface later tasks consume to
 * show/hide/minimize a specific dock panel from anywhere in the tree. */
export function useDock(id: string): {
  open: () => void;
  close: () => void;
  minimize: () => void;
  flash: () => void;
  isOpen: boolean;
  isMinimized: boolean;
} {
  const ctx = useDockContext();
  const panel = ctx.state[id];
  return {
    open: () => ctx.open(id),
    close: () => ctx.close(id),
    minimize: () => ctx.minimize(id),
    flash: () => ctx.flash(id),
    isOpen: panel?.open ?? false,
    isMinimized: panel?.minimized ?? false,
  };
}
