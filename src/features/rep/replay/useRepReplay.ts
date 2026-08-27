import { useCallback, useEffect, useRef, useState } from "react";
import { nativeRepReplayApi } from "./api";
import { createPianoCapture } from "./pianoCapture";
import type {
  CapturedPianoTake,
  PianoCapture,
  PianoCaptureFactory,
  RepReplayApi,
  RepReplayCaptureOwnership,
  RepReplayMeta,
  ReplayPhase,
} from "./types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

let captureRequestSequence = 0;

function nextCaptureRequestId(): string {
  captureRequestSequence += 1;
  return `listen-back-${Date.now()}-${captureRequestSequence}`;
}

export interface UseRepReplayOptions {
  repBlockId: number;
  api?: RepReplayApi;
  captureFactory?: PianoCaptureFactory;
  onKept?: () => void;
  /** Native STT must be physically released before WebView capture opens. */
  captureOwnership?: RepReplayCaptureOwnership;
}

export type ReplayCaptureSafety = "idle" | "pending" | "held" | "failed";

export interface RepReplayController {
  enabled: boolean;
  phase: ReplayPhase;
  reviewed: boolean;
  reviewBypassed: boolean;
  verdictCommitted: boolean;
  keep: boolean;
  takeUrl: string | null;
  durationMs: number;
  kept: RepReplayMeta[];
  keptPlaybackUrl: string | null;
  error: string | null;
  captureSafety: ReplayCaptureSafety;
  setEnabled(value: boolean): void;
  setKeep(value: boolean): void;
  start(): Promise<void>;
  stop(): void;
  markReviewed(): void;
  judgeAnyway(): void;
  discard(): void;
  assertVerdictReady(): boolean;
  commitAfterVerdict(attemptId: number | null): Promise<void>;
  retryKeep(): Promise<void>;
  playKept(id: number): Promise<void>;
  deleteKept(id: number): Promise<void>;
}

