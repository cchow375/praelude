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
import type { TierAContext } from "./domain/tierAIntent";

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

    expect(result.current.status).toBe("down");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("voice_state"));
    for (const ev of ["voice://status", "voice://transcript", "voice://intent"]) {
      await waitFor(() =>
        expect(listenMock).toHaveBeenCalledWith(ev, expect.any(Function)),
      );
    }
    expect(result.current.status).toBe("live");
  });

  it("never presents a fake live mic while the backend snapshot is pending", async () => {
    let resolveSnapshot!: (value: { muted: boolean; down: null }) => void;
    invokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const { result } = renderHook(() => useVoice());

    expect(result.current.status).toBe("down");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("voice_state"));
    expect(result.current.status).toBe("down");

    act(() => resolveSnapshot({ muted: false, down: null }));
    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  it("reflects an initial muted snapshot from voice_state", async () => {
    invokeMock.mockResolvedValueOnce({ muted: true, down: null });
    const { result } = renderHook(() => useVoice());

    await waitFor(() => expect(result.current.status).toBe("muted"));
  });

  it("keeps an unsupported-platform snapshot down with explicit guidance", async () => {
    invokeMock.mockResolvedValueOnce({
      muted: false,
      down: "unsupported-platform",
      guidance:
        "Hands-free voice is unavailable on Windows. Keyboard and mouse practice controls still work.",
    });
    const { result } = renderHook(() => useVoice());

    await waitFor(() =>
      expect(result.current.downGuidance).toContain("unavailable on Windows"),
    );
    expect(result.current.status).toBe("down");
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
    expect(result.current.downGuidance).toContain("Enable Dictation");
  });

  it("surfaces the backend's routing outcome on the accepted final delivery", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://transcript", {
      delivery_id: "speech-9",
      revision: 0,
      text: "start a rep tracker measures 40 to 56 at 80",
      is_final: true,
      handled: true,
      source: "macos_speech",
      confidence: null,
    });
    expect(result.current.acceptedFinalDelivery).toMatchObject({
      delivery_id: "speech-9",
      handled: true,
    });
  });

  it("accepts rich transcript metadata and ignores an exact replay + stale revision", async () => {
    const context: TierAContext = {
      practice_state: "active",
      metronome_running: true,
      last_attempt_available: true,
      pending_duplicate_attempt: false,
      retention_due: false,
    };
    const { result } = renderHook(() => useVoice(context));
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://transcript", {
      delivery_id: "speech-8",
      revision: 2,
      text: "clean",
      is_final: true,
      source: "macos_speech",
      confidence: 0.82,
    });
    expect(result.current.acceptedFinalDelivery).toMatchObject({
      delivery_id: "speech-8",
      revision: 2,
      recognition: { source: "macos_speech", confidence: 0.82 },
    });
    expect(result.current.tierAResult).toMatchObject({
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "clean" },
    });

    emit("voice://transcript", {
      delivery_id: "speech-8",
      revision: 2,
      text: "flawed",
      is_final: true,
      recognition: { source: "narrated_replay", confidence: 0.2 },
    });
    expect(result.current.deliveryDisposition?.kind).toBe("duplicate");
    expect(result.current.acceptedFinalDelivery?.text).toBe("clean");

    emit("voice://transcript", {
      delivery_id: "speech-8",
      revision: 1,
      text: "miss",
      is_final: true,
      source: "narrated_replay",
      confidence: null,
    });
    expect(result.current.deliveryDisposition?.kind).toBe("stale_revision");
    expect(result.current.acceptedFinalDelivery?.revision).toBe(2);
    expect(result.current.tierAResult).toMatchObject({
      intent: { kind: "record_attempt", verdict: "clean" },
    });
  });

  it("does not collapse identical words from distinct delivery identities", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    for (const deliveryId of ["utterance-a", "utterance-b"]) {
      emit("voice://transcript", {
        delivery_id: deliveryId,
        revision: 0,
        text: "practice measures 8 to 12",
        is_final: true,
        source: "macos_speech",
        confidence: null,
      });
    }

    expect(result.current.deliveryDisposition).toMatchObject({
      kind: "accepted_new",
      identity: { delivery_id: "utterance-b", revision: 0 },
    });
    expect(result.current.acceptedFinalDelivery?.delivery_id).toBe("utterance-b");
  });

  it("keeps interim recognition out of accepted-final state", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://transcript", {
      delivery_id: "progressive-1",
      revision: 0,
      text: "practice measures",
      is_final: false,
      source: "macos_speech",
      confidence: 0.45,
    });

    expect(result.current.acceptedFinalDelivery).toBeNull();
    expect(result.current.tierAResult).toMatchObject({
      classification: "ignored",
      reason: "non_final",
    });
  });

  it("keeps ambient finals inert and marks them unhandled for Lane B", async () => {
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://transcript", {
      delivery_id: "ambient-1",
      revision: 0,
      text: "I think that sounded warmer",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.91,
    });
    expect(result.current.tierAResult).toMatchObject({
      classification: "ignored",
      reason: "not_exact_command",
    });
    // An unrouted ambient final is accepted (Lane B may then draft it) and
    // carries the backend's handled=false decision.
    expect(result.current.acceptedFinalDelivery).toMatchObject({
      delivery_id: "ambient-1",
      handled: false,
    });
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
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => result.current.mute(true));

    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: true });
    expect(result.current.status).toBe("muted");

    act(() => result.current.mute(false));
    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: false });
    expect(result.current.status).toBe("live");
  });

  it("passes exact capture request identity through suspend and resume", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "voice_capture_suspend") return Promise.resolve(17);
      if (command === "voice_capture_resume") return Promise.resolve(true);
      return Promise.resolve({ muted: false, down: null });
    });
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await expect(result.current.suspendCapture("listen-back-17")).resolves.toBe(
      17,
    );
    await expect(result.current.resumeCapture("listen-back-17")).resolves.toBe(
      true,
    );
    expect(invokeMock).toHaveBeenCalledWith("voice_capture_suspend", {
      requestId: "listen-back-17",
    });
    expect(invokeMock).toHaveBeenCalledWith("voice_capture_resume", {
      requestId: "listen-back-17",
    });
  });

  it("a live status event always wins over the snapshot fetch", async () => {
    // Snapshot says muted, but a live event lands first — the event must win.
    invokeMock.mockResolvedValueOnce({ muted: true, down: null });
    const { result } = renderHook(() => useVoice());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit("voice://status", { state: "live" });
    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  it("fails closed when invoke rejects instead of leaving a fake live mic", async () => {
    invokeMock.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useVoice());

    await waitFor(() =>
      expect(result.current.downGuidance).toContain("native voice service"),
    );
    expect(result.current.status).toBe("down");
    invokeMock.mockClear();
    // Down state cannot be optimistically toggled back into a fake live state.
    act(() => result.current.mute(true));
    expect(result.current.status).toBe("down");
    expect(invokeMock).not.toHaveBeenCalledWith("voice_mute", expect.anything());
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
