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
  saveDockState,
  withPanel,
  type DockPanelState,
  type DockState,
} from "./dockState";

interface DockContextValue {
  state: DockState;
  /** Registers panel `id` with its default position the first time it
   * mounts. A no-op if the panel already exists (e.g. restored from
   * localStorage, or already registered by an earlier mount). */
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
}

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
      setState((prev) =>
        prev[id] ? prev : withPanel(prev, id, {}, { ...defaultPosition, z: 0 }),
      );
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
    }),
    [state, ensurePanel, getPanel, open, close, minimize, focus, move],
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
  isOpen: boolean;
  isMinimized: boolean;
} {
  const ctx = useDockContext();
  const panel = ctx.state[id];
  return {
    open: () => ctx.open(id),
    close: () => ctx.close(id),
    minimize: () => ctx.minimize(id),
    isOpen: panel?.open ?? false,
    isMinimized: panel?.minimized ?? false,
  };
}
