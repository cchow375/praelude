import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface exactly as useRep.test.ts / useSession.test.ts
// do: only `invoke` is needed here (session_plan_start is a plain command,
// not an event-bus subscription).
// ---------------------------------------------------------------------------
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSessionPlan, isStartableTargetRef } from "./useSessionPlan";
import type { MutationReceipt } from "../receipts/ReceiptCenter";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import type {
  ReviewedSessionDraft,
  ReviewedSessionItem,
} from "./SessionComposer";
import type { RepSnapshot } from "../rep/useRep";
import type { SessionPlanStartOutcome } from "./useSessionPlan";

function receiptWrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function makeItem(
  over: Partial<ReviewedSessionItem> = {},
): ReviewedSessionItem {
  return {
    sequence: 1,
    candidate_id: "candidate-1",
    piece_ref: "1",
    target_ref: "8",
    kind: "planned_work",
    allocated_minutes: 10,
    estimated_minutes: 10,
    rationale: "Planned work",
    editable_minutes: { min: 1, max: 10 },
    provenance: {
      candidate_ids: ["candidate-1"],
      evidence_ids: [],
      source_refs: [],
    },
    ...over,
  };
}

function makePlan(
  over: Partial<ReviewedSessionDraft> = {},
): ReviewedSessionDraft {
  return {
    mode: "reviewed_session_draft",
    available_minutes: 20,
    allocated_minutes: 10,
    unallocated_minutes: 10,
    sequence: [makeItem()],
    excluded_candidate_ids: [],
    source_draft_issues: [],
    ...over,
  };
}

function makeReceipt(
  over: Partial<MutationReceipt<SessionPlanStartOutcome>> = {},
): MutationReceipt<SessionPlanStartOutcome> {
  return {
    receipt_id: "receipt-1",
    command_id: "cmd-1",
    status: "committed",
    summary: "Started item 1.",
    value: {
      plan: makePlan(),
      started_sequence: 1,
      started_candidate_id: "candidate-1",
      block_id: 42,
      snapshot: {} as unknown as RepSnapshot,
    },
    entity_refs: [],
    event_ids: [],
    undo_action: null,
    error_code: null,
    error_detail: null,
    replayed: false,
    committed_ts: "2026-07-16T12:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("isStartableTargetRef", () => {
  it("accepts a bare measure-anchored digit reference", () => {
    expect(isStartableTargetRef("8")).toBe(true);
    expect(isStartableTargetRef("  42  ")).toBe(true);
  });

  it("rejects a goal reference and any non-numeric ref", () => {
    expect(isStartableTargetRef("goal:5")).toBe(false);
    expect(isStartableTargetRef("")).toBe(false);
    expect(isStartableTargetRef("8x")).toBe(false);
  });
});

describe("useSessionPlan — startPlan", () => {
  it("starts the first sequence item, composes command_id as `{planId}:{sequence}`, and activates the plan", async () => {
    invokeMock.mockResolvedValueOnce(makeReceipt());
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    const plan = makePlan();

    await act(async () => {
      await result.current.startPlan(plan);
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0] as [
      string,
      {
        payload: {
          command_id: string;
          start_sequence: number;
          plan: ReviewedSessionDraft;
        };
      },
    ];
    expect(command).toBe("session_plan_start");
    expect(args.payload.start_sequence).toBe(1);
    expect(args.payload.plan).toBe(plan);
    // command_id is `${planId}:${sequence}`, planId is a fresh `session-plan`-prefixed id.
    expect(args.payload.command_id).toMatch(/^ui:session-plan:.+:1$/);

    expect(result.current.activePlan).toMatchObject({
      plan,
      startedSequences: [1],
    });
    expect(result.current.startingSequence).toBeNull();
  });

  it("throws without invoking the native command when the reviewed plan has no items", async () => {
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    const emptyPlan = makePlan({ sequence: [] });

    await expect(result.current.startPlan(emptyPlan)).rejects.toThrow(
      "The reviewed plan has no item to start.",
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.activePlan).toBeNull();
  });

  it("surfaces startingSequence while the native call is in flight and clears it afterward", async () => {
    let resolveInvoke: (value: unknown) => void = () => undefined;
    invokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    const plan = makePlan();

    let pending: Promise<void>;
    act(() => {
      pending = result.current.startPlan(plan);
    });
    await waitFor(() => expect(result.current.startingSequence).toBe(1));

    await act(async () => {
      resolveInvoke(makeReceipt());
      await pending;
    });
    expect(result.current.startingSequence).toBeNull();
  });
});

describe("useSessionPlan — rejected receipts and native errors", () => {
  it("on a rejected receipt: publishes it via receipts.mutation and rethrows a plain Error (not a CommandError) so it is not double-surfaced", async () => {
    invokeMock.mockResolvedValueOnce(
      makeReceipt({
        status: "rejected",
        error_detail: "Another set is already live.",
        value: null,
      }),
    );
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    const plan = makePlan();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.startPlan(plan);
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).not.toBe("CommandError");
    expect((caught as Error).message).toBe("Another set is already live.");
    expect(result.current.activePlan).toBeNull();
    expect(result.current.startingSequence).toBeNull();
  });

  it("on a native transport failure: rethrows the CommandError and lets receipts.error surface it exactly once", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "io_error",
      message: "The native bridge is unreachable.",
    });
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    const plan = makePlan();

    await expect(result.current.startPlan(plan)).rejects.toMatchObject({
      name: "CommandError",
      command: "session_plan_start",
      code: "io_error",
    });
    expect(result.current.activePlan).toBeNull();
    expect(result.current.startingSequence).toBeNull();
  });
});

