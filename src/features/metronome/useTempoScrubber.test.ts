import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTempoScrubber, PX_PER_BPM } from "./useTempoScrubber";
import { DEFAULT_METRO_STATE, type UseMetronome } from "./useMetronome";

// Mirrors the module-private WHEEL_PX_PER_BPM in useTempoScrubber.ts (not
// exported). If that constant changes, these wheel tests need updating too.
const WHEEL_PX_PER_BPM = 24;

// ---------------------------------------------------------------------------
// Test doubles. useTempoScrubber only reads `bpm` (the plain number arg) and
// calls three UseMetronome methods (setBpmDrag / commitBpmDrag / nudgeBpm) —
// everything else on the interface is present only to satisfy the type.
// ---------------------------------------------------------------------------
function makeMetronome(bpm = DEFAULT_METRO_STATE.bpm) {
  const setBpmDrag = vi.fn();
  const commitBpmDrag = vi.fn();
  const nudgeBpm = vi.fn();
  const m: UseMetronome = {
    state: { ...DEFAULT_METRO_STATE, bpm },
    error: null,
    clearError: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
    setBpm: vi.fn(),
    setBpmDrag,
    commitBpmDrag,
    nudgeBpm,
    setBeatsPerBar: vi.fn(),
    setSubdivision: vi.fn(),
    setAccent: vi.fn(),
    setGain: vi.fn(),
    setBoost: vi.fn(),
    selectSound: vi.fn(),
  };
  return { m, setBpmDrag, commitBpmDrag, nudgeBpm };
}

interface PointerOpts {
  hasCapture?: boolean;
  setCaptureThrows?: boolean;
  hasCaptureThrows?: boolean;
}

function pointerEvent(clientX: number, pointerId = 1, opts: PointerOpts = {}) {
  const currentTarget = {
    setPointerCapture: vi.fn(() => {
      if (opts.setCaptureThrows) throw new Error("not implemented");
    }),
    hasPointerCapture: vi.fn(() => {
      if (opts.hasCaptureThrows) throw new Error("not implemented");
      return opts.hasCapture ?? true;
    }),
    releasePointerCapture: vi.fn(),
  };
  return {
    clientX,
    pointerId,
    currentTarget,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function wheelEvent(deltaY: number) {
  return { deltaY } as unknown as ReactWheelEvent<HTMLElement>;
}

function keyEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent<HTMLElement>;
}

describe("useTempoScrubber — onPointerDown", () => {
  it("captures the pointer and anchors the drag at the current bpm without emitting a bpm update", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));
    const down = pointerEvent(100);

    act(() => result.current.dragHandlers.onPointerDown(down));

    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1);
    expect(setBpmDrag).not.toHaveBeenCalled();
  });

  it("degrades silently when setPointerCapture is unimplemented (e.g. jsdom)", () => {
    const { m } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));
    const down = pointerEvent(0, 1, { setCaptureThrows: true });

    expect(() =>
      act(() => result.current.dragHandlers.onPointerDown(down)),
    ).not.toThrow();
  });

  it("re-anchors to the latest bpm after the hook re-renders with a new value", () => {
    const { m, setBpmDrag } = makeMetronome();
    const { result, rerender } = renderHook(
      ({ bpm }) => useTempoScrubber(m, bpm),
      {
        initialProps: { bpm: 120 },
      },
    );
    rerender({ bpm: 200 });

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM)),
    );

    expect(setBpmDrag).toHaveBeenCalledWith(201);
  });
});

