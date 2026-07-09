import { useRef } from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface exactly as useMetronome.test.ts does, so the
// popover can render against a fake backend without a real Tauri runtime.
// ---------------------------------------------------------------------------
const invokeMock = vi.fn();

type Handler = (e: { payload: unknown }) => void;
let listeners: Record<string, Handler>;
const unlistenMock = vi.fn();
const listenMock = vi.fn(async (event: string, cb: Handler) => {
  listeners[event] = cb;
  return unlistenMock;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, Handler])),
}));

import { MetronomePopover } from "./MetronomePopover";
import { DEFAULT_METRO_STATE } from "./useMetronome";

function Harness() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>anchor</button>
      <MetronomePopover anchorRef={anchorRef} open onClose={() => {}} />
    </>
  );
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(DEFAULT_METRO_STATE);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MetronomePopover — space-bar focus safety", () => {
  it("does not toggle the transport when a sound-tile button has native focus", async () => {
    render(<Harness />);

    const tile = await screen.findByRole("button", { name: "Woodblock" });
    tile.focus();
    expect(document.activeElement).toBe(tile);

    invokeMock.mockClear();

    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    act(() => {
      tile.dispatchEvent(event);
    });

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("metro_start", undefined);
    expect(invokeMock).not.toHaveBeenCalledWith("metro_stop", undefined);
  });

  it("still toggles the transport when Space is pressed with no interactive control focused", async () => {
    render(<Harness />);
    // Wait for initial mount fetch/listen to settle.
    await screen.findByRole("button", { name: "Woodblock" });
    invokeMock.mockClear();

    // Simulate focus resting on the popover panel itself (non-interactive
    // dialog root), the way Popover.tsx moves focus on open.
    const panel = screen.getByRole("dialog", { name: "Metronome" });
    panel.focus();

    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: panel });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(invokeMock).toHaveBeenCalledWith("metro_start", undefined);
  });
});

describe("MetronomePopover — drag-wheel throttle", () => {
  it("throttles metro_set invokes during a fast drag and guarantees one final commit on pointerup", async () => {
    render(<Harness />);
    const wheel = await screen.findByRole("slider", { name: "Tempo wheel" });

    // Enable fake timers only now — RTL's async queries above poll via
    // setTimeout and would otherwise hang under a fake clock.
    vi.useFakeTimers();

    invokeMock.mockClear();

    act(() => {
      fireEvent.pointerDown(wheel, { clientX: 0, pointerId: 1 });
    });

    // Cross ~10 integer bpm values in rapid succession (3.2px per bpm).
    for (let i = 1; i <= 10; i++) {
      act(() => {
        fireEvent.pointerMove(wheel, { clientX: i * 3.2, pointerId: 1 });
      });
    }

    const setCallsDuringDrag = invokeMock.mock.calls.filter(
      (c) => c[0] === "metro_set" && c[1] && "bpm" in (c[1] as Record<string, unknown>),
    );
    // Bounded — not one invoke per integer crossing (would be 10).
    expect(setCallsDuringDrag.length).toBeLessThan(10);
    expect(setCallsDuringDrag.length).toBeGreaterThan(0);

    invokeMock.mockClear();

    act(() => {
      fireEvent.pointerUp(wheel, { pointerId: 1 });
    });

    const finalCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "metro_set" && c[1] && "bpm" in (c[1] as Record<string, unknown>),
    );
    expect(finalCalls.length).toBe(1);
    expect(finalCalls[0][1]).toEqual({ bpm: DEFAULT_METRO_STATE.bpm + 10 });
  });
});
