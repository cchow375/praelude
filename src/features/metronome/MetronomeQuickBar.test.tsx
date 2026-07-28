import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface exactly as useMetronome.test.ts / the popover test
// do, so the quick bar renders against a fake backend with no Tauri runtime.
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

import { MetronomeQuickBar } from "./MetronomeQuickBar";
import { DEFAULT_METRO_STATE } from "./useMetronome";

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(DEFAULT_METRO_STATE);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MetronomeQuickBar", () => {
  it("opens the full metronome popover from the instrument icon", async () => {
    render(<MetronomeQuickBar />);
    const icon = await screen.findByRole("button", { name: "Open metronome" });
    expect(screen.queryByRole("dialog", { name: "Metronome" })).toBeNull();

    fireEvent.click(icon);

    expect(
      await screen.findByRole("dialog", { name: "Metronome" }),
    ).toBeTruthy();
    expect(icon.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles the transport: first click starts, second click stops", async () => {
    render(<MetronomeQuickBar />);
    const play = await screen.findByRole("button", { name: "Start metronome" });
    invokeMock.mockClear();

    fireEvent.click(play);
    expect(invokeMock).toHaveBeenCalledWith("metro_start", undefined);

    // Optimistic patch flips the label; the next click stops.
    const stop = await screen.findByRole("button", { name: "Stop metronome" });
    fireEvent.click(stop);
    expect(invokeMock).toHaveBeenCalledWith("metro_stop", undefined);
  });

  it("tap-tempo sets the BPM from the average interval between taps", async () => {
    render(<MetronomeQuickBar />);
    const tap = await screen.findByRole("button", { name: "Tap tempo" });
    // The readout starts at the default tempo, not the tapped one.
    expect(screen.getByText(String(DEFAULT_METRO_STATE.bpm))).toBeTruthy();
    invokeMock.mockClear();

    // Deterministic tap clock: taps 400ms apart => 150 BPM. Fake timers move the
    // wall clock (Date) the tap handler reads, without touching React's own
    // scheduler clock (performance).
    vi.useFakeTimers();
    act(() => {
      fireEvent.click(tap); // one tap, no interval yet
    });
    for (let step = 0; step < 3; step += 1) {
      act(() => {
        vi.advanceTimersByTime(400);
        fireEvent.click(tap); // 400ms since the previous tap => 150 BPM
      });
    }

    expect(invokeMock).toHaveBeenCalledWith("metro_set", { bpm: 150 });
    expect(screen.getByText("150")).toBeTruthy();
  });

  it("scrubs tempo by dragging the live BPM readout, with one final commit", async () => {
    render(<MetronomeQuickBar />);
    const readout = await screen.findByRole("slider", {
      name: "Tempo, beats per minute",
    });
    invokeMock.mockClear();

    act(() => {
      fireEvent.pointerDown(readout, { clientX: 0, pointerId: 1 });
      // 3.2px per bpm — +16px => +5 bpm.
      fireEvent.pointerMove(readout, { clientX: 16, pointerId: 1 });
      fireEvent.pointerUp(readout, { pointerId: 1 });
    });

    const finalCalls = invokeMock.mock.calls.filter(
      (c) =>
        c[0] === "metro_set" &&
        c[1] &&
        "bpm" in (c[1] as Record<string, unknown>),
    );
    expect(finalCalls.at(-1)?.[1]).toEqual({
      bpm: DEFAULT_METRO_STATE.bpm + 5,
    });
    expect(screen.getByText(String(DEFAULT_METRO_STATE.bpm + 5))).toBeTruthy();
  });
});
