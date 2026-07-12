import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PanelGeometry } from "./FloatingPanel";

interface PanelLayout {
  panels: PanelGeometry[];
}

type PanelDefaults = Omit<PanelGeometry, "id">;

export interface UsePanels {
  panels: Record<string, PanelGeometry>;
  register: (id: string, defaults: PanelDefaults) => void;
  update: (geometry: PanelGeometry) => void;
  raise: (id: string) => void;
  resetLayout: () => void;
  viewport: { w: number; h: number };
}

function viewportSize() {
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
  };
}

function byId(layout: PanelLayout | null | undefined) {
  return Object.fromEntries((layout?.panels ?? []).map((panel) => [panel.id, panel]));
}

export function usePanels(): UsePanels {
  const [panels, setPanels] = useState<Record<string, PanelGeometry>>({});
  const [viewport, setViewport] = useState(viewportSize);
  const defaults = useRef<Record<string, PanelDefaults>>({});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const persist = useCallback((next: Record<string, PanelGeometry>) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void invoke("layout_set", { layout: { panels: Object.values(next) } }).catch(
        () => undefined,
      );
    }, 250);
  }, []);

  useEffect(() => {
    alive.current = true;
    void invoke<PanelLayout | null>("layout_get")
      .then((layout) => {
        if (!alive.current) return;
        setPanels((current) => ({ ...current, ...byId(layout) }));
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  useEffect(() => {
    const resize = () => setViewport(viewportSize());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const register = useCallback((id: string, panelDefaults: PanelDefaults) => {
    defaults.current[id] = panelDefaults;
    setPanels((current) =>
      current[id]
        ? current
        : { ...current, [id]: { id, ...panelDefaults } },
    );
  }, []);

  const update = useCallback(
    (geometry: PanelGeometry) => {
      setPanels((current) => {
        // A drag starts by raising the panel, but FloatingPanel's transient
        // geometry still carries the pre-raise z. Never let the final drag/
        // resize commit accidentally send the panel behind its siblings again.
        const nextGeometry = {
          ...geometry,
          z: Math.max(geometry.z, current[geometry.id]?.z ?? geometry.z),
        };
        const next = { ...current, [geometry.id]: nextGeometry };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const raise = useCallback(
    (id: string) => {
      setPanels((current) => {
        const panel = current[id];
        if (!panel) return current;
        const top = Math.max(0, ...Object.values(current).map((item) => item.z));
        if (panel.z === top) return current;
        const next = { ...current, [id]: { ...panel, z: top + 1 } };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const resetLayout = useCallback(() => {
    const next = Object.fromEntries(
      Object.entries(defaults.current).map(([id, panelDefaults]) => [
        id,
        { id, ...panelDefaults },
      ]),
    );
    setPanels(next);
    persist(next);
  }, [persist]);

  return { panels, register, update, raise, resetLayout, viewport };
}
