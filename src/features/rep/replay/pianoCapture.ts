import type {
  PianoCapture,
  PianoCaptureFactory,
} from "./types";

/**
 * Piano playback should preserve the instrument's wide dynamics. Browser
 * speech defaults intentionally compress and denoise; those are useful for a
 * meeting, but erase exactly the balance and decay the pianist is reviewing.
 */
export const PIANO_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48_000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export const PIANO_CAPTURE_MAX_DURATION_MS = 10 * 60 * 1000;
export const PIANO_CAPTURE_MAX_BYTES = 12 * 1024 * 1024;

function preferredMimeType(): string | undefined {
  const choices = [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  return choices.find((mime) => MediaRecorder.isTypeSupported?.(mime));
}

export const createPianoCapture: PianoCaptureFactory = async (
  onFinished,
  onError,
) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This device cannot open the microphone for a review take.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This app build cannot make a compact review recording.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: PIANO_AUDIO_CONSTRAINTS,
  });
  const chunks: BlobPart[] = [];
  const mimeType = preferredMimeType();
  let released = false;
  let resolveReleased!: () => void;
  const releasedPromise = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  const release = () => {
    if (released) return;
    released = true;
    for (const track of stream.getTracks()) track.stop();
    resolveReleased();
  };
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: 96_000 } : undefined,
    );
  } catch (cause) {
    release();
    throw cause;
  }
  const started = performance.now();
  let cancelled = false;
  let settled = false;
  let totalBytes = 0;
  let sizeExceeded = false;
  let durationTimer: number | null = null;
  const clearDurationTimer = () => {
    if (durationTimer != null) window.clearTimeout(durationTimer);
    durationTimer = null;
  };
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    clearDurationTimer();
    release();
    if (!cancelled) onError(message);
  };
  recorder.addEventListener("dataavailable", (event) => {
    if (settled || event.data.size <= 0) return;
    totalBytes += event.data.size;
    if (totalBytes > PIANO_CAPTURE_MAX_BYTES) {
      sizeExceeded = true;
      try {
        if (recorder.state !== "inactive") recorder.stop();
        else fail("The review take reached its 12 MB safety limit.");
      } catch {
        fail("The review take reached its 12 MB safety limit.");
      }
      return;
    }
    chunks.push(event.data);
  });
  recorder.addEventListener("error", () => {
    fail("The review recording stopped unexpectedly.");
  });
  recorder.addEventListener("stop", () => {
    if (settled) return;
    if (sizeExceeded) {
      fail("The review take reached its 12 MB safety limit.");
      return;
    }
    settled = true;
    clearDurationTimer();
    release();
    if (cancelled) return;
    const blob = new Blob(chunks, {
      type: recorder.mimeType || mimeType || "audio/webm",
    });
    if (blob.size === 0) {
      onError("The microphone returned an empty recording. Try the take again.");
      return;
    }
    onFinished({
      blob,
      durationMs: Math.max(1, Math.round(performance.now() - started)),
    });
  });
  try {
    recorder.start(250);
  } catch (cause) {
    settled = true;
    release();
    throw cause;
  }
  durationTimer = window.setTimeout(() => {
    if (settled || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      fail("The review take could not stop at its 10-minute safety limit.");
    }
  }, PIANO_CAPTURE_MAX_DURATION_MS);

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
    cancel: () => {
      if (settled) return;
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      else {
        settled = true;
        clearDurationTimer();
        release();
      }
    },
    released: releasedPromise,
  } satisfies PianoCapture;
};