describe("useSessionPlan — startItem", () => {
  it("is a no-op that never invokes the native command when there is no active plan", async () => {
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });

    await act(async () => {
      await result.current.startItem(2);
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.activePlan).toBeNull();
  });

  it("appends a newly-started sequence to startedSequences without duplicating an already-started one", async () => {
    const plan = makePlan({
      sequence: [
        makeItem({ sequence: 1 }),
        makeItem({ sequence: 2, candidate_id: "candidate-2" }),
      ],
    });
    invokeMock.mockResolvedValueOnce(
      makeReceipt({ value: { ...makeReceipt().value!, started_sequence: 1 } }),
    );
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });

    await act(async () => {
      await result.current.startPlan(plan);
    });
    expect(result.current.activePlan?.startedSequences).toEqual([1]);

    invokeMock.mockResolvedValueOnce(
      makeReceipt({ value: { ...makeReceipt().value!, started_sequence: 2 } }),
    );
    await act(async () => {
      await result.current.startItem(2);
    });
    expect(result.current.activePlan?.startedSequences).toEqual([1, 2]);

    // Re-starting sequence 1 again must not duplicate it in startedSequences,
    // even though the native call is re-issued with the same command_id.
    invokeMock.mockResolvedValueOnce(
      makeReceipt({ value: { ...makeReceipt().value!, started_sequence: 1 } }),
    );
    await act(async () => {
      await result.current.startItem(1);
    });
    expect(result.current.activePlan?.startedSequences).toEqual([1, 2]);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    const thirdCallArgs = invokeMock.mock.calls[2][1] as {
      payload: { command_id: string };
    };
    expect(thirdCallArgs.payload.command_id).toBe(
      `${result.current.activePlan?.planId}:1`,
    );
  });

  it("never throws out of startItem: a rejected receipt or transport failure is swallowed after being surfaced once", async () => {
    const plan = makePlan();
    invokeMock.mockResolvedValueOnce(makeReceipt());
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    await act(async () => {
      await result.current.startPlan(plan);
    });

    invokeMock.mockRejectedValueOnce({
      code: "io_error",
      message: "unreachable",
    });
    await act(async () => {
      await expect(result.current.startItem(1)).resolves.toBeUndefined();
    });
    expect(result.current.startingSequence).toBeNull();
  });

  it("race: a second overlapping startItem is ignored before it can write", async () => {
    const plan = makePlan({
      sequence: [
        makeItem({ sequence: 1 }),
        makeItem({ sequence: 2, candidate_id: "candidate-2" }),
      ],
    });
    invokeMock.mockResolvedValueOnce(makeReceipt());
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    await act(async () => {
      await result.current.startPlan(plan);
    });

    let resolveFirst: (value: unknown) => void = () => undefined;
    invokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    let firstCall: Promise<void>;
    act(() => {
      firstCall = result.current.startItem(1);
    });
    await waitFor(() => expect(result.current.startingSequence).toBe(1));
    act(() => {
      void result.current.startItem(2);
    });
    expect(result.current.startingSequence).toBe(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst(
        makeReceipt({
          value: { ...makeReceipt().value!, started_sequence: 1 },
        }),
      );
      await firstCall;
    });
    expect(result.current.startingSequence).toBeNull();
    expect(result.current.activePlan?.startedSequences).toEqual([1]);
  });
});

describe("useSessionPlan — clearPlan", () => {
  it("clears the active plan", async () => {
    invokeMock.mockResolvedValueOnce(makeReceipt());
    const { result } = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    await act(async () => {
      await result.current.startPlan(makePlan());
    });
    expect(result.current.activePlan).not.toBeNull();

    act(() => {
      result.current.clearPlan();
    });
    expect(result.current.activePlan).toBeNull();
  });

  it("restores a started multi-item plan after unmount and removes it on dismiss", async () => {
    const plan = makePlan({
      sequence: [
        makeItem({ sequence: 1 }),
        makeItem({ sequence: 2, candidate_id: "candidate-2" }),
      ],
    });
    invokeMock.mockResolvedValueOnce(makeReceipt());
    const first = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    await act(async () => {
      await first.result.current.startPlan(plan);
    });
    const planId = first.result.current.activePlan?.planId;
    first.unmount();

    const resumed = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    expect(resumed.result.current.activePlan).toMatchObject({
      planId,
      plan,
      startedSequences: [1],
    });

    act(() => resumed.result.current.clearPlan());
    resumed.unmount();
    const afterDismiss = renderHook(() => useSessionPlan(), {
      wrapper: receiptWrapper,
    });
    expect(afterDismiss.result.current.activePlan).toBeNull();
  });
});
