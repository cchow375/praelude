import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPianoCapture,
  PIANO_AUDIO_CONSTRAINTS,
  PIANO_CAPTURE_MAX_DURATION_MS,
} from "./pianoCapture";

type Listener = (event: Event & { data?: Blob }) => void;

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  static latest: FakeRecorder | null = null;
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  listeners = new Map<string, Listener[]>();
  stop = vi.fn(() => {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.emit("stop", new Event("stop"));
  });

  constructor() {
    FakeRecorder.latest = this;
  }

  addEventListener(name: string, listener: EventListener) {
    const rows = this.listeners.get(name) ?? [];
    rows.push(listener as Listener);
    this.listeners.set(name, rows);
  }

  start() {
    this.state = "recording";
  }

  emit(name: string, event: Event) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function installMic(
  recorder: typeof MediaRecorder = FakeRecorder as unknown as typeof MediaRecorder,
) {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
    },
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: recorder,
  });
  return stop;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  FakeRecorder.latest = null;
});

describe("piano review capture", () => {
  it("preserves piano dynamics instead of applying speech processing", () => {
    expect(PIANO_AUDIO_CONSTRAINTS).toEqual(
      expect.objectContaining({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
      }),
    );
  });

  it("releases every mic track when MediaRecorder construction fails", async () => {
    const stop = installMic(
      class {
        static isTypeSupported() {
          return false;
        }
        constructor() {
          throw new Error("constructor failed");
        }
      } as unknown as typeof MediaRecorder,
    );
    await expect(createPianoCapture(vi.fn(), vi.fn())).rejects.toThrow(
      "constructor failed",
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases every mic track when recorder.start fails", async () => {
    class StartFailure extends FakeRecorder {
      override start() {
        throw new Error("start failed");
      }
    }
    const stop = installMic(StartFailure as unknown as typeof MediaRecorder);
    await expect(createPianoCapture(vi.fn(), vi.fn())).rejects.toThrow(
      "start failed",
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("automatically stops one bounded take at ten minutes", async () => {
    vi.useFakeTimers();
    const stopTrack = installMic();
    const onError = vi.fn();
    await createPianoCapture(vi.fn(), onError);
    await vi.advanceTimersByTimeAsync(PIANO_CAPTURE_MAX_DURATION_MS);
    expect(FakeRecorder.latest?.stop).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("settles recorder error plus stop only once", async () => {
    const stopTrack = installMic();
    const onFinished = vi.fn();
    const onError = vi.fn();
    await createPianoCapture(onFinished, onError);
    const recorder = FakeRecorder.latest!;
    recorder.emit("error", new Event("error"));
    recorder.stop();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFinished).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("exposes a barrier that resolves only after every stream track stops", async () => {
    const stopTrack = installMic();
    const capture = await createPianoCapture(vi.fn(), vi.fn());
    let released = false;
    void capture.released.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    capture.cancel();
    await capture.released;
    expect(released).toBe(true);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