export function useRepReplay({
  repBlockId,
  api = nativeRepReplayApi,
  captureFactory = createPianoCapture,
  onKept,
  captureOwnership,
}: UseRepReplayOptions): RepReplayController {
  const [enabled, setEnabledState] = useState(false);
  const [phase, setPhase] = useState<ReplayPhase>("idle");
  const [reviewed, setReviewed] = useState(false);
  const [reviewBypassed, setReviewBypassed] = useState(false);
  const [verdictCommitted, setVerdictCommitted] = useState(false);
  const [keep, setKeep] = useState(false);
  const [take, setTake] = useState<CapturedPianoTake | null>(null);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [kept, setKept] = useState<RepReplayMeta[]>([]);
  const [keptPlaybackUrl, setKeptPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureSafety, setCaptureSafety] =
    useState<ReplayCaptureSafety>("idle");
  const captureRef = useRef<PianoCapture | null>(null);
  const takeUrlRef = useRef<string | null>(null);
  const keptUrlRef = useRef<string | null>(null);
  const enabledRef = useRef(false);
  const mountedRef = useRef(true);
  const blockIdRef = useRef(repBlockId);
  const captureGenerationRef = useRef(0);
  const startPendingRef = useRef(false);
  const savePendingRef = useRef(false);
  const commitPendingRef = useRef(false);
  const committedAttemptIdRef = useRef<number | null>(null);
  const autoStartArmedRef = useRef(false);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const captureOwnershipRef = useRef(captureOwnership);
  const ownershipRequestsRef = useRef(new Set<string>());
  const currentOwnershipRequestRef = useRef<string | null>(null);
  const mediaRequestRef = useRef<string | null>(null);
  const releaseAfterMediaRef = useRef(new Set<string>());
  const teardownBarrierRef = useRef<Promise<void>>(Promise.resolve());
  blockIdRef.current = repBlockId;
  captureOwnershipRef.current = captureOwnership;

  const revoke = (kind: "take" | "kept") => {
    const ref = kind === "take" ? takeUrlRef : keptUrlRef;
    if (ref.current) URL.revokeObjectURL(ref.current);
    ref.current = null;
    if (kind === "take") setTakeUrl(null);
    else setKeptPlaybackUrl(null);
  };

  const refresh = useCallback(async () => {
    const requestedBlockId = repBlockId;
    if (requestedBlockId <= 0) {
      if (mountedRef.current && blockIdRef.current === requestedBlockId) {
        setKept([]);
      }
      return;
    }
    try {
      const rows = await api.list(requestedBlockId);
      if (
        mountedRef.current &&
        blockIdRef.current === requestedBlockId
      ) {
        setKept(Array.isArray(rows) ? rows : []);
      }
    } catch {
      // A missing browser-dev command should not block the live rep loop.
    }
  }, [api, repBlockId]);

  const releaseOwnership = useCallback(
    (requestId: string, tracksReleased?: Promise<void>) => {
      ownershipRequestsRef.current.delete(requestId);
      if (currentOwnershipRequestRef.current === requestId) {
        currentOwnershipRequestRef.current = null;
      }
      const operation = (async () => {
        try {
          await tracksReleased;
        } catch {
          // A capture teardown error must never skip returning native ownership.
        }
        const owner = captureOwnershipRef.current;
        if (owner) {
          try {
            await owner.resume(requestId);
          } catch {
            // Idempotent request identity makes one lost IPC reply safe to retry:
            // a successful first release cannot restart STT twice.
            try {
              await owner.resume(requestId);
            } catch {
              // App shutdown/no backend. Native teardown owns final cleanup.
            }
          }
        }
        releaseAfterMediaRef.current.delete(requestId);
      })();
      const previous = teardownBarrierRef.current;
      teardownBarrierRef.current = Promise.all([previous, operation]).then(
        () => undefined,
      );
      return operation;
    },
    [],
  );

  const acquireOwnership = useCallback(async (): Promise<string | null> => {
    const owner = captureOwnershipRef.current;
    if (!owner) return null;
    const requestId = nextCaptureRequestId();
    ownershipRequestsRef.current.add(requestId);
    currentOwnershipRequestRef.current = requestId;
    try {
      let epoch: number;
      try {
        epoch = await owner.suspend(requestId);
      } catch {
        // Same request id: if native completed but its reply was lost this is
        // an idempotent read, not a second lease.
        epoch = await owner.suspend(requestId);
      }
      if (!Number.isSafeInteger(epoch) || epoch < 1) {
        throw new Error("Native voice capture canceled this review request.");
      }
      return requestId;
    } catch (cause) {
      // Cancel a command that may still arrive after the rejected bridge call.
      await releaseOwnership(requestId);
      throw cause;
    }
  }, [releaseOwnership]);

  const endReviewOwnership = useCallback(
    (capture: PianoCapture | null) => {
      const requestId = currentOwnershipRequestRef.current;
      if (!requestId) return;
      if (mediaRequestRef.current === requestId) {
        // getUserMedia is already in flight. Releasing native STT now would let
        // it reacquire the device before the late WebView stream is stopped.
        releaseAfterMediaRef.current.add(requestId);
        return;
      }
      void releaseOwnership(requestId, capture?.released);
    },
    [releaseOwnership],
  );

  const resetTake = useCallback(() => {
    // Invalidates both an active recorder and a getUserMedia request whose
    // promise has not resolved yet. A permission sheet may outlive a set
    // switch or an off-toggle; its late result must never reopen the mic.
    captureGenerationRef.current += 1;
    startPendingRef.current = false;
    autoStartArmedRef.current = enabledRef.current;
    const capture = captureRef.current;
    capture?.cancel();
    captureRef.current = null;
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTakeUrl(null);
    setTake(null);
    setReviewed(false);
    setReviewBypassed(false);
    setVerdictCommitted(false);
    committedAttemptIdRef.current = null;
    commitPendingRef.current = false;
    setKeep(false);
    setPhase("idle");
    setError(null);
    return capture;
  }, []);

  const discard = useCallback(() => {
    if (savePendingRef.current) return;
    resetTake();
  }, [resetTake]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const capture = resetTake();
    enabledRef.current = false;
    setEnabledState(false);
    setCaptureSafety("idle");
    endReviewOwnership(capture);
    setKept([]);
    revoke("kept");
    // `discard` is stable; this intentionally follows only the authoritative
    // block identity, never every snapshot update after a rep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReviewOwnership, repBlockId, resetTake]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        enabledRef.current = false;
        captureGenerationRef.current += 1;
        startPendingRef.current = false;
        const capture = captureRef.current;
        capture?.cancel();
        captureRef.current = null;
        endReviewOwnership(capture);
        if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
        if (keptUrlRef.current) URL.revokeObjectURL(keptUrlRef.current);
      };
    },
    [endReviewOwnership],
  );

  const setEnabled = (value: boolean) => {
    if (!value && savePendingRef.current) return;
    enabledRef.current = value;
    autoStartArmedRef.current = value;
    if (!value) {
      const capture = resetTake();
      setCaptureSafety("idle");
      endReviewOwnership(capture);
    }
    setEnabledState(value);
  };

  const start = async () => {
    if (
      phase !== "idle" ||
      startPendingRef.current ||
      !enabledRef.current ||
      repBlockId <= 0
    )
      return;
    autoStartArmedRef.current = false;
    startPendingRef.current = true;
    const generation = captureGenerationRef.current + 1;
    captureGenerationRef.current = generation;
    const requestedBlockId = repBlockId;
    let terminal = false;
    const stillCurrent = () =>
      mountedRef.current &&
      enabledRef.current &&
      blockIdRef.current === requestedBlockId &&
      captureGenerationRef.current === generation;
    setError(null);
    setPhase("requesting");
    setCaptureSafety("pending");
    let requestId: string | null = null;
    let resolveMediaBarrier: () => void = () => undefined;
    let ownershipReady = false;
    try {
      // A prior block/off transition may still be stopping a late
      // getUserMedia stream. Never reuse its request id or open a second stream
      // until both that stream and its native lease have been released.
      await teardownBarrierRef.current;
      if (!stillCurrent()) return;
      requestId = currentOwnershipRequestRef.current;
      if (!requestId) requestId = await acquireOwnership();
      if (!stillCurrent()) {
        if (requestId) await releaseOwnership(requestId);
        return;
      }
      ownershipReady = true;
      setCaptureSafety("held");
      if (requestId) {
        mediaRequestRef.current = requestId;
        const mediaBarrier = new Promise<void>((resolve) => {
          resolveMediaBarrier = resolve;
        });
        const previous = teardownBarrierRef.current;
        teardownBarrierRef.current = Promise.all([previous, mediaBarrier]).then(
          () => undefined,
        );
      }
      const capture = await captureFactory(
        (finished) => {
          terminal = true;
          if (!stillCurrent()) return;
          captureRef.current = null;
          setTake(finished);
          if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
          const url = URL.createObjectURL(finished.blob);
          takeUrlRef.current = url;
          setTakeUrl(url);
          setPhase("review");
        },
        (message) => {
          terminal = true;
          if (!stillCurrent()) return;
          captureRef.current = null;
          // Native STT ownership is still held. A recorder/device error may be
          // retried or explicitly bypassed without reopening the voice path.
          setCaptureSafety("held");
          setError(message);
          setPhase("idle");
        },
      );
      if (mediaRequestRef.current === requestId) mediaRequestRef.current = null;
      const releaseWasRequested =
        requestId != null && releaseAfterMediaRef.current.has(requestId);
      if (!stillCurrent() || releaseWasRequested) {
        capture.cancel();
        if (requestId) await releaseOwnership(requestId, capture.released);
        resolveMediaBarrier();
        return;
      }
      resolveMediaBarrier();
      if (terminal) {
        capture.cancel();
        return;
      }
      captureRef.current = capture;
      setPhase("recording");
    } catch (cause) {
      if (mediaRequestRef.current === requestId) mediaRequestRef.current = null;
      resolveMediaBarrier();
      if (!stillCurrent()) {
        if (requestId) await releaseOwnership(requestId);
        return;
      }
      setCaptureSafety(ownershipReady ? "held" : "failed");
      setError(
        ownershipReady && cause instanceof Error
          ? cause.message
          : ownershipReady
            ? "The microphone could not start a review take."
            : cause instanceof Error
              ? `Listen Back could not safely take the microphone: ${cause.message}`
              : "Listen Back could not safely take the microphone.",
      );
      setPhase("idle");
    } finally {
      if (captureGenerationRef.current === generation) {
        startPendingRef.current = false;
      }
    }
  };
  startRef.current = start;

  useEffect(() => {
    if (
      !enabled ||
      phase !== "idle" ||
      repBlockId <= 0 ||
      !autoStartArmedRef.current
    )
      return;
    const timer = window.setTimeout(() => void startRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, phase, repBlockId]);

  const stop = () => captureRef.current?.stop();

  const markReviewed = () => {
    if (phase === "review") setReviewed(true);
  };

  const judgeAnyway = () => {
    if (captureSafety === "pending" || captureSafety === "failed") {
      setError(
        captureSafety === "pending"
          ? "Wait until Listen Back has exclusive microphone control."
          : "Turn Listen Back off or retry the take before recording a verdict.",
      );
      return;
    }
    if (phase === "recording" || phase === "requesting") {
      discard();
      // `resetTake` normally arms the next automatic clip. Here the pianist
      // is intentionally crossing the current verdict boundary without a
      // clip, so wait until that verdict commits before starting another.
      autoStartArmedRef.current = false;
    }
    setReviewBypassed(true);
    setError(null);
  };

  const assertVerdictReady = () => {
    if (!enabled) return true;
    if (captureSafety === "pending" || captureSafety === "failed") {
      setError(
        captureSafety === "pending"
          ? "Wait until Listen Back has exclusive microphone control."
          : "Listen Back could not release voice capture. Turn it off or retry the take.",
      );
      return false;
    }
    if (reviewBypassed) return true;
    if (verdictCommitted) {
      setError("That verdict is already saved. Retry keeping the audio or discard the take.");
      return false;
    }
    if (phase === "review" && reviewed) return true;
    if (phase === "recording") {
      stop();
      setError("Take finished. Listen once, then choose the verdict again.");
      return false;
    }
    setError(
      "Record and listen to the take before choosing a verdict.",
    );
    return false;
  };

  const persistKeptTake = async (attemptId: number) => {
    if (!take || savePendingRef.current) return;
    savePendingRef.current = true;
    const operationGeneration = captureGenerationRef.current;
    const operationBlockId = repBlockId;
    const operationTake = take;
    const operationIsCurrent = () =>
      mountedRef.current &&
      blockIdRef.current === operationBlockId &&
      captureGenerationRef.current === operationGeneration;
    setPhase("saving");
    setError(null);
    try {
      const bytes = new Uint8Array(await operationTake.blob.arrayBuffer());
      await api.save({
        rep_block_id: operationBlockId,
        attempt_id: attemptId,
        mime_type: operationTake.blob.type || "audio/webm",
        duration_ms: operationTake.durationMs,
        bytes_base64: bytesToBase64(bytes),
      });
      if (!operationIsCurrent()) return;
      onKept?.();
      resetTake();
      enabledRef.current = true;
      setEnabledState(true);
      await refresh();
    } catch (cause) {
      if (!operationIsCurrent()) return;
      setPhase("review");
      setError(
        cause instanceof Error
          ? `Verdict saved. The recording was not kept: ${cause.message}`
          : "Verdict saved, but its recording could not be kept.",
      );
    } finally {
      savePendingRef.current = false;
    }
  };

  const commitAfterVerdict = async (attemptId: number | null) => {
    if (!enabled || verdictCommitted || commitPendingRef.current) return;
    commitPendingRef.current = true;
    if (!take) {
      // Explicit “judge anyway” is a soft-nudge escape hatch, not a second
      // recording path. Reset immediately for the next rep.
      resetTake();
      enabledRef.current = true;
      setEnabledState(true);
      // The judge-anyway transition already put `phase` at idle, so React may
      // legitimately elide this second idle state update. Kick the normal
      // guarded start seam once rather than depending on a phase re-render.
      window.setTimeout(() => void startRef.current(), 0);
      return;
    }
    setVerdictCommitted(true);
    if (!keep) {
      resetTake();
      return;
    }
    if (attemptId == null || attemptId < 1) {
      setPhase("review");
      setError(
        "Verdict saved, but the app did not return its exact attempt identity. The audio was not kept.",
      );
      return;
    }
    committedAttemptIdRef.current = attemptId;
    await persistKeptTake(attemptId);
  };

  const retryKeep = async () => {
    if (
      !verdictCommitted ||
      !take ||
      !keep ||
      phase === "saving" ||
      savePendingRef.current
    )
      return;
    const attemptId = committedAttemptIdRef.current;
    if (attemptId != null) await persistKeptTake(attemptId);
  };

  const playKept = async (id: number) => {
    const operationBlockId = repBlockId;
    setError(null);
    try {
      const meta = kept.find((row) => row.id === id);
      const encoded = await api.read(id);
      if (
        !mountedRef.current ||
        blockIdRef.current !== operationBlockId
      )
        return;
      revoke("kept");
      const url = URL.createObjectURL(
        new Blob([base64ToBytes(encoded)], {
          type: meta?.mime_type ?? "audio/webm",
        }),
      );
      keptUrlRef.current = url;
      setKeptPlaybackUrl(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The kept take could not be read.",
      );
    }
  };

  const deleteKept = async (id: number) => {
    const operationBlockId = repBlockId;
    setError(null);
    try {
      await api.delete(id);
      if (
        !mountedRef.current ||
        blockIdRef.current !== operationBlockId
      )
        return;
      revoke("kept");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The kept take could not be deleted.",
      );
    }
  };

  return {
    enabled,
    phase,
    reviewed,
    reviewBypassed,
    verdictCommitted,
    keep,
    takeUrl,
    durationMs: take?.durationMs ?? 0,
    kept,
    keptPlaybackUrl,
    error,
    captureSafety,
    setEnabled,
    setKeep,
    start,
    stop,
    markReviewed,
    judgeAnyway,
    discard,
    assertVerdictReady,
    commitAfterVerdict,
    retryKeep,
    playKept,
    deleteKept,
  };
}