describe("useTempoScrubber — onPointerMove", () => {
  it("is a no-op before any pointerDown has started a drag", () => {
    const { m, setBpmDrag } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerMove(pointerEvent(50)));

    expect(setBpmDrag).not.toHaveBeenCalled();
  });

  it("is a no-op for a move after the drag has already ended", () => {
    const { m, setBpmDrag } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() => result.current.dragHandlers.onPointerUp(pointerEvent(0)));
    setBpmDrag.mockClear();
    act(() => result.current.dragHandlers.onPointerMove(pointerEvent(500)));

    expect(setBpmDrag).not.toHaveBeenCalled();
  });

  it("converts horizontal drag distance to whole bpm at PX_PER_BPM px/bpm", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM * 10)),
    );

    expect(setBpmDrag).toHaveBeenLastCalledWith(130);
  });

  it("does not re-invoke setBpmDrag for sub-bpm movement (rounds to the same integer)", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    // 1px < half of PX_PER_BPM (1.6px) — rounds back to a 0 bpm delta.
    act(() => result.current.dragHandlers.onPointerMove(pointerEvent(1)));

    expect(setBpmDrag).not.toHaveBeenCalled();
  });

  it("tracks rapid direction reversal, re-firing on every new integer crossing", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM * 5)),
    ); // +5
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(-PX_PER_BPM * 5)),
    ); // -5
    act(() => result.current.dragHandlers.onPointerMove(pointerEvent(0))); // back to start

    expect(setBpmDrag.mock.calls.map((c) => c[0])).toEqual([125, 115, 120]);
  });

  it("passes raw, unclamped values through even past the UI bpm range (clamping is the consumer's job)", () => {
    const { m, setBpmDrag } = makeMetronome(20); // UI_BPM_MIN
    const { result } = renderHook(() => useTempoScrubber(m, 20));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(-PX_PER_BPM * 50)),
    );

    expect(setBpmDrag).toHaveBeenLastCalledWith(-30);
  });

  it("does not check that a move's pointerId matches the pointer that started the drag", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0, 1)));
    // A different pointerId (e.g. a second touch point) still perturbs the
    // single in-flight drag — there is no per-pointer isolation.
    act(() =>
      result.current.dragHandlers.onPointerMove(
        pointerEvent(PX_PER_BPM * 3, 999),
      ),
    );

    expect(setBpmDrag).toHaveBeenCalledWith(123);
  });
});

describe("useTempoScrubber — onPointerUp / onPointerCancel", () => {
  it("commits the last dragged bpm and releases pointer capture", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM * 7)),
    );
    const up = pointerEvent(PX_PER_BPM * 7, 1, { hasCapture: true });
    act(() => result.current.dragHandlers.onPointerUp(up));

    expect(commitBpmDrag).toHaveBeenCalledWith(127);
    expect(up.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("commits the unchanged start bpm on a plain click with no intervening move", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() => result.current.dragHandlers.onPointerUp(pointerEvent(0)));

    expect(commitBpmDrag).toHaveBeenCalledWith(120);
  });

  it("skips releasePointerCapture when hasPointerCapture reports false", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    const up = pointerEvent(0, 1, { hasCapture: false });
    act(() => result.current.dragHandlers.onPointerUp(up));

    expect(up.currentTarget.releasePointerCapture).not.toHaveBeenCalled();
    expect(commitBpmDrag).toHaveBeenCalled();
  });

  it("degrades silently when hasPointerCapture/releasePointerCapture are unimplemented", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    const up = pointerEvent(0, 1, { hasCaptureThrows: true });

    expect(() =>
      act(() => result.current.dragHandlers.onPointerUp(up)),
    ).not.toThrow();
    expect(commitBpmDrag).toHaveBeenCalled();
  });

  it("is a no-op when there is no active drag (e.g. a stray second pointerUp)", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() => result.current.dragHandlers.onPointerUp(pointerEvent(0)));
    commitBpmDrag.mockClear();
    act(() => result.current.dragHandlers.onPointerUp(pointerEvent(0)));

    expect(commitBpmDrag).not.toHaveBeenCalled();
  });

  it("onPointerCancel commits mid-drag exactly like onPointerUp (cancel does not discard the drag)", () => {
    const { m, commitBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM * 4)),
    );
    act(() =>
      result.current.dragHandlers.onPointerCancel(pointerEvent(PX_PER_BPM * 4)),
    );

    expect(commitBpmDrag).toHaveBeenCalledWith(124);
  });

  it("clears drag state so a move after cancel is a no-op", () => {
    const { m, setBpmDrag } = makeMetronome(120);
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() => result.current.dragHandlers.onPointerCancel(pointerEvent(0)));
    setBpmDrag.mockClear();
    act(() => result.current.dragHandlers.onPointerMove(pointerEvent(500)));

    expect(setBpmDrag).not.toHaveBeenCalled();
  });
});

