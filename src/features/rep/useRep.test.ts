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
import type { MetroState } from "../metronome/useMetronome";
import { beginMetroIntent } from "../metronome/intentGuard";

function receiptWrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function makeSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
  const attempts = over.attempts_recorded ?? over.reps_done ?? 0;
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
    attempts_recorded: attempts,
    tries: over.tries ?? attempts,
    voided_attempts: 0,
    current_clean_streak: 0,
    best_clean_streak: 0,
    reset_count: 0,
    accuracy: attempts === 0 ? null : 0,
    required_clean_streak: 5,
    effective_required_clean_streak: 5,
    recovery_remaining: 0,
    mastery_status: "not_satisfied",
    mastery_verified: true,
    set_state: "active",
    last_attempt_id: attempts > 0 ? attempts : null,
    last_adjustment_id: null,
    ...over,
  };
}

function emit(snap: RepSnapshot | null) {
  act(() => {
    listeners["rep://state"]?.({ payload: snap });
  });
}

function makeMetro(over: Partial<MetroState> = {}): MetroState {
  return {
    running: false,
    owner: null,
    bpm: 120,
    beats_per_bar: 4,
    subdivision: 1,
    accent_first: true,
    sound: "woodblock",
    gain: 1,
    boost: false,
    ...over,
  };
}

