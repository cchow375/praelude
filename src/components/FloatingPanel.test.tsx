import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { FloatingPanel, clampToViewport, snapToEdges } from "./FloatingPanel";

afterEach(cleanup);

describe("panel geometry", () => {
  const vp = { w: 1000, h: 800 };
  it("clamps a panel that would leave the viewport", () => {
    const g = { id: "a", x: 1200, y: -50, w: 300, h: 200, collapsed: false, z: 1 };
    const c = clampToViewport(g, vp);
    expect(c.x).toBe(700); // 1000 - 300
    expect(c.y).toBe(0);
  });
  it("snaps to the left/top edge within threshold", () => {
    const g = { id: "a", x: 8, y: 6, w: 300, h: 200, collapsed: false, z: 1 };
    const s = snapToEdges(g, vp, 12);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
  it("snaps to the right/bottom edge within threshold", () => {
    const g = { id: "a", x: 695, y: 595, w: 300, h: 200, collapsed: false, z: 1 };
    const s = snapToEdges(g, vp, 12);
    expect(s.x).toBe(700);
    expect(s.y).toBe(600);
  });
  it("drag by header commits a clamped geometry", () => {
    const onChange = vi.fn();
    render(
      <FloatingPanel
        geometry={{ id: "a", x: 100, y: 100, w: 300, h: 200, collapsed: false, z: 1 }}
        title="Rep"
        onGeometryChange={onChange}
        onFocus={vi.fn()}
        viewport={vp}
      >
        <div />
      </FloatingPanel>,
    );
    const header = screen.getByText("Rep");
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 5000 }); // way off-screen
    fireEvent.pointerUp(window);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.x).toBeLessThanOrEqual(vp.w - 300); // clamped
    expect(last.y).toBeLessThanOrEqual(vp.h - 200);
  });

  it("pointerdown on header raises focus", () => {
    const onFocus = vi.fn();
    render(
      <FloatingPanel
        geometry={{ id: "b", x: 0, y: 0, w: 300, h: 200, collapsed: false, z: 1 }}
        title="Metronome"
        onGeometryChange={vi.fn()}
        onFocus={onFocus}
        viewport={vp}
      >
        <div />
      </FloatingPanel>,
    );
    fireEvent.pointerDown(screen.getByText("Metronome"), { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onFocus).toHaveBeenCalledWith("b");
  });

  it("resizes from the corner without leaving the viewport", () => {
    const onChange = vi.fn();
    render(
      <FloatingPanel
        geometry={{ id: "r", x: 650, y: 550, w: 300, h: 200, collapsed: false, z: 1 }}
        title="History"
        onGeometryChange={onChange}
        onFocus={vi.fn()}
        viewport={vp}
      >
        <div />
      </FloatingPanel>,
    );
    fireEvent.pointerDown(screen.getByLabelText("Resize panel"), {
      clientX: 950,
      clientY: 750,
    });
    fireEvent.pointerMove(window, { clientX: 1400, clientY: 1200 });
    fireEvent.pointerUp(window);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.x + last.w).toBeLessThanOrEqual(vp.w);
    expect(last.y + last.h).toBeLessThanOrEqual(vp.h);
  });

  it("collapse toggle hides body and preserves height in geometry", () => {
    const onChange = vi.fn();
    render(
      <FloatingPanel
        geometry={{ id: "c", x: 0, y: 0, w: 300, h: 200, collapsed: false, z: 1 }}
        title="Goals"
        onGeometryChange={onChange}
        onFocus={vi.fn()}
        viewport={vp}
      >
        <div data-testid="body">content</div>
      </FloatingPanel>,
    );
    expect(screen.getByTestId("body")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse panel"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c", collapsed: true, h: 200 }),
    );
    expect(screen.queryByTestId("body")).toBeNull();
  });
});
