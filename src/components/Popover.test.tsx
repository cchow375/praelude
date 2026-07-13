import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";

import { Popover } from "./Popover";

// ---------------------------------------------------------------------------
// Popover computes its position from getBoundingClientRect(), which jsdom
// always reports as all-zero. Stub it per-element (panel vs. anchor) so the
// alignment/clamping math is exercised deterministically, mirroring how
// MetronomePopover.test.tsx stubs the Tauri IPC boundary for its own concern.
// ---------------------------------------------------------------------------
let anchorRect: DOMRect;
let panelRect: DOMRect;

function rect(partial: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON() {
      return this;
    },
    ...partial,
  } as DOMRect;
}

beforeEach(() => {
  anchorRect = rect({ left: 300, right: 340, width: 40, top: 100, bottom: 132 });
  panelRect = rect({ width: 200, height: 80 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("popover-panel") ? panelRect : anchorRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({
  align,
  onClose = () => {},
  size = "default",
}: {
  align?: "start" | "center" | "end";
  onClose?: () => void;
  size?: "default" | "wide";
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>anchor</button>
      <button data-testid="outside">outside</button>
      <Popover anchorRef={anchorRef} open onClose={onClose} align={align} label="Test" size={size}>
        <button data-testid="inside">inside</button>
      </Popover>
    </>
  );
}

describe("Popover — alignment", () => {
  it("aligns 'end' to the anchor's right edge minus the panel width", () => {
    render(<Harness align="end" />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    expect(panel.style.left).toBe("140px"); // 340 - 200
  });

  it("aligns 'start' to the anchor's left edge", () => {
    render(<Harness align="start" />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    expect(panel.style.left).toBe("300px");
  });

  it("aligns 'center' to the anchor's horizontal midpoint", () => {
    render(<Harness align="center" />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    // 300 + 40/2 - 200/2 = 220
    expect(panel.style.left).toBe("220px");
  });
});

describe("Popover — viewport clamping", () => {
  it("clamps the left position to an 8px margin near the right edge", () => {
    anchorRect = rect({ left: 990, right: 1030, width: 40, top: 100, bottom: 132 });
    render(<Harness align="start" />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    // window.innerWidth (1024 in jsdom) - panel width (200) - margin (8) = 816
    expect(panel.style.left).toBe("816px");
  });

  it("marks a wide surface so its measured CSS width controls clamping", () => {
    render(<Harness size="wide" />);
    expect(screen.getByRole("dialog", { name: "Test" }).getAttribute("data-size")).toBe("wide");
  });
});

describe("Popover — reposition on resize/scroll", () => {
  it("recomputes position on window resize while open", () => {
    render(<Harness align="start" />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    expect(panel.style.left).toBe("300px");

    anchorRect = rect({ left: 50, right: 90, width: 40, top: 100, bottom: 132 });
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(panel.style.left).toBe("50px");
  });

  it("recomputes position on window scroll while open", () => {
    render(<Harness align="start" />);
    anchorRect = rect({ left: 12, right: 52, width: 40, top: 100, bottom: 132 });
    act(() => {
      fireEvent(window, new Event("scroll"));
    });
    const panel = screen.getByRole("dialog", { name: "Test" });
    expect(panel.style.left).toBe("12px");
  });
});

describe("Popover — outside pointerdown dismissal", () => {
  it("closes on an outside pointerdown", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a pointerdown inside the panel", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a pointerdown on the anchor", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.pointerDown(screen.getByText("anchor"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Popover — focus management", () => {
  function ToggleHarness() {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <>
        <button ref={anchorRef} onClick={() => setOpen(false)}>
          anchor
        </button>
        <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Test">{null}</Popover>
      </>
    );
  }

  it("moves focus into the panel on open and restores it to the anchor on close", async () => {
    render(<ToggleHarness />);
    const panel = screen.getByRole("dialog", { name: "Test" });

    // Focus is moved via requestAnimationFrame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(document.activeElement).toBe(panel);

    const anchor = screen.getByText("anchor");
    act(() => {
      fireEvent.click(anchor);
    });
    expect(document.activeElement).toBe(anchor);
  });
});

describe("Popover — exit animation gating", () => {
  it("does not unmount on a stray transitionend while open is still true", () => {
    render(<Harness />);
    const panel = screen.getByRole("dialog", { name: "Test" });
    act(() => {
      fireEvent.transitionEnd(panel);
    });
    expect(screen.getByRole("dialog", { name: "Test" })).toBeTruthy();
  });

  function ToggleHarness() {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <>
        <button ref={anchorRef}>anchor</button>
        <button data-testid="close" onClick={() => setOpen(false)}>
          close
        </button>
        <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Test">{null}</Popover>
      </>
    );
  }

  it("unmounts only once the exit transitionend fires after open goes false", () => {
    render(<ToggleHarness />);
    expect(screen.getByRole("dialog", { name: "Test" })).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId("close"));
    });
    // Still mounted immediately after `open` flips false — exit animation pending.
    const panel = screen.getByRole("dialog", { name: "Test" });
    expect(panel).toBeTruthy();

    act(() => {
      fireEvent.transitionEnd(panel);
    });
    expect(screen.queryByRole("dialog", { name: "Test" })).toBeNull();
  });
});
