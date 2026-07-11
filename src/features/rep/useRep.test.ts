import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface exactly as useMetronome.test.ts does: `invoke`
// (commands) and `listen` (the `rep://state` event bus). The listen mock
// captures the handler so a test can push authoritative snapshots.
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

import { useRep, type RepSnapshot, type RepOpenArgs } from "./useRep";

function makeSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
  return {
    block_id: 1,
    piece_id: 7,
    piece_title: "Gymnopédie No. 1",
    m_start: 1,
    m_end: 8,
    label: null,
    bpm: 60,
    start_bpm: 60,
    target_bpm: 84,
    planned_reps: 30,
    reps_done: 0,
    cleans_at_step: 0,
    rule: { clean_needed: 3, bpm_step: 4 },
    variant: null,
    variants: [],
    verdicts: { clean: 0, flawed: 0, failed: 0 },
    last: null,
    status: "active",
    ...over,
  };
}

function emit(snap: RepSnapshot | null) {
  act(() => {
    listeners["rep://state"]?.({ payload: snap });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

describe("useRep — IPC wiring", () => {
  it("subscribes to rep://state and fetches rep_state once on mount", async () => {
    invokeMock.mockResolvedValueOnce(makeSnap({ reps_done: 2 }));
    const { result } = renderHook(() => useRep());

    await waitFor(() => expect(result.current.snap?.reps_done).toBe(2));
    expect(invokeMock).toHaveBeenCalledWith("rep_state");
    expect(listenMock).toHaveBeenCalledWith("rep://state", expect.any(Function));
  });

  it("updates snapshot state when a rep://state event arrives", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(makeSnap({ reps_done: 5, bpm: 72, piece_title: "Clair de Lune" }));

    expect(result.current.snap?.reps_done).toBe(5);
    expect(result.current.snap?.bpm).toBe(72);
    expect(result.current.snap?.piece_title).toBe("Clair de Lune");
  });

  it("hides the block (snap null) when a null rep://state event arrives", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(makeSnap({ reps_done: 3 }));
    expect(result.current.snap).not.toBeNull();

    emit(null);
    expect(result.current.snap).toBeNull();
    expect(result.current.feed).toEqual([]);
  });

  it("check() invokes rep_check with the verdict and note", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.check("clean", "left hand solid");
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_check", {
      verdict: "clean",
      note: "left hand solid",
    });
  });

  it("check() sends note: null when omitted", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.check("failed");
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_check", {
      verdict: "failed",
      note: null,
    });
  });

  it("open() invokes rep_open with the args bag and applies the returned snapshot", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 1,
      m_end: 8,
      label: null,
      start_bpm: 60,
      target_bpm: 84,
      planned_reps: null,
      increment: null,
      variants: [{ name: "hands separate", reps: 5 }],
    };
    invokeMock.mockResolvedValueOnce(makeSnap({ block_id: 42, reps_done: 0 }));

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_open", { args });
    expect(result.current.snap?.block_id).toBe(42);
  });

  it("close() invokes rep_close and applies the (null) result", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    emit(makeSnap({ reps_done: 4 }));

    invokeMock.mockResolvedValueOnce(null);
    await act(async () => {
      await result.current.close();
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_close");
    expect(result.current.snap).toBeNull();
  });

  it("builds a newest-first verdict feed (max 5) as reps_done advances", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(makeSnap({ reps_done: 0 }));
    expect(result.current.feed).toEqual([]);

    emit(makeSnap({ reps_done: 1, last: { verdict: "clean", note: null, bpm: 60 } }));
    emit(makeSnap({ reps_done: 2, last: { verdict: "flawed", note: "rushed", bpm: 60 } }));

    expect(result.current.feed.map((f) => f.verdict)).toEqual(["flawed", "clean"]);
    expect(result.current.feed[0].note).toBe("rushed");
  });

  it("resets the feed when a new block opens", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(makeSnap({ block_id: 1, reps_done: 1, last: { verdict: "clean", note: null, bpm: 60 } }));
    expect(result.current.feed).toHaveLength(1);

    emit(makeSnap({ block_id: 2, reps_done: 0, last: null }));
    expect(result.current.feed).toEqual([]);
  });

  it("surfaces a command rejection as an inline error", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    invokeMock.mockRejectedValueOnce("no active block");
    await act(async () => {
      await result.current.check("clean");
    });

    await waitFor(() => expect(result.current.error).toContain("no active block"));
  });

  it("unsubscribes from the event on unmount", async () => {
    const { unmount } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    unmount();

    expect(unlistenMock).toHaveBeenCalled();
  });
});
