import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import "./FloatingPanel.css";

export interface PanelGeometry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  z: number;
}

interface Viewport {
  w: number;
  h: number;
}

interface FloatingPanelProps {
  geometry: PanelGeometry;
  title: string;
  onGeometryChange: (geometry: PanelGeometry) => void;
  onFocus: (id: string) => void;
  viewport: Viewport;
  children: ReactNode;
  className?: string;
  testId?: string;
}

type Interaction = {
  mode: "drag" | "resize";
  startX: number;
  startY: number;
  origin: PanelGeometry;
};

const MIN_WIDTH = 260;
const MIN_HEIGHT = 120;

export function clampToViewport(
  geometry: PanelGeometry,
  viewport: Viewport,
): PanelGeometry {
  const viewportWidth = Math.max(1, viewport.w);
  const viewportHeight = Math.max(1, viewport.h);
  const w = Math.min(Math.max(MIN_WIDTH, geometry.w), viewportWidth);
  const h = Math.min(Math.max(MIN_HEIGHT, geometry.h), viewportHeight);
  const x = Math.max(0, Math.min(geometry.x, viewportWidth - w));
  const y = Math.max(0, Math.min(geometry.y, viewportHeight - h));
  return { ...geometry, x, y, w, h };
}

export function snapToEdges(
  geometry: PanelGeometry,
  viewport: Viewport,
  threshold = 12,
): PanelGeometry {
  let { x, y } = geometry;
  if (x <= threshold) x = 0;
  else if (viewport.w - (x + geometry.w) <= threshold) {
    x = viewport.w - geometry.w;
  }
  if (y <= threshold) y = 0;
  else if (viewport.h - (y + geometry.h) <= threshold) {
    y = viewport.h - geometry.h;
  }
  return clampToViewport({ ...geometry, x, y }, viewport);
}

export function FloatingPanel({
  geometry,
  title,
  onGeometryChange,
  onFocus,
  viewport,
  children,
  className = "",
  testId,
}: FloatingPanelProps) {
  const [current, setCurrent] = useState(() =>
    clampToViewport(geometry, viewport),
  );
  const interaction = useRef<Interaction | null>(null);

  useEffect(() => {
    if (interaction.current) return;
    setCurrent(clampToViewport(geometry, viewport));
  }, [geometry, viewport.w, viewport.h]);

  useEffect(() => {
    function move(event: PointerEvent) {
      const active = interaction.current;
      if (!active) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      const next =
        active.mode === "drag"
          ? { ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy }
          : {
              ...active.origin,
              w: Math.max(MIN_WIDTH, active.origin.w + dx),
              h: Math.max(MIN_HEIGHT, active.origin.h + dy),
            };
      setCurrent(clampToViewport(next, viewport));
    }

    function finish() {
      if (!interaction.current) return;
      interaction.current = null;
      setCurrent((value) => {
        const committed = snapToEdges(value, viewport);
        onGeometryChange(committed);
        return committed;
      });
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [onGeometryChange, viewport]);

  function begin(
    event: ReactPointerEvent,
    mode: Interaction["mode"],
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    onFocus(current.id);
    interaction.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: current,
    };
  }

  function toggleCollapsed() {
    const next = { ...current, collapsed: !current.collapsed };
    setCurrent(next);
    onGeometryChange(next);
  }

  return (
    <section
      className={`floating-panel ${current.collapsed ? "is-collapsed" : ""} ${className}`.trim()}
      data-testid={testId}
      style={{
        left: current.x,
        top: current.y,
        width: current.w,
        height: current.collapsed ? undefined : current.h,
        zIndex: current.z,
      }}
      onPointerDown={() => onFocus(current.id)}
    >
      <header
        className="floating-panel-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          begin(event, "drag");
        }}
      >
        <span className="floating-panel-grip" aria-hidden="true" />
        <span className="floating-panel-title">{title}</span>
        <button
          type="button"
          className="floating-panel-collapse"
          aria-label={current.collapsed ? "Expand panel" : "Collapse panel"}
          onClick={toggleCollapsed}
        >
          {current.collapsed ? "+" : "−"}
        </button>
      </header>
      {!current.collapsed && (
        <div className="floating-panel-body">{children}</div>
      )}
      {!current.collapsed && (
        <button
          type="button"
          className="floating-panel-resize"
          aria-label="Resize panel"
          onPointerDown={(event) => begin(event, "resize")}
        />
      )}
    </section>
  );
}
