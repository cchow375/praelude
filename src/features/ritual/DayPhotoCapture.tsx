import { useCallback, useEffect, useRef, useState } from "react";
import { dayPhotoSave } from "./api";
import { toFullBase64, toThumbnailBase64 } from "./thumbnail";
import "./ritual.css";

/**
 * The day-close ritual card. A ritual, not a toll: Escape or one button press
 * leaves without writing anything, and a denied camera silently becomes a
 * file-drop card rather than an error the user has to dismiss.
 *
 * There is deliberately no window.confirm anywhere in this flow — wry/WKWebView
 * has returned falsy from it silently in the past (see SessionBar.tsx's comment
 * at line 111), and the whole point of this card is that it must never be able
 * to trap him at the end of a practice day.
 */

export interface DayPhotoCaptureProps {
  /** LOCAL day this photo belongs to. */
  day: string;
  /** Called after a successful day_photo_save, or on skip. */
  onDone: () => void;
  /** Test seam; production uses navigator.mediaDevices.getUserMedia. */
  getMedia?: () => Promise<MediaStream>;
}

type Mode = "choice" | "pending" | "camera" | "files";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

export function DayPhotoCapture({
  day,
  onDone,
  getMedia,
}: DayPhotoCaptureProps) {
  const [mode, setMode] = useState<Mode>("choice");
  const [busy, setBusy] = useState(false);
  // F5 fix wave: a failed save used to be silent — an unhandled rejection,
  // no feedback, a card that just sat there with the ritual lost. Skip
  // always stays available regardless of this state.
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode === "camera" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [mode]);

  const startCamera = useCallback(() => {
    // Camera access is deliberately tied to this explicit user action. The
    // card may appear after "End my day" or after a rollover prompt, but
    // merely showing it never requests a privacy-sensitive device.
    setMode("pending");
    setError(null);
    const request =
      getMedia ??
      (() =>
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }));
    // Start through a promise boundary so an absent mediaDevices object or a
    // test/browser implementation that throws synchronously takes the same
    // harmless file-fallback path as a rejected permission request.
    void Promise.resolve()
      .then(request)
      .then((next) => {
        if (!aliveRef.current) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = next;
        setMode("camera");
      })
      .catch(() => {
        // Denied, unavailable, or unsupported. The file path remains usable
        // and the ritual never becomes an error or a toll.
        if (aliveRef.current) setMode("files");
      });
  }, [getMedia]);

  const finish = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onDone();
  }, [onDone]);

  useEffect(() => {
    // Escape works the instant the card mounts, no click needed first.
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    // F8 fix wave: the card is a fixed corner panel, not a focus-trapping
    // modal — one click anywhere else on the page used to move focus
    // outside it and silently disable the Esc key path (Skip was always
    // still one click away, so this was never a toll, just a caveat).
    // Listening at the document level while the card is mounted means
    // Escape skips it no matter where focus currently is.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [finish]);

  const saveCapture = useCallback(
    async (source: HTMLVideoElement | HTMLImageElement) => {
      setBusy(true);
      setError(null);
      try {
        const [jpegBase64, thumbBase64] = await Promise.all([
          toFullBase64(source),
          toThumbnailBase64(source),
        ]);
        await dayPhotoSave(day, jpegBase64, thumbBase64);
        finish();
      } catch (cause) {
        // Honest, inline, and non-blocking — Skip is still one press away
        // (it is rendered unconditionally below, not gated on this state).
        setError(
          cause instanceof Error
            ? cause.message
            : typeof cause === "string"
              ? cause
              : "Could not save today's photo.",
        );
      } finally {
        setBusy(false);
      }
    },
    [day, finish],
  );

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current) return;
    void saveCapture(videoRef.current);
  }, [saveCapture]);

  const captureFromFile = useCallback(
    (file: File) => {
      void readFileAsDataUrl(file).then(loadImage).then(saveCapture);
    },
    [saveCapture],
  );

  return (
    <div
      ref={rootRef}
      className="day-photo-card"
      tabIndex={-1}
      role="dialog"
      aria-label="Today's practice photo"
    >
      <p className="day-photo-ask">Add a photo from today's practice?</p>

      {mode === "choice" && (
        <button
          type="button"
          className="day-photo-camera-start"
          onClick={startCamera}
        >
          Use camera
        </button>
      )}

      {mode === "pending" && (
        <p className="day-photo-camera-pending" role="status">
          Opening camera…
        </p>
      )}

      {mode === "camera" && (
        <div className="day-photo-camera">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            className="day-photo-video"
            autoPlay
            muted
            playsInline
          />
          <button
            type="button"
            className="day-photo-take"
            onClick={captureFromCamera}
            disabled={busy}
          >
            Take today's photo
          </button>
        </div>
      )}

      {(mode === "choice" || mode === "files") && (
        <div
          className="day-photo-dropzone"
          data-testid="day-photo-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) captureFromFile(file);
          }}
        >
          <p className="day-photo-dropzone-hint">
            {mode === "choice"
              ? "Or drop a photo here, or choose one."
              : "Drop a photo here, or choose one."}
          </p>
          <input
            type="file"
            accept="image/*"
            aria-label="Choose a photo"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) captureFromFile(file);
            }}
          />
        </div>
      )}

      {error && (
        <p className="day-photo-error" role="alert">
          {error} You can Skip and try again later.
        </p>
      )}

      <button type="button" className="day-photo-skip" onClick={finish}>
        Skip
      </button>
    </div>
  );
}
