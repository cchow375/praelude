import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  renderHook,
  act,
  screen,
  within,
  waitFor,
} from "@testing-library/react";

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

import {
  useRep,
  type CheckOutcome,
  type RepSnapshot,
  type RepOpenArgs,
} from "./useRep";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

function receiptWrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

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
    focus: "tempo",
    use_metronome: true,
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

afterEach(cleanup);

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

  it("publishes one visible committed receipt for a saved attempt", async () => {
    const committed = makeSnap({
      reps_done: 1,
      verdicts: { clean: 1, flawed: 0, failed: 0 },
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    invokeMock.mockImplementation((command: string) => Promise.resolve(
      command === "rep_check"
        ? { snap: committed, new_bpm: null, block_done: false, say: "One." }
        : command === "rep_state"
          ? makeSnap()
          : null,
    ));
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.snap?.reps_done).toBe(0));

    await act(async () => {
      await result.current.check("clean");
    });

    expect(result.current.snap?.reps_done).toBe(1);
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getAllByText("Attempt 1 saved — clean.")).toHaveLength(1);

    // A matching authoritative event must reconcile without a second toast.
    emit(committed);
    expect(within(activity).getAllByText("Attempt 1 saved — clean.")).toHaveLength(1);
  });

  it("does not resurrect a closed block when an older check response arrives late", async () => {
    const committed = makeSnap({
      reps_done: 1,
      verdicts: { clean: 1, flawed: 0, failed: 0 },
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    let resolveCheck: (outcome: CheckOutcome) => void = () => undefined;
    const delayedCheck = new Promise<CheckOutcome>((resolve) => {
      resolveCheck = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(makeSnap());
      if (command === "rep_check") return delayedCheck;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    let checkPromise!: Promise<void>;
    act(() => {
      checkPromise = result.current.check("clean");
    });
    emit(null);
    expect(result.current.snap).toBeNull();

    await act(async () => {
      resolveCheck({ snap: committed, new_bpm: 64, block_done: false, say: "One." });
      await checkPromise;
    });

    expect(result.current.snap).toBeNull();
    expect(screen.getByRole("list", { name: "Recent app activity" }).textContent).toContain(
      "Attempt 1 saved — clean.",
    );
    expect(invokeMock).not.toHaveBeenCalledWith("metro_set", { bpm: 64 });
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
      focus: "tempo",
      use_metronome: true,
    };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_open"
          ? makeSnap({ block_id: 42, reps_done: 0 })
          : null,
      ),
    );

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_open", { args });
    expect(invokeMock).toHaveBeenCalledWith("metro_start", { bpm: 60 });
    expect(result.current.snap?.block_id).toBe(42);
  });

  it("rejects a first-open failure and publishes an assertive receipt while no HUD exists", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 1,
      m_end: 8,
      label: null,
      start_bpm: 60,
      target_bpm: 84,
      planned_reps: null,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    };
    invokeMock.mockImplementation((command: string) => (
      command === "rep_open"
        ? Promise.reject({
            code: "open_failed",
            message: "The practice database is busy.",
          })
        : Promise.resolve(null)
    ));
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await expect(result.current.open(args)).rejects.toMatchObject({
        name: "CommandError",
        command: "rep_open",
        code: "open_failed",
      });
    });

    expect(result.current.snap).toBeNull();
    expect(result.current.error).toBe("The practice database is busy.");
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toBe("The practice database is busy.");
  });

  it("keeps a successfully opened block and reports a later metronome failure", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 9,
      m_end: 16,
      label: null,
      start_bpm: 72,
      target_bpm: 88,
      planned_reps: null,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_open") {
        return Promise.resolve(makeSnap({ block_id: 44, m_start: 9, m_end: 16, bpm: 72 }));
      }
      if (command === "metro_start") {
        return Promise.reject({
          code: "audio_busy",
          message: "The metronome is busy with speech.",
        });
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await expect(result.current.open(args)).resolves.toBeUndefined();
    });

    expect(result.current.snap?.block_id).toBe(44);
    expect(result.current.error).toBe("The metronome is busy with speech.");
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText(
      "Practice block opened for measures 9–16.",
    )).toBeTruthy();
    expect(within(activity).getByText(
      "The metronome is busy with speech.",
    )).toBeTruthy();
  });

  it("does not restart the metronome or resurrect a block closed before open resolves", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 9,
      m_end: 16,
      label: null,
      start_bpm: 72,
      target_bpm: 88,
      planned_reps: null,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    };
    const opened = makeSnap({ block_id: 44, m_start: 9, m_end: 16, bpm: 72 });
    let resolveOpen: (snapshot: RepSnapshot) => void = () => undefined;
    const delayedOpen = new Promise<RepSnapshot>((resolve) => {
      resolveOpen = resolve;
    });
    invokeMock.mockImplementation((command: string) => (
      command === "rep_open" ? delayedOpen : Promise.resolve(null)
    ));
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.open(args);
    });
    emit(opened);
    emit(null);
    await act(async () => {
      resolveOpen(opened);
      await openPromise;
    });

    expect(result.current.snap).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("metro_start", expect.anything());
  });

  it("applies a ladder step to the metronome only when the block opted in", async () => {
    const stepped = makeSnap({ bpm: 64, use_metronome: true });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_check"
          ? { snap: stepped, new_bpm: 64, block_done: false, say: "64" }
          : command === "rep_state"
            ? makeSnap({ use_metronome: true })
            : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));
    await act(async () => { await result.current.check("clean"); });
    expect(invokeMock).toHaveBeenCalledWith("metro_set", { bpm: 64 });
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
