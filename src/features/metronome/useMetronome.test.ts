import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface: `invoke` (commands) and `listen` (the
// `metro://state` event bus). The listen mock captures the handler so a test
// can push authoritative state events, exactly as the Rust backend would.
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

import {
  useMetronome,
  DEFAULT_METRO_STATE,
  clampBpm,
  parseBpmInput,
  tempoName,
  UI_BPM_MIN,
  UI_BPM_MAX,
  type MetroState,
} from "./useMetronome";

function emitState(state: MetroState) {
  act(() => {
    listeners["metro://state"]?.({ payload: state });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(DEFAULT_METRO_STATE);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMetronome — IPC wiring", () => {
  it("fetches the initial state once on mount and subscribes to metro://state", async () => {
    invokeMock.mockResolvedValueOnce({ ...DEFAULT_METRO_STATE, bpm: 96 });

    const { result } = renderHook(() => useMetronome());

    await waitFor(() => expect(result.current.state.bpm).toBe(96));
    expect(invokeMock).toHaveBeenCalledWith("metro_state");
    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith(
        "metro://state",
        expect.any(Function),
      ),
    );
  });

  it("start() invokes metro_start with the clamped bpm and optimistically runs", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => result.current.start(140));

    expect(invokeMock).toHaveBeenCalledWith("metro_start", { bpm: 140 });
    expect(result.current.state.running).toBe(true);
  });

  it("stop() invokes metro_stop and optimistically stops", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    emitState({ ...DEFAULT_METRO_STATE, running: true });

    act(() => result.current.stop());

    expect(invokeMock).toHaveBeenCalledWith("metro_stop", undefined);
    expect(result.current.state.running).toBe(false);
  });

  it("updates hook state when a metro://state event arrives (single source of truth)", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emitState({
      ...DEFAULT_METRO_STATE,
      running: true,
      bpm: 200,
      sound: "cowbell",
      beats_per_bar: 3,
      subdivision: 4,
      accent_first: false,
      gain: 2,
      boost: true,
    });

    expect(result.current.state.running).toBe(true);
    expect(result.current.state.bpm).toBe(200);
    expect(result.current.state.sound).toBe("cowbell");
    expect(result.current.state.beats_per_bar).toBe(3);
    expect(result.current.state.subdivision).toBe(4);
    expect(result.current.state.accent_first).toBe(false);
    expect(result.current.state.gain).toBe(2);
    expect(result.current.state.boost).toBe(true);
  });

  it("surfaces a command rejection as an inline error", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    invokeMock.mockRejectedValueOnce("unknown metronome sound 'foo'");

    await act(async () => {
      await result.current.selectSound("foo");
    });

    await waitFor(() =>
      expect(result.current.error).toContain("unknown metronome sound"),
    );
  });

  it("sends beatsPerBar in camelCase (Tauri maps it to beats_per_bar)", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => result.current.setBeatsPerBar(3));

    expect(invokeMock).toHaveBeenCalledWith("metro_set", { beatsPerBar: 3 });
  });

  it("caps subdivision at 16", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => result.current.setSubdivision(99));

    expect(invokeMock).toHaveBeenCalledWith("metro_set", { subdivision: 16 });
  });

  it("nudges bpm relative to the current state", async () => {
    invokeMock.mockResolvedValueOnce({ ...DEFAULT_METRO_STATE, bpm: 120 });
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(result.current.state.bpm).toBe(120));

    act(() => result.current.nudgeBpm(1));

    expect(invokeMock).toHaveBeenCalledWith("metro_set", { bpm: 121 });
  });

  it("stops a running preview when unmounted before the audition ends", async () => {
    // Stopped metronome: selecting a sound starts a real engine for a short
    // one-shot. If the popover closes (unmount) before the auto-stop timer
    // fires, the hook must stop the engine itself — otherwise it plays forever.
    const { result, unmount } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.selectSound("cowbell");
    });
    // The preview started the engine (metro_start was invoked).
    expect(invokeMock).toHaveBeenCalledWith("metro_start", undefined);

    invokeMock.mockClear();
    unmount();

    expect(invokeMock).toHaveBeenCalledWith("metro_stop");
  });

  it("does NOT stop a genuinely-running metronome on unmount", async () => {
    const { result, unmount } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    act(() => result.current.start(120)); // user-started, not a preview

    invokeMock.mockClear();
    unmount();

    expect(invokeMock).not.toHaveBeenCalledWith("metro_stop");
    expect(invokeMock).not.toHaveBeenCalledWith("metro_stop", undefined);
  });

  it("unsubscribes from the event on unmount", async () => {
    const { unmount } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    unmount();

    expect(unlistenMock).toHaveBeenCalled();
  });
});

describe("useMetronome — pure helpers", () => {
  it("clamps bpm to the UI range and rounds", () => {
    expect(clampBpm(5)).toBe(UI_BPM_MIN);
    expect(clampBpm(9999)).toBe(UI_BPM_MAX);
    expect(clampBpm(120.6)).toBe(121);
    expect(clampBpm(Number.NaN)).toBe(UI_BPM_MIN);
  });

  it("parses typed bpm input, rejecting empty and non-numeric strings", () => {
    expect(parseBpmInput("")).toBeNull();
    expect(parseBpmInput("   ")).toBeNull();
    expect(parseBpmInput("abc")).toBeNull();
    expect(parseBpmInput("140")).toBe(140);
    expect(parseBpmInput("9999")).toBe(UI_BPM_MAX);
    expect(parseBpmInput("5")).toBe(UI_BPM_MIN);
  });

  it("maps bpm to the standard Italian tempo names", () => {
    expect(tempoName(30)).toBe("Grave");
    expect(tempoName(50)).toBe("Largo");
    expect(tempoName(70)).toBe("Adagio");
    expect(tempoName(90)).toBe("Andante");
    expect(tempoName(110)).toBe("Moderato");
    expect(tempoName(130)).toBe("Allegro");
    expect(tempoName(160)).toBe("Vivace");
    expect(tempoName(180)).toBe("Presto");
    expect(tempoName(210)).toBe("Prestissimo");
  });
});
