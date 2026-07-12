import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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

import { useMetronome, DEFAULT_METRO_STATE, type MetroState } from "./useMetronome";

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

describe("SCRATCH useMetronome — toggle()", () => {
  it("toggle() starts when stopped and stops when running", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => result.current.toggle());
    expect(invokeMock).toHaveBeenCalledWith("metro_start", undefined);
    expect(result.current.state.running).toBe(true);

    invokeMock.mockClear();

    act(() => result.current.toggle());
    expect(invokeMock).toHaveBeenCalledWith("metro_stop", undefined);
    expect(result.current.state.running).toBe(false);
  });
});

describe("SCRATCH useMetronome — bpm drag throttling", () => {
  it("throttles rapid setBpmDrag calls to one invoke per 150ms (trailing)", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    vi.useFakeTimers();

    act(() => result.current.setBpmDrag(100));
    invokeMock.mockClear();

    act(() => {
      result.current.setBpmDrag(101);
      result.current.setBpmDrag(102);
      result.current.setBpmDrag(103);
    });
    expect(result.current.state.bpm).toBe(103);
    expect(invokeMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(150));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("metro_set", { bpm: 103 });

    vi.useRealTimers();
  });

  it("commitBpmDrag flushes a pending throttled call and sends the final value unconditionally", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    vi.useFakeTimers();

    act(() => result.current.setBpmDrag(100));
    invokeMock.mockClear();
    act(() => result.current.setBpmDrag(101));

    act(() => result.current.commitBpmDrag(105));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("metro_set", { bpm: 105 });

    act(() => vi.advanceTimersByTime(200));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

describe("SCRATCH useMetronome — selectSound while live-running", () => {
  it("applies the sound live without starting an extra preview one-shot", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => result.current.start(120));
    invokeMock.mockClear();

    await act(async () => {
      await result.current.selectSound("clave");
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("metro_set", { sound: "clave" });
    expect(result.current.state.sound).toBe("clave");
  });
});

describe("SCRATCH useMetronome — mount-time IPC failures", () => {
  it("falls back to defaults when metro_state rejects (backend absent)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no such command"));

    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("metro_state"));

    expect(result.current.state).toEqual(DEFAULT_METRO_STATE);
    expect(result.current.error).toBeNull();
  });

  it("keeps optimistic-only operation when listen() setup fails (no event bus)", async () => {
    listenMock.mockImplementationOnce(async () => {
      throw new Error("event bus unavailable");
    });

    const { result } = renderHook(() => useMetronome());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("metro_state"));
    expect(result.current.error).toBeNull();

    act(() => result.current.start(150));
    expect(result.current.state.bpm).toBe(150);
    expect(result.current.state.running).toBe(true);
  });
});

describe("SCRATCH useMetronome — optimistic state on command rejection", () => {
  it("does NOT roll back the optimistic running state when metro_start rejects", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    invokeMock.mockRejectedValueOnce("audio busy: speech playing");

    act(() => result.current.start(120));

    await waitFor(() => expect(result.current.error).toContain("audio busy"));
    expect(result.current.state.running).toBe(true);
  });
});

describe("SCRATCH useMetronome — error lifecycle", () => {
  it("auto-clears an error after ~4.5s, and clearError() clears it immediately", async () => {
    const { result } = renderHook(() => useMetronome());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    vi.useFakeTimers();

    invokeMock.mockRejectedValueOnce("boom");
    await act(async () => {
      await result.current.selectSound("foo");
    });
    expect(result.current.error).toBe("boom");

    act(() => vi.advanceTimersByTime(4500));
    expect(result.current.error).toBeNull();

    invokeMock.mockRejectedValueOnce("boom again");
    await act(async () => {
      await result.current.selectSound("foo");
    });
    expect(result.current.error).toBe("boom again");

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();

    vi.useRealTimers();
  });
});