describe("useTempoScrubber — onWheel", () => {
  it("does nothing until accumulated deltaY crosses the per-bpm wheel threshold", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(-5)));

    expect(nudgeBpm).not.toHaveBeenCalled();
  });

  it("scrolling up (negative deltaY) speeds up the tempo by whole steps", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(-WHEEL_PX_PER_BPM)));

    expect(nudgeBpm).toHaveBeenCalledWith(1);
  });

  it("scrolling down (positive deltaY) slows down the tempo by whole steps", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(WHEEL_PX_PER_BPM)));

    expect(nudgeBpm).toHaveBeenCalledWith(-1);
  });

  it("collapses a single fast wheel tick spanning multiple bpm into one nudgeBpm call", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(-WHEEL_PX_PER_BPM * 3)));

    expect(nudgeBpm).toHaveBeenCalledTimes(1);
    expect(nudgeBpm).toHaveBeenCalledWith(3);
  });

  it("accumulates sub-threshold deltas across events (trackpad momentum stream)", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(-20)));
    expect(nudgeBpm).not.toHaveBeenCalled();

    act(() => result.current.onWheel(wheelEvent(-10))); // total -30: one step, -6 carried over
    expect(nudgeBpm).toHaveBeenCalledTimes(1);
    expect(nudgeBpm).toHaveBeenCalledWith(1);
  });

  it("rapid direction reversal on the wheel can net to zero without ever nudging", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onWheel(wheelEvent(-20)));
    act(() => result.current.onWheel(wheelEvent(20)));

    expect(nudgeBpm).not.toHaveBeenCalled();
  });
});

describe("useTempoScrubber — onKeyDown", () => {
  it.each([
    ["ArrowLeft", -1],
    ["ArrowDown", -1],
    ["ArrowRight", 1],
    ["ArrowUp", 1],
  ] as const)("%s calls preventDefault and nudges by %d", (key, delta) => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));
    const e = keyEvent(key);

    act(() => result.current.onKeyDown(e));

    expect(e.preventDefault).toHaveBeenCalled();
    expect(nudgeBpm).toHaveBeenCalledWith(delta);
  });

  it("ignores unrelated keys without calling preventDefault or nudging", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));
    const e = keyEvent("Enter");

    act(() => result.current.onKeyDown(e));

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(nudgeBpm).not.toHaveBeenCalled();
  });

  it("fires one nudgeBpm call per keypress, independent of the wheel accumulator", () => {
    const { m, nudgeBpm } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, 120));

    act(() => result.current.onKeyDown(keyEvent("ArrowUp")));
    act(() => result.current.onKeyDown(keyEvent("ArrowUp")));
    act(() => result.current.onKeyDown(keyEvent("ArrowUp")));

    expect(nudgeBpm).toHaveBeenCalledTimes(3);
  });
});

describe("useTempoScrubber — invalid bpm input (no internal guard)", () => {
  it("propagates NaN through the drag arithmetic when the bpm prop is not finite", () => {
    const { m, setBpmDrag } = makeMetronome();
    const { result } = renderHook(() => useTempoScrubber(m, NaN));

    act(() => result.current.dragHandlers.onPointerDown(pointerEvent(0)));
    act(() =>
      result.current.dragHandlers.onPointerMove(pointerEvent(PX_PER_BPM * 5)),
    );

    // NaN + anything is NaN — this hook has no Number.isFinite guard of its
    // own; UseMetronome.setBpmDrag (clampBpm) is what saves it in production.
    expect(setBpmDrag).toHaveBeenCalledWith(NaN);
  });
});