function emitMetro(state: MetroState) {
  act(() => {
    listeners["metro://state"]?.({ payload: state });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    Promise.resolve(command === "metro_state" ? makeMetro() : null),
  );
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
    expect(listenMock).toHaveBeenCalledWith(
      "rep://state",
      expect.any(Function),
    );
  });

  it("surfaces a real active-set restore failure inline and in the global receipt center", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") {
        return Promise.reject({
          code: "multiple_live_sets",
          message: "Multiple live practice sets require recovery.",
        });
      }
      if (command === "metro_state") return Promise.resolve(makeMetro());
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Multiple live practice sets require recovery.",
      ),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Multiple live practice sets require recovery.",
    );
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain("Multiple live practice sets require recovery.");
  });

  it("updates snapshot state when a rep://state event arrives", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

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
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_check"
          ? {
              snap: makeSnap({ attempts_recorded: 1 }),
              new_bpm: null,
              block_done: false,
              say: "Saved.",
            }
          : command === "metro_state"
            ? makeMetro()
            : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.check("clean", "left hand solid");
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_check", {
      verdict: "clean",
      note: "left hand solid",
      commandId: expect.stringMatching(/^ui:rep-check/),
    });
  });

  it("check() sends note: null when omitted", async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_check"
          ? {
              snap: makeSnap({ attempts_recorded: 1 }),
              new_bpm: null,
              block_done: false,
              say: "Saved.",
            }
          : command === "metro_state"
            ? makeMetro()
            : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.check("failed");
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_check", {
      verdict: "failed",
      note: null,
      commandId: expect.stringMatching(/^ui:rep-check/),
    });
  });

  it("reuses one durable command id when an uncertain attempt write is retried", async () => {
    const committed = makeSnap({
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 801,
      last: { verdict: "clean", note: "same evidence", bpm: 60 },
    });
    let checks = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(makeSnap());
      if (command === "metro_state") return Promise.resolve(makeMetro());
      if (command === "rep_check") {
        checks += 1;
        if (checks === 1)
          return Promise.reject({
            code: "transport_lost",
            message: "Reply lost.",
          });
        return Promise.resolve({
          snap: committed,
          new_bpm: null,
          block_done: false,
          say: "Saved.",
        });
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await expect(
        result.current.check("clean", "same evidence"),
      ).rejects.toMatchObject({
        code: "transport_lost",
      });
    });
    await act(async () => {
      await result.current.check("clean", "same evidence");
    });

    const calls = invokeMock.mock.calls.filter(
      ([command]) => command === "rep_check",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1].commandId).toBe(calls[1][1].commandId);
  });

  it("applies a committed pause receipt and exposes its durable identity", async () => {
    const active = makeSnap({ timer_state: "active", active_seconds: 11 });
    const paused = makeSnap({
      timer_state: "paused",
      set_state: "paused",
      active_seconds: 18,
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(active);
      if (command === "metro_state") return Promise.resolve(makeMetro());
      if (command === "rep_pause")
        return Promise.resolve({
          receipt_id: "receipt:pause:1",
          command_id: "native:pause:1",
          status: "committed",
          summary: "Practice paused at 18 seconds.",
          value: paused,
          entity_refs: [{ entity_type: "set", entity_id: 1 }],
          event_ids: [91],
          undo_action: null,
          error_code: null,
          error_detail: null,
          replayed: false,
          committed_ts: "2026-07-15T20:00:00Z",
        });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.timer_state).toBe("active"),
    );

    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.snap?.timer_state).toBe("paused");
    expect(invokeMock).toHaveBeenCalledWith("rep_pause", {
      commandId: expect.stringMatching(/^ui:rep-pause/),
    });
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_pause", {
      setId: 1,
    });
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    const item = within(activity)
      .getByText("Practice paused at 18 seconds.")
      .closest("li");
    expect(item?.getAttribute("data-receipt-id")).toBe("receipt:pause:1");
  });

  it("resumes only the matching practice click with the set's stored tuning", async () => {
    const paused = makeSnap({
      timer_state: "paused",
      set_state: "paused",
      bpm: 72,
      tuning: {
        beat_unit: "eighth",
        subdivision: 2,
        beats_per_bar: 3,
      },
    });
    const resumed = makeSnap({
      timer_state: "active",
      set_state: "active",
      bpm: 72,
      tuning: {
        beat_unit: "eighth",
        subdivision: 2,
        beats_per_bar: 3,
      },
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(paused);
      if (command === "metro_state") {
        return Promise.resolve(
          makeMetro({
            running: false,
            owner: { kind: "practice", set_id: 1 },
            bpm: 72,
          }),
        );
      }
      if (command === "rep_resume")
        return Promise.resolve({
          receipt_id: "receipt:resume:1",
          command_id: "native:resume:1",
          status: "committed",
          summary: "Practice resumed.",
          value: resumed,
          entity_refs: [{ entity_type: "set", entity_id: 1 }],
          event_ids: [92],
          undo_action: null,
          error_code: null,
          error_detail: null,
          replayed: false,
          committed_ts: "2026-07-15T20:00:10Z",
        });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.timer_state).toBe("paused"),
    );

    await act(async () => {
      await result.current.resume();
    });

    expect(result.current.snap?.timer_state).toBe("active");
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_resume", {
      setId: 1,
      bpm: 72,
      beatsPerBar: 3,
      subdivision: 2,
    });
  });

  it("resumeSet targets one paused id and adopts its returned snapshot", async () => {
    const current = makeSnap({
      block_id: 1,
      timer_state: "paused",
      set_state: "paused",
    });
    const targeted = makeSnap({
      block_id: 42,
      m_start: 44,
      m_end: 46,
      timer_state: "active",
      set_state: "active",
      bpm: 68,
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(current);
      if (command === "metro_state") return Promise.resolve(makeMetro());
      if (command === "rep_resume") {
        return Promise.resolve({
          receipt_id: "receipt:resume:42",
          command_id: "native:resume:42",
          status: "committed",
          summary: "Practice resumed.",
          value: targeted,
          entity_refs: [{ entity_type: "set", entity_id: 42 }],
          event_ids: [142],
          undo_action: null,
          error_code: null,
          error_detail: null,
          replayed: false,
          committed_ts: "2026-08-27T00:00:00Z",
        });
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await result.current.resumeSet(42);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_resume", {
      commandId: expect.stringMatching(/^ui:rep-resume-42/),
      setId: 42,
    });
    expect(result.current.snap?.block_id).toBe(42);
    expect(result.current.snap?.timer_state).toBe("active");
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_resume", {
      setId: 42,
      bpm: 68,
      beatsPerBar: undefined,
      subdivision: undefined,
    });
  });

  it("keeps the live set unchanged when a receipt rejects a recovery choice", async () => {
    const active = makeSnap({ timer_state: "active", recovery_actions: [] });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(active);
      if (command === "metro_state") return Promise.resolve(makeMetro());
      if (command === "rep_recovery")
        return Promise.resolve({
          receipt_id: "rejected:recovery",
          command_id: "native:recovery",
          status: "rejected",
          summary: "Narrow range is outside the target.",
          value: null,
          entity_refs: [],
          event_ids: [],
          error_code: "practice_rejected",
          error_detail: "Narrow range is outside the target.",
          replayed: false,
          committed_ts: null,
        });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await expect(
        result.current.recover({
          kind: "narrow_target",
          m_start: 99,
          m_end: 100,
          rationale: "Isolate the miss.",
        }),
      ).rejects.toThrow("Narrow range is outside the target.");
    });

    expect(result.current.snap?.recovery_actions).toEqual([]);
    expect(result.current.error).toBe("Narrow range is outside the target.");
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain("Narrow range is outside the target.");
  });

  it("null-guards a receiptless response (e.g. an unhandled mock/backend command) with one clear error, not a crash (fix wave item 8)", async () => {
    const active = makeSnap({ timer_state: "active", active_seconds: 5 });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(active);
      if (command === "metro_state") return Promise.resolve(makeMetro());
      // No `rep_checkpoint` handler at all — resolves `null`, exactly like
      // the pre-fix devMock's `default: return null` fallthrough.
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.timer_state).toBe("active"),
    );

    await act(async () => {
      await expect(result.current.checkpoint()).rejects.toThrow(
        "Focused time could not be checkpointed.",
      );
    });

    expect(result.current.error).toBe(
      "Focused time could not be checkpointed.",
    );
    // The set itself is untouched (a checkpoint failure is not a crash), and
    // — unlike a generic thrown error — this specific null-receipt guard
    // never reaches `receipts.error`, so no toast piles into the activity
    // feed. A regression back to the raw `receipt.status` property access
    // would instead throw a TypeError, get caught by the generic handler,
    // and stack a fresh toast on every 15s checkpoint tick.
    expect(result.current.snap?.active_seconds).toBe(5);
    expect(
      screen.queryByRole("list", { name: "Recent app activity" }),
    ).toBeNull();
  });

  it("publishes one visible committed receipt for a saved attempt", async () => {
    const committed = makeSnap({
      reps_done: 1,
      verdicts: { clean: 1, flawed: 0, failed: 0 },
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_check"
          ? { snap: committed, new_bpm: null, block_done: false, say: "One." }
          : command === "rep_state"
            ? makeSnap()
            : null,
      ),
    );
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.snap?.reps_done).toBe(0));

    await act(async () => {
      await result.current.check("clean");
    });

    expect(result.current.snap?.reps_done).toBe(1);
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(
      within(activity).getAllByText("Attempt 1 saved — clean."),
    ).toHaveLength(1);

    // A matching authoritative event must reconcile without a second toast.
    emit(committed);
    expect(
      within(activity).getAllByText("Attempt 1 saved — clean."),
    ).toHaveLength(1);
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
      resolveCheck({
        snap: committed,
        new_bpm: 64,
        block_done: false,
        say: "One.",
      });
      await checkPromise;
    });

    expect(result.current.snap).toBeNull();
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain("Attempt 1 saved — clean.");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
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
          : command === "metro_state"
            ? makeMetro()
            : null,
      ),
    );

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_open", {
      args,
      context: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_start", {
      setId: 42,
      bpm: 60,
    });
    expect(result.current.snap?.block_id).toBe(42);
  });

  it("live-retunes an already-running metronome when a set opens at another tempo", async () => {
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
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_open"
          ? makeSnap({ block_id: 42, bpm: 60 })
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 96 })
            : null,
      ),
    );

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());
    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 42,
      bpm: 60,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );
  });

  it("does not restart an already-running metronome at the opened set tempo", async () => {
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
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_open"
          ? makeSnap({ block_id: 42, bpm: 60 })
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 60 })
            : null,
      ),
    );

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());
    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );
  });

  it("retunes an already-running same-BPM metronome when the opened set has different tuning", async () => {
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
      tuning: {
        beat_unit: "eighth",
        subdivision: 2,
        beats_per_bar: 3,
      },
    };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_open"
          ? makeSnap({
              block_id: 42,
              bpm: 60,
              tuning: {
                beat_unit: "eighth",
                subdivision: 2,
                beats_per_bar: 3,
              },
            })
          : command === "metro_state"
            ? makeMetro({
                running: true,
                bpm: 60,
                beats_per_bar: 4,
                subdivision: 1,
              })
            : null,
      ),
    );

    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());
    await act(async () => {
      await result.current.open(args);
    });

    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 42,
      bpm: 60,
      beatsPerBar: 3,
      subdivision: 2,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );
  });

  it("starts an opened set after a delayed initial metronome read without delaying the set commit", async () => {
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
    const opened = makeSnap({ block_id: 42, bpm: 60 });
    let resolveMetroState: (state: MetroState) => void = () => undefined;
    const delayedMetroState = new Promise<MetroState>((resolve) => {
      resolveMetroState = resolve;
    });
    invokeMock.mockImplementation((command: string) =>
      command === "rep_open"
        ? Promise.resolve(opened)
        : command === "metro_state"
          ? delayedMetroState
          : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.open(args);
    });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(42));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );

    await act(async () => {
      resolveMetroState(makeMetro({ running: false, bpm: 60 }));
      await openPromise;
    });
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_start", {
      setId: 42,
      bpm: 60,
    });
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
    invokeMock.mockImplementation((command: string) =>
      command === "rep_open"
        ? Promise.reject({
            code: "open_failed",
            message: "The practice database is busy.",
          })
        : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

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
      if (command === "metro_state") return Promise.resolve(makeMetro());
      if (command === "rep_open") {
        return Promise.resolve(
          makeSnap({ block_id: 44, m_start: 9, m_end: 16, bpm: 72 }),
        );
      }
      if (command === "metro_practice_start") {
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
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    await act(async () => {
      await expect(result.current.open(args)).resolves.toBeUndefined();
    });

    expect(result.current.snap?.block_id).toBe(44);
    expect(result.current.error).toBe("The metronome is busy with speech.");
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(
      within(activity).getByText("Practice set opened for measures 9–16."),
    ).toBeTruthy();
    expect(
      within(activity).getByText("The metronome is busy with speech."),
    ).toBeTruthy();
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
    invokeMock.mockImplementation((command: string) =>
      command === "rep_open"
        ? delayedOpen
        : Promise.resolve(command === "metro_state" ? makeMetro() : null),
    );
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
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );
  });

  it("never overwrites a same-block voice attempt with a delayed zero-attempt open return", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 9,
      m_end: 16,
      label: null,
      start_bpm: 60,
      target_bpm: 84,
      planned_reps: null,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    };
    const returnedOpen = makeSnap({
      block_id: 44,
      m_start: 9,
      m_end: 16,
      attempts_recorded: 0,
      tries: 0,
      reps_done: 0,
      last: null,
      last_attempt_id: null,
    });
    const voiceAttempt = makeSnap({
      ...returnedOpen,
      bpm: 64,
      attempts_recorded: 1,
      tries: 1,
      reps_done: 1,
      verdicts: { clean: 1, flawed: 0, failed: 0 },
      last: { verdict: "clean", note: "voice attempt", bpm: null },
      last_attempt_id: 801,
    });
    let resolveOpen: (snapshot: RepSnapshot) => void = () => undefined;
    const delayedOpen = new Promise<RepSnapshot>((resolve) => {
      resolveOpen = resolve;
    });
    invokeMock.mockImplementation((command: string) =>
      command === "rep_open"
        ? delayedOpen
        : Promise.resolve(command === "metro_state" ? makeMetro() : null),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.open(args);
    });
    emit(voiceAttempt);
    await act(async () => {
      resolveOpen(returnedOpen);
      await openPromise;
    });

    expect(result.current.snap?.block_id).toBe(44);
    expect(result.current.snap?.tries).toBe(1);
    expect(result.current.snap?.last?.note).toBe("voice attempt");
    expect(result.current.feed[0]?.verdict).toBe("clean");
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_start", {
      setId: 44,
      bpm: 64,
    });
  });

  it("does not let a delayed open overwrite a newer manual metronome event", async () => {
    const args: RepOpenArgs = {
      piece_id: 7,
      m_start: 9,
      m_end: 16,
      label: null,
      start_bpm: 60,
      target_bpm: 84,
      planned_reps: null,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    };
    const opened = makeSnap({ block_id: 44, bpm: 60, set_state: "active" });
    let resolveOpen: (snapshot: RepSnapshot) => void = () => undefined;
    const delayedOpen = new Promise<RepSnapshot>((resolve) => {
      resolveOpen = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_open") return delayedOpen;
      if (command === "metro_state")
        return Promise.resolve(makeMetro({ running: false, bpm: 60 }));
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.open(args);
    });
    emit(opened);
    emitMetro(makeMetro({ running: true, bpm: 96 }));
    await act(async () => {
      resolveOpen(opened);
      await openPromise;
    });

    expect(result.current.snap?.block_id).toBe(44);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_start",
      expect.anything(),
    );
  });

  it("applies a ladder step to the metronome only when the block opted in", async () => {
    const stepped = makeSnap({ bpm: 64, use_metronome: true });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_check"
          ? { snap: stepped, new_bpm: 64, block_done: false, say: "64" }
          : command === "rep_state"
            ? makeSnap({ use_metronome: true })
            : command === "metro_state"
              ? makeMetro({ running: true, bpm: 60 })
              : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));
    await act(async () => {
      await result.current.check("clean");
    });
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 1,
      bpm: 64,
    });
  });

  it("retunes after a delayed initial metronome read without delaying the committed attempt", async () => {
    const initial = makeSnap({ bpm: 60, last_attempt_id: null, tries: 0 });
    const stepped = makeSnap({
      bpm: 64,
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 83,
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    let resolveMetroState: (state: MetroState) => void = () => undefined;
    const delayedMetroState = new Promise<MetroState>((resolve) => {
      resolveMetroState = resolve;
    });
    invokeMock.mockImplementation((command: string) =>
      command === "rep_state"
        ? Promise.resolve(initial)
        : command === "metro_state"
          ? delayedMetroState
          : command === "rep_check"
            ? Promise.resolve({
                snap: stepped,
                new_bpm: 64,
                block_done: false,
                say: "64",
              })
            : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    let checkPromise!: Promise<void>;
    act(() => {
      checkPromise = result.current.check("clean");
    });
    await waitFor(() => expect(result.current.snap?.bpm).toBe(64));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );

    await act(async () => {
      resolveMetroState(makeMetro({ running: true, bpm: 60 }));
      await checkPromise;
    });
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 1,
      bpm: 64,
    });
  });

  it("does not retune a delayed check after a newer manual metronome event", async () => {
    const initial = makeSnap({ bpm: 60, last_attempt_id: null, tries: 0 });
    const stepped = makeSnap({
      bpm: 64,
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 81,
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    let resolveCheck: (outcome: CheckOutcome) => void = () => undefined;
    const pending = new Promise<CheckOutcome>((resolve) => {
      resolveCheck = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(initial);
      if (command === "metro_state")
        return Promise.resolve(makeMetro({ running: true, bpm: 60 }));
      if (command === "rep_check") return pending;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));
    await waitFor(() => expect(listeners["metro://state"]).toBeDefined());

    let checkPromise!: Promise<void>;
    act(() => {
      checkPromise = result.current.check("clean");
    });
    emit(stepped);
    emitMetro(makeMetro({ running: true, bpm: 96 }));
    await act(async () => {
      resolveCheck({
        snap: stepped,
        new_bpm: 64,
        block_done: false,
        say: "64",
      });
      await checkPromise;
    });

    expect(result.current.snap?.bpm).toBe(64);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
  });

  it("does not retune while a manual metronome command is pending before its event", async () => {
    const initial = makeSnap({ bpm: 60, last_attempt_id: null, tries: 0 });
    const stepped = makeSnap({
      bpm: 64,
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 82,
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 60 })
            : command === "rep_check"
              ? { snap: stepped, new_bpm: 64, block_done: false, say: "64" }
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    const finishManualIntent = beginMetroIntent();
    try {
      await act(async () => {
        await result.current.check("clean");
      });
    } finally {
      finishManualIntent();
    }

    expect(result.current.snap?.bpm).toBe(64);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
  });

  it("does not auto-retune when the authoritative metronome is stopped", async () => {
    const initial = makeSnap({ bpm: 60 });
    const stepped = makeSnap({ bpm: 64 });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: false, bpm: 60 })
            : command === "rep_check"
              ? { snap: stepped, new_bpm: 64, block_done: false, say: "64" }
              : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await result.current.check("clean");
    });

    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
  });

  it("undoes the latest attempt through an append-only command and receipts its ordinal", async () => {
    const initial = makeSnap({
      reps_done: 3,
      attempts_recorded: 3,
      tries: 3,
      current_clean_streak: 2,
      last_attempt_id: 91,
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    const undone = makeSnap({
      reps_done: 3,
      attempts_recorded: 3,
      tries: 2,
      voided_attempts: 1,
      current_clean_streak: 1,
      last_attempt_id: 90,
      last_adjustment_id: 8,
      last: { verdict: "clean", note: null, bpm: 60 },
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 64 })
            : command === "rep_undo"
              ? {
                  snap: undone,
                  new_bpm: null,
                  block_done: false,
                  say: "Undone.",
                }
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.attempts_recorded).toBe(3));

    await act(async () => {
      await result.current.undo();
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_undo");
    expect(result.current.snap?.attempts_recorded).toBe(3);
    expect(result.current.snap?.tries).toBe(2);
    expect(result.current.snap?.voided_attempts).toBe(1);
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain("Attempt 3 undone.");
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).not.toContain("Attempt 91");
  });

  it("retunes after undo only when the returned projection is still the active metronome set", async () => {
    const initial = makeSnap({
      bpm: 64,
      attempts_recorded: 3,
      tries: 3,
      last_attempt_id: 91,
      last_adjustment_id: null,
    });
    const undone = makeSnap({
      bpm: 60,
      attempts_recorded: 3,
      tries: 2,
      voided_attempts: 1,
      last_attempt_id: 90,
      last_adjustment_id: 8,
      set_state: "active",
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 64 })
            : command === "rep_undo"
              ? { snap: undone, new_bpm: 60, block_done: false, say: "Undone." }
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.bpm).toBe(64));

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.snap?.bpm).toBe(60);
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 1,
      bpm: 60,
    });
  });

  it("corrects the latest attempt with top-level typed args and no optimistic write", async () => {
    const initial = makeSnap({
      reps_done: 2,
      attempts_recorded: 2,
      tries: 2,
      current_clean_streak: 0,
      last_attempt_id: 77,
      last: { verdict: "failed", note: "wrong note", bpm: 60 },
    });
    const corrected = makeSnap({
      reps_done: 2,
      attempts_recorded: 2,
      tries: 2,
      current_clean_streak: 1,
      last_attempt_id: 77,
      last_adjustment_id: 12,
      last: { verdict: "clean", note: "misheard", bpm: 60 },
    });
    let resolveCorrection: (outcome: CheckOutcome) => void = () => undefined;
    const pending = new Promise<CheckOutcome>((resolve) => {
      resolveCorrection = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(initial);
      if (command === "rep_correct") return pending;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.last?.verdict).toBe("failed"),
    );

    let correction!: Promise<void>;
    act(() => {
      correction = result.current.correct(77, "clean", "misheard");
    });
    expect(result.current.snap?.last?.verdict).toBe("failed");
    await act(async () => {
      resolveCorrection({
        snap: corrected,
        new_bpm: null,
        block_done: false,
        say: "Corrected.",
      });
      await correction;
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_correct", {
      attemptId: 77,
      verdict: "clean",
      note: "misheard",
      replaceNote: true,
    });
    expect(result.current.snap?.last?.verdict).toBe("clean");
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain("Latest attempt corrected — clean.");
  });

  it("preserves the existing note for a verdict-only correction", async () => {
    const initial = makeSnap({
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 77,
      last: { verdict: "failed", note: "keep this", bpm: 60 },
    });
    const corrected = makeSnap({
      attempts_recorded: 1,
      tries: 1,
      last_attempt_id: 77,
      last_adjustment_id: 12,
      last: { verdict: "clean", note: "keep this", bpm: 60 },
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "rep_correct"
            ? {
                snap: corrected,
                new_bpm: null,
                block_done: false,
                say: "Corrected.",
              }
            : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.last?.note).toBe("keep this"),
    );

    await act(async () => {
      await result.current.correct(77, "clean");
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_correct", {
      attemptId: 77,
      verdict: "clean",
      note: null,
      replaceNote: false,
    });
    expect(result.current.snap?.last?.note).toBe("keep this");
  });

  it("reverses the latest adjustment and retunes its still-current active projection", async () => {
    const initial = makeSnap({
      bpm: 64,
      attempts_recorded: 2,
      tries: 2,
      last_attempt_id: 77,
      last_adjustment_id: 12,
    });
    const reversed = makeSnap({
      bpm: 60,
      attempts_recorded: 2,
      tries: 2,
      last_attempt_id: 77,
      last_adjustment_id: 13,
      set_state: "active",
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 64 })
            : command === "rep_adjustment_reverse"
              ? {
                  snap: reversed,
                  new_bpm: 60,
                  block_done: false,
                  say: "Reversed.",
                }
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.last_adjustment_id).toBe(12),
    );

    await act(async () => {
      await result.current.reverseAdjustment(12);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_adjustment_reverse", {
      adjustmentId: 12,
    });
    expect(result.current.snap?.last_adjustment_id).toBe(13);
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_retune", {
      setId: 1,
      bpm: 60,
    });
  });

  it("never retunes from a stale reversal after the set is paused", async () => {
    const initial = makeSnap({
      bpm: 64,
      last_attempt_id: 77,
      last_adjustment_id: 12,
    });
    const reversed = makeSnap({
      bpm: 60,
      last_attempt_id: 77,
      last_adjustment_id: 13,
      set_state: "active",
    });
    let resolveReverse: (outcome: CheckOutcome) => void = () => undefined;
    const pending = new Promise<CheckOutcome>((resolve) => {
      resolveReverse = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(initial);
      if (command === "metro_state")
        return Promise.resolve(makeMetro({ running: true, bpm: 64 }));
      if (command === "rep_adjustment_reverse") return pending;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() =>
      expect(result.current.snap?.last_adjustment_id).toBe(12),
    );

    let reversal!: Promise<void>;
    act(() => {
      reversal = result.current.reverseAdjustment(12);
    });
    emit(
      makeSnap({
        bpm: 64,
        last_attempt_id: 77,
        last_adjustment_id: 12,
        set_state: "paused",
        status: "paused",
      }),
    );
    await act(async () => {
      resolveReverse({
        snap: reversed,
        new_bpm: 60,
        block_done: false,
        say: "Reversed.",
      });
      await reversal;
    });

    expect(result.current.snap?.set_state).toBe("paused");
    expect(result.current.snap?.bpm).toBe(64);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
  });

  it("restarts into the returned fresh set and preserves an explicit streak target", async () => {
    const initial = makeSnap({
      block_id: 1,
      bpm: 84,
      attempts_recorded: 6,
      tries: 6,
    });
    const restarted = makeSnap({
      block_id: 2,
      bpm: 60,
      start_bpm: 60,
      attempts_recorded: 0,
      tries: 0,
      current_clean_streak: 0,
      required_clean_streak: 7,
      effective_required_clean_streak: 7,
      set_state: "active",
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: true, bpm: 84 })
            : command === "rep_restart"
              ? restarted
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await result.current.restart(7);
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_restart", {
      requiredCleanStreak: 7,
    });
    expect(result.current.snap?.block_id).toBe(2);
    expect(result.current.snap?.current_clean_streak).toBe(0);
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_restart", {
      oldSetId: 1,
      newSetId: 2,
      bpm: 60,
    });
    expect(
      screen.getByRole("list", { name: "Recent app activity" }).textContent,
    ).toContain(
      "Practice set restarted. The previous attempts remain in history.",
    );
  });

  it("starts a stopped metronome for the fresh set after restart", async () => {
    const initial = makeSnap({
      block_id: 1,
      bpm: 84,
      attempts_recorded: 6,
      tries: 6,
    });
    const restarted = makeSnap({
      block_id: 2,
      bpm: 60,
      start_bpm: 60,
      attempts_recorded: 0,
      tries: 0,
      set_state: "active",
      use_metronome: true,
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "rep_state"
          ? initial
          : command === "metro_state"
            ? makeMetro({ running: false, bpm: 84 })
            : command === "rep_restart"
              ? restarted
              : null,
      ),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await result.current.restart();
    });

    expect(invokeMock).toHaveBeenCalledWith("metro_practice_restart", {
      oldSetId: 1,
      newSetId: 2,
      bpm: 60,
    });
  });

  it("keeps authoritative state when an older undo response arrives after a new-set event", async () => {
    const initial = makeSnap({ block_id: 1, attempts_recorded: 3, tries: 3 });
    let resolveUndo: (outcome: CheckOutcome) => void = () => undefined;
    const pending = new Promise<CheckOutcome>((resolve) => {
      resolveUndo = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "rep_state") return Promise.resolve(initial);
      if (command === "rep_undo") return pending;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));
    let undo!: Promise<void>;
    act(() => {
      undo = result.current.undo();
    });

    emit(makeSnap({ block_id: 2, attempts_recorded: 0, tries: 0 }));
    await act(async () => {
      resolveUndo({
        snap: makeSnap({ block_id: 1, attempts_recorded: 2, tries: 2 }),
        new_bpm: null,
        block_done: false,
        say: "Undone.",
      });
      await undo;
    });

    expect(result.current.snap?.block_id).toBe(2);
    expect(result.current.snap?.attempts_recorded).toBe(0);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "metro_practice_retune",
      expect.anything(),
    );
  });

  it("rejects failed adjustment commands without changing the visible snapshot", async () => {
    const initial = makeSnap({
      attempts_recorded: 2,
      tries: 2,
      current_clean_streak: 1,
    });
    invokeMock.mockImplementation((command: string) =>
      command === "rep_state"
        ? Promise.resolve(initial)
        : command === "rep_undo"
          ? Promise.reject({
              code: "ledger_conflict",
              message: "The attempt was already undone.",
            })
          : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.attempts_recorded).toBe(2));

    await act(async () => {
      await expect(result.current.undo()).rejects.toMatchObject({
        code: "ledger_conflict",
      });
    });

    expect(result.current.snap?.attempts_recorded).toBe(2);
    expect(result.current.snap?.current_clean_streak).toBe(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "The attempt was already undone.",
    );
  });

  it("close() clears the HUD without an event even though native returns the closed snapshot", async () => {
    const closed = makeSnap({
      reps_done: 4,
      attempts_recorded: 4,
      tries: 4,
      status: "closed",
      set_state: "closed_unresolved",
    });
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "metro_state"
          ? makeMetro()
          : command === "rep_close"
            ? closed
            : null,
      ),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    emit(makeSnap({ reps_done: 4 }));

    await act(async () => {
      await result.current.close();
    });

    expect(invokeMock).toHaveBeenCalledWith("rep_close");
    expect(invokeMock).toHaveBeenCalledWith("metro_practice_close", {
      setId: 1,
    });
    expect(result.current.snap).toBeNull();
  });

  it("close() rejects after reporting a native failure so auto-close can retry", async () => {
    const initial = makeSnap({ reps_done: 5, mastery_status: "satisfied" });
    const failure = {
      code: "storage_busy",
      message: "The practice database is briefly busy.",
    };
    invokeMock.mockImplementation((command: string) =>
      command === "rep_state"
        ? Promise.resolve(initial)
        : command === "metro_state"
          ? Promise.resolve(makeMetro())
          : command === "rep_close"
            ? Promise.reject(failure)
            : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(result.current.snap?.block_id).toBe(1));

    await act(async () => {
      await expect(result.current.close()).rejects.toMatchObject(failure);
    });

    expect(result.current.snap?.block_id).toBe(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "The practice database is briefly busy.",
    );
  });

  it("builds a newest-first verdict feed (max 5) as reps_done advances", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(makeSnap({ reps_done: 0 }));
    expect(result.current.feed).toEqual([]);

    emit(
      makeSnap({
        reps_done: 1,
        last: { verdict: "clean", note: null, bpm: 60 },
      }),
    );
    emit(
      makeSnap({
        reps_done: 2,
        last: { verdict: "flawed", note: "rushed", bpm: 60 },
      }),
    );

    expect(result.current.feed.map((f) => f.verdict)).toEqual([
      "flawed",
      "clean",
    ]);
    expect(result.current.feed[0].note).toBe("rushed");
  });

  it("resets the feed when a new block opens", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(
      makeSnap({
        block_id: 1,
        reps_done: 1,
        last: { verdict: "clean", note: null, bpm: 60 },
      }),
    );
    expect(result.current.feed).toHaveLength(1);

    emit(makeSnap({ block_id: 2, reps_done: 0, last: null }));
    expect(result.current.feed).toEqual([]);
  });

  it("collapses feed to the authoritative latest attempt after a non-latest correction", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(
      makeSnap({
        attempts_recorded: 1,
        tries: 1,
        last_attempt_id: 1,
        last: { verdict: "clean", note: "older", bpm: 60 },
      }),
    );
    emit(
      makeSnap({
        attempts_recorded: 2,
        tries: 2,
        last_attempt_id: 2,
        last: { verdict: "failed", note: "authoritative latest", bpm: 60 },
      }),
    );
    expect(result.current.feed.map((item) => item.note)).toEqual([
      "authoritative latest",
      "older",
    ]);

    emit(
      makeSnap({
        attempts_recorded: 2,
        tries: 2,
        last_attempt_id: 2,
        last_adjustment_id: 21,
        last: { verdict: "failed", note: "authoritative latest", bpm: 60 },
      }),
    );

    expect(result.current.feed).toEqual([
      { verdict: "failed", note: "authoritative latest", bpm: 60 },
    ]);
  });

  it("does not drop the latest feed item when a non-latest attempt is voided", async () => {
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    emit(
      makeSnap({
        attempts_recorded: 1,
        tries: 1,
        last_attempt_id: 1,
        last: { verdict: "flawed", note: "first", bpm: 60 },
      }),
    );
    emit(
      makeSnap({
        attempts_recorded: 2,
        tries: 2,
        last_attempt_id: 2,
        last: { verdict: "failed", note: "middle", bpm: 60 },
      }),
    );
    emit(
      makeSnap({
        attempts_recorded: 3,
        tries: 3,
        last_attempt_id: 3,
        last: { verdict: "clean", note: "latest remains", bpm: 60 },
      }),
    );

    emit(
      makeSnap({
        attempts_recorded: 3,
        tries: 2,
        voided_attempts: 1,
        last_attempt_id: 3,
        last_adjustment_id: 22,
        last: { verdict: "clean", note: "latest remains", bpm: 60 },
      }),
    );

    expect(result.current.feed).toEqual([
      { verdict: "clean", note: "latest remains", bpm: 60 },
    ]);
  });

  it("surfaces a command rejection as an inline error", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "rep_check"
        ? Promise.reject("no active block")
        : command === "metro_state"
          ? Promise.resolve(makeMetro())
          : Promise.resolve(null),
    );
    const { result } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    await act(async () => {
      await expect(result.current.check("clean")).rejects.toMatchObject({
        message: "no active block",
      });
    });

    await waitFor(() =>
      expect(result.current.error).toContain("no active block"),
    );
  });

  it("unsubscribes from the event on unmount", async () => {
    const { unmount } = renderHook(() => useRep());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    unmount();

    expect(unlistenMock).toHaveBeenCalled();
  });

  it("applyExternalReceipt applies a committed receipt's snapshot through the same seam as its own mutations (fix wave item 10)", async () => {
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(result.current.snap).toBeNull();

    const resumed = makeSnap({
      block_id: 42,
      timer_state: "active",
      set_state: "active",
    });
    act(() => {
      result.current.applyExternalReceipt({
        receipt_id: "receipt:external-resume:1",
        command_id: "native:resume:1",
        status: "committed",
        summary: "Practice resumed.",
        value: resumed,
        entity_refs: [{ entity_type: "set", entity_id: 42 }],
        event_ids: [],
        undo_action: null,
        error_code: null,
        error_detail: null,
        replayed: false,
        committed_ts: "2026-08-05T12:00:00Z",
      });
    });

    expect(result.current.snap?.block_id).toBe(42);
    expect(result.current.snap?.set_state).toBe("active");
  });

  it("applyExternalReceipt is a no-op for a rejected receipt (no parallel/partial state)", async () => {
    const { result } = renderHook(() => useRep(), { wrapper: receiptWrapper });
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => {
      result.current.applyExternalReceipt({
        receipt_id: "receipt:external-resume:rejected",
        command_id: "native:resume:2",
        status: "rejected",
        summary: "The practice set could not be resumed.",
        value: null,
        entity_refs: [],
        event_ids: [],
        undo_action: null,
        error_code: "practice_rejected",
        error_detail: "only a paused practice set can resume",
        replayed: false,
        committed_ts: null,
      });
    });

    expect(result.current.snap).toBeNull();
  });

  it("resets the ticking elapsed-time anchor when an external receipt lands (residuals fix wave, defect 3)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useRep(), {
        wrapper: receiptWrapper,
      });
      // Flush the mount effect's `listen`/`rep_state` microtasks without
      // testing-library's `waitFor` polling loop, which relies on a real
      // `setTimeout` that fake timers here intentionally never fire on their
      // own (only `vi.advanceTimersByTime` below does).
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(listenMock).toHaveBeenCalled();

      const resumed = makeSnap({
        block_id: 42,
        timer_state: "active",
        set_state: "active",
        active_seconds: 500,
      });
      act(() => {
        result.current.applyExternalReceipt({
          receipt_id: "receipt:external-resume:anchor",
          command_id: "native:resume:anchor",
          status: "committed",
          summary: "Practice resumed.",
          value: resumed,
          entity_refs: [{ entity_type: "set", entity_id: 42 }],
          event_ids: [],
          undo_action: null,
          error_code: null,
          error_detail: null,
          replayed: false,
          committed_ts: "2026-08-05T12:00:00Z",
        });
      });

      // The very next render already reflects the fresh receipt's
      // active_seconds — no stale value carried over from before.
      expect(result.current.snap?.active_seconds).toBe(500);

      // On the next tick, the display advances from the FRESH anchor (500),
      // not from whatever a stale prior anchor would have extrapolated.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.snap?.active_seconds).toBe(501);
    } finally {
      vi.useRealTimers();
    }
  });
});
