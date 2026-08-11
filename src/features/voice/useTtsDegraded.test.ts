import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Same IPC mocking shape as useVoice.test.ts: capture each listener by event
// name so a test can push the backend's transitions verbatim.
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

import { useTtsDegraded } from "./useTtsDegraded";

function emit(payload: unknown) {
  act(() => {
    listeners["voice://tts"]?.({ payload });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(false);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

describe("useTtsDegraded", () => {
  it("subscribes to voice://tts and takes the one-shot snapshot", async () => {
    const { result } = renderHook(() => useTtsDegraded());

    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith(
        "voice://tts",
        expect.any(Function),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("tts_degraded"),
    );
    expect(result.current).toBe(false);
  });

  it("reports degraded on the transition and clears on recovery", async () => {
    const { result } = renderHook(() => useTtsDegraded());
    await waitFor(() => expect(listeners["voice://tts"]).toBeDefined());

    emit({ degraded: true });
    expect(result.current).toBe(true);

    emit({ degraded: false });
    expect(result.current).toBe(false);
  });

  it("starts degraded when the snapshot says so (UI mounted mid-cooldown)", async () => {
    invokeMock.mockResolvedValue(true);
    const { result } = renderHook(() => useTtsDegraded());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("lets a live event win over the in-flight snapshot", async () => {
    let resolveSnapshot: (value: boolean) => void = () => undefined;
    invokeMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const { result } = renderHook(() => useTtsDegraded());
    await waitFor(() => expect(listeners["voice://tts"]).toBeDefined());

    emit({ degraded: true });
    await act(async () => {
      resolveSnapshot(false); // stale snapshot must NOT clobber the event
    });
    expect(result.current).toBe(true);
  });

  it("stays quiet with no backend (rejecting IPC)", async () => {
    listenMock.mockRejectedValueOnce(new Error("no event bus"));
    invokeMock.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useTtsDegraded());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("tts_degraded"),
    );
    expect(result.current).toBe(false);
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useTtsDegraded());
    await waitFor(() => expect(listeners["voice://tts"]).toBeDefined());
    unmount();
    await waitFor(() => expect(unlistenMock).toHaveBeenCalled());
  });
});
