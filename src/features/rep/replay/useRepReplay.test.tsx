import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepReplay } from "./useRepReplay";
import type {
  CapturedPianoTake,
  PianoCapture,
  PianoCaptureFactory,
  RepReplayCaptureOwnership,
  RepReplayApi,
} from "./types";

afterEach(cleanup);

describe("useRepReplay", () => {
  let finish: ((take: CapturedPianoTake) => void) | null = null;
  let captureFactory: PianoCaptureFactory;
  let api: RepReplayApi;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:take"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    captureFactory = vi.fn(async (onFinished) => {
      finish = onFinished;
      return { stop: vi.fn(), cancel: vi.fn(), released: Promise.resolve() };
    });
    api = {
      list: vi.fn(async () => []),
      save: vi.fn(async (input) => ({
        id: 8,
        rep_block_id: input.rep_block_id,
        attempt_id: 44,
        mime_type: input.mime_type,
        duration_ms: input.duration_ms,
        byte_len: window.atob(input.bytes_base64).length,
        verdict: "clean",
        created_at: "2026-08-27T10:00:00Z",
      })),
      read: vi.fn(async () => "AQID"),
      delete: vi.fn(async () => undefined),
    };
  });

  async function recordTake(result: {
    result: { current: ReturnType<typeof useRepReplay> };
  }) {
    await act(async () => result.result.current.start());
    act(() =>
      finish?.({
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
        durationMs: 1_200,
      }),
    );
  }

  it("nudges toward listening while preserving an explicit judge-anyway path", async () => {
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    expect(result.result.current.assertVerdictReady()).toBe(false);
    await recordTake(result);
    expect(result.result.current.phase).toBe("review");
    expect(result.result.current.assertVerdictReady()).toBe(false);
    act(() => result.result.current.markReviewed());
    expect(result.result.current.assertVerdictReady()).toBe(true);
  });

  it("awaits native STT release before getUserMedia and returns it only after tracks stop", async () => {
    const suspend = deferred<number>();
    const tracksReleased = deferred<void>();
    const ownership: RepReplayCaptureOwnership = {
      suspend: vi.fn(() => suspend.promise),
      resume: vi.fn(async () => true),
    };
    const cancel = vi.fn();
    captureFactory = vi.fn(async () => ({
      stop: vi.fn(),
      cancel,
      released: tracksReleased.promise,
    }));
    const result = renderHook(() =>
      useRepReplay({
        repBlockId: 9,
        api,
        captureFactory,
        captureOwnership: ownership,
      }),
    );

    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(ownership.suspend).toHaveBeenCalledTimes(1));
    expect(captureFactory).not.toHaveBeenCalled();
    expect(result.result.current.captureSafety).toBe("pending");
    expect(result.result.current.assertVerdictReady()).toBe(false);
    act(() => result.result.current.judgeAnyway());
    expect(result.result.current.reviewBypassed).toBe(false);

    await act(async () => suspend.resolve(1));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    expect(result.result.current.captureSafety).toBe("held");

    act(() => result.result.current.setEnabled(false));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ownership.resume).not.toHaveBeenCalled();
    await act(async () => tracksReleased.resolve());
    await waitFor(() => expect(ownership.resume).toHaveBeenCalledTimes(1));
    expect(ownership.resume).toHaveBeenCalledWith(
      vi.mocked(ownership.suspend).mock.calls[0][0],
    );
  });

  it("keeps native capture suspended through playback and releases on unmount", async () => {
    const ownership: RepReplayCaptureOwnership = {
      suspend: vi.fn(async () => 4),
      resume: vi.fn(async () => true),
    };
    const cancel = vi.fn();
    captureFactory = vi.fn(async (onFinished) => {
      finish = onFinished;
      return { stop: vi.fn(), cancel, released: Promise.resolve() };
    });
    const result = renderHook(() =>
      useRepReplay({
        repBlockId: 9,
        api,
        captureFactory,
        captureOwnership: ownership,
      }),
    );
    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    act(() =>
      finish?.({
        blob: new Blob([new Uint8Array([9])], { type: "audio/webm" }),
        durationMs: 500,
      }),
    );
    expect(result.result.current.phase).toBe("review");
    expect(ownership.resume).not.toHaveBeenCalled();

    result.unmount();
    await waitFor(() => expect(ownership.resume).toHaveBeenCalledTimes(1));
  });

  it("never enters capture or permits a verdict when native suspension fails", async () => {
    const ownership: RepReplayCaptureOwnership = {
      suspend: vi.fn(async () => {
        throw new Error("native capture unavailable");
      }),
      resume: vi.fn(async () => false),
    };
    const result = renderHook(() =>
      useRepReplay({
        repBlockId: 9,
        api,
        captureFactory,
        captureOwnership: ownership,
      }),
    );
    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(result.result.current.captureSafety).toBe("failed"));
    expect(ownership.suspend).toHaveBeenCalledTimes(2);
    expect(captureFactory).not.toHaveBeenCalled();
    expect(result.result.current.assertVerdictReady()).toBe(false);
    act(() => result.result.current.judgeAnyway());
    expect(result.result.current.reviewBypassed).toBe(false);
    expect(ownership.resume).toHaveBeenCalledTimes(1);
  });

  it("tears down a late old-block stream before a new block may acquire capture", async () => {
    const events: string[] = [];
    const firstFactory = deferred<PianoCapture>();
    const firstReleased = deferred<void>();
    const secondFactory = deferred<PianoCapture>();
    const secondReleased = deferred<void>();
    let factoryCall = 0;
    captureFactory = vi.fn(() => {
      factoryCall += 1;
      events.push(`gum-${factoryCall}`);
      return factoryCall === 1 ? firstFactory.promise : secondFactory.promise;
    });
    const ownership: RepReplayCaptureOwnership = {
      suspend: vi.fn(async (requestId) => {
        events.push(`suspend-${requestId}`);
        return factoryCall + 1;
      }),
      resume: vi.fn(async (requestId) => {
        events.push(`resume-${requestId}`);
        return true;
      }),
    };
    const firstCancel = vi.fn(() => events.push("cancel-1"));
    const secondCancel = vi.fn(() => events.push("cancel-2"));
    const result = renderHook(
      ({ blockId }) =>
        useRepReplay({
          repBlockId: blockId,
          api,
          captureFactory,
          captureOwnership: ownership,
        }),
      { initialProps: { blockId: 9 } },
    );

    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    result.rerender({ blockId: 10 });
    act(() => result.result.current.setEnabled(true));
    await Promise.resolve();
    expect(captureFactory).toHaveBeenCalledTimes(1);
    expect(ownership.suspend).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstFactory.resolve({
        stop: vi.fn(),
        cancel: firstCancel,
        released: firstReleased.promise,
      });
      await Promise.resolve();
    });
    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(ownership.resume).not.toHaveBeenCalled();
    expect(captureFactory).toHaveBeenCalledTimes(1);

    await act(async () => firstReleased.resolve());
    await waitFor(() => expect(ownership.resume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(2));
    expect(ownership.suspend).toHaveBeenCalledTimes(2);
    const firstResumeIndex = events.findIndex((event) => event.startsWith("resume-"));
    const secondSuspendIndex = events.findLastIndex((event) =>
      event.startsWith("suspend-"),
    );
    const secondGumIndex = events.indexOf("gum-2");
    expect(firstResumeIndex).toBeLessThan(secondSuspendIndex);
    expect(secondSuspendIndex).toBeLessThan(secondGumIndex);

    await act(async () => {
      secondFactory.resolve({
        stop: vi.fn(),
        cancel: secondCancel,
        released: secondReleased.promise,
      });
      await Promise.resolve();
    });
    result.unmount();
    expect(secondCancel).toHaveBeenCalledTimes(1);
    expect(ownership.resume).toHaveBeenCalledTimes(1);
    await act(async () => secondReleased.resolve());
    await waitFor(() => expect(ownership.resume).toHaveBeenCalledTimes(2));
  });

  it("does not restart capture between judge-anyway and that verdict", async () => {
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));

    act(() => result.result.current.judgeAnyway());
    expect(result.result.current.assertVerdictReady()).toBe(true);
    await Promise.resolve();
    expect(captureFactory).toHaveBeenCalledTimes(1);

    await act(async () => result.result.current.commitAfterVerdict(53));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(2));
  });

  it("discards temporary bytes unless Keep was explicitly selected", async () => {
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    await recordTake(result);
    act(() => result.result.current.markReviewed());
    await act(async () => result.result.current.commitAfterVerdict(51));
    expect(api.save).not.toHaveBeenCalled();
    expect(result.result.current.phase).toBe("idle");
    expect(result.result.current.enabled).toBe(true);
  });

  it("persists a compact take only after verdict when Keep is selected", async () => {
    const onKept = vi.fn();
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 23, api, captureFactory, onKept }),
    );
    act(() => result.result.current.setEnabled(true));
    await recordTake(result);
    act(() => {
      result.result.current.markReviewed();
      result.result.current.setKeep(true);
    });
    await act(async () => result.result.current.commitAfterVerdict(51));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith({
      rep_block_id: 23,
      attempt_id: 51,
      mime_type: "audio/webm",
      duration_ms: 1_200,
      bytes_base64: "AQID",
    });
    expect(onKept).toHaveBeenCalledTimes(1);
  });

  it("decodes compact base64 when playing a kept take", async () => {
    vi.mocked(api.list).mockResolvedValue([
      {
        id: 8,
        rep_block_id: 9,
        attempt_id: 44,
        mime_type: "audio/webm",
        duration_ms: 1_200,
        byte_len: 3,
        verdict: "clean",
        created_at: "2026-08-27T10:00:00Z",
      },
    ]);
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    await waitFor(() => expect(result.result.current.kept).toHaveLength(1));

    await act(async () => result.result.current.playKept(8));

    expect(api.read).toHaveBeenCalledWith(8);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBe(3);
    expect(result.result.current.keptPlaybackUrl).toBe("blob:take");
  });

  it("starts the first take and the next take automatically in Review mode", async () => {
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 23, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    act(() =>
      finish?.({
        blob: new Blob([new Uint8Array([4, 5])], { type: "audio/webm" }),
        durationMs: 800,
      }),
    );
    act(() => result.result.current.markReviewed());
    await act(async () => result.result.current.commitAfterVerdict(52));
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(2));
    expect(result.result.current.enabled).toBe(true);
    expect(result.result.current.phase).toBe("recording");
  });

  it("cancels a microphone permission result that arrives after Review mode is disabled", async () => {
    let resolveCapture!: (capture: {
      stop(): void;
      cancel(): void;
      released: Promise<void>;
    }) => void;
    const cancel = vi.fn();
    captureFactory = vi.fn(
      (onFinished) => {
        finish = onFinished;
        return (
        new Promise((resolve) => {
          resolveCapture = resolve;
        })
        );
      },
    );
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.result.current.start();
    });
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    act(() => result.result.current.setEnabled(false));
    await act(async () => {
      resolveCapture({ stop: vi.fn(), cancel, released: Promise.resolve() });
      await pending;
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result.result.current.enabled).toBe(false);
    expect(result.result.current.phase).toBe("idle");
  });

  it("coalesces same-tick starts and kept-file writes", async () => {
    let resolveCapture!: (capture: {
      stop(): void;
      cancel(): void;
      released: Promise<void>;
    }) => void;
    captureFactory = vi.fn(
      (onFinished) => {
        finish = onFinished;
        return new Promise((resolve) => {
          resolveCapture = resolve;
        });
      },
    );
    let resolveSave!: (value: Awaited<ReturnType<RepReplayApi["save"]>>) => void;
    vi.mocked(api.save).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    let firstStart!: Promise<void>;
    act(() => {
      firstStart = result.result.current.start();
      void result.result.current.start();
    });
    await waitFor(() => expect(captureFactory).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveCapture({
        stop: vi.fn(),
        cancel: vi.fn(),
        released: Promise.resolve(),
      });
      await firstStart;
    });
    act(() =>
      finish?.({
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
        durationMs: 1_200,
      }),
    );
    act(() => {
      result.result.current.markReviewed();
      result.result.current.setKeep(true);
    });
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = result.result.current.commitAfterVerdict(77);
      void result.result.current.commitAfterVerdict(77);
      void result.result.current.retryKeep();
    });
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveSave({
        id: 10,
        rep_block_id: 9,
        attempt_id: 77,
        mime_type: "audio/webm",
        duration_ms: 1_200,
        byte_len: 3,
        verdict: "clean",
        created_at: "2026-08-27T10:00:00Z",
      });
      await firstSave;
    });
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("retains the exact attempt identity when a kept-file write is retried", async () => {
    vi.mocked(api.save)
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockResolvedValueOnce({
        id: 12,
        rep_block_id: 9,
        attempt_id: 88,
        mime_type: "audio/webm",
        duration_ms: 1_200,
        byte_len: 3,
        verdict: "flawed",
        created_at: "2026-08-27T10:00:00Z",
      });
    const result = renderHook(() =>
      useRepReplay({ repBlockId: 9, api, captureFactory }),
    );
    act(() => result.result.current.setEnabled(true));
    await recordTake(result);
    act(() => {
      result.result.current.markReviewed();
      result.result.current.setKeep(true);
    });
    await act(async () => result.result.current.commitAfterVerdict(88));
    expect(result.result.current.verdictCommitted).toBe(true);
    await act(async () => result.result.current.retryKeep());
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.save).mock.calls[1][0].attempt_id).toBe(88);
  });
});
