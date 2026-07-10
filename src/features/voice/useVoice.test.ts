import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface: `invoke` (commands) and `listen` (the three
// `voice://` events). The listen mock captures each handler by event name so a
// test can push authoritative events exactly as the Rust backend would.
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
  useVoice,
  deriveStatus,
  type VoiceStatusEvent,
  type VoiceIntent,
} from "./useVoice";

function emit(event: string, payload: unknown) {
  act(() => {
    listeners[event]?.({ payload });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ muted: false, down: null });
  listenMock.mockClear();
  unlistenMock.mockClear();
});

describe("useVoice — IPC wiring", () => {
  it("fetches the initial voice_state once and subscribes to the three events", async () => {
    const { result } = renderHook(() => useVoice());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("voice_state"));
    for (const ev of ["voice://status", "voice://transcript", "voice://intent"]) {
      await waitFor(() =>
        expect(listenMock).toHaveBeenCalledWith(ev, expect.any(Function)),
      );
    }
    expect(result.current.status).toBe("live");
  });

  it("reflects an initial muted snapshot from voice_state", async () => {
    invokeMock.mockResolvedValueOnce({ muted: true, down: null });
    const { result } = renderHook(() => useVoice());

    await waitFor(() => expect(result.current.status).toBe("muted"));
  });

  it("sets status 'down' with reason + guidance on a voice://status down event", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    const down: VoiceStatusEvent = {
      state: "down",
      reason: "dictation disabled",
      guidance: "Enable Dictation in System Settings > Keyboard.",
    };
    emit("voice://status", down);

    expect(result.current.status).toBe("down");
    expect(result.current.downReason).toBe("dictation disabled");
    expect(result.current.downGuidance).toContain("Enable Dictation");
  });

  it("updates the latest transcript on every voice://transcript event", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://transcript", { text: "set the tempo", is_final: false });
    expect(result.current.transcript).toBe("set the tempo");
    emit("voice://transcript", { text: "set the tempo to 96", is_final: true });
    expect(result.current.transcript).toBe("set the tempo to 96");
  });

  it("updates lastIntent on a voice://intent event", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    const intent: VoiceIntent = { kind: "set", text: "tempo 96", bpm: 96 };
    emit("voice://intent", intent);

    expect(result.current.lastIntent).toEqual(intent);
  });

  it("mute() invokes voice_mute and optimistically flips status", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(result.current.status).toBe("live");

    act(() => result.current.mute(true));

    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: true });
    expect(result.current.status).toBe("muted");

    act(() => result.current.mute(false));
    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: false });
    expect(result.current.status).toBe("live");
  });

  it("a live status event always wins over the snapshot fetch", async () => {
    // Snapshot says muted, but a live event lands first — the event must win.
    invokeMock.mockResolvedValueOnce({ muted: true, down: null });
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://status", { state: "live" });
    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  it("does NOT throw when invoke rejects (no-backend case)", async () => {
    invokeMock.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useVoice());

    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    // A mute call whose invoke rejects must also be swallowed.
    act(() => result.current.mute(true));
    expect(result.current.status).toBe("muted");
    // Give the swallowed rejection a tick; nothing should throw.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("muted");
  });

  it("unsubscribes from all events on unmount", async () => {
    const { unmount } = renderHook(() => useVoice());
    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith("voice://intent", expect.any(Function)),
    );

    unmount();

    expect(unlistenMock).toHaveBeenCalledTimes(3);
  });
});

describe("useVoice — deriveStatus", () => {
  it("down beats muted beats live", () => {
    expect(deriveStatus(false, false)).toBe("live");
    expect(deriveStatus(true, false)).toBe("muted");
    expect(deriveStatus(false, true)).toBe("down");
    // down wins even when also muted.
    expect(deriveStatus(true, true)).toBe("down");
  });
});
