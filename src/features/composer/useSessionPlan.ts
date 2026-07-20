import { useCallback, useRef, useState } from "react";
import { CommandError, defineCommand, executeCommand } from "../../services/command";
import { createCommandId } from "../../services/commandId";
import { useReceipts, type MutationReceipt } from "../receipts/ReceiptCenter";
import type { RepSnapshot } from "../rep/useRep";
import type { ReviewedSessionDraft } from "./SessionComposer";

/** Wire payload for `session_plan_start`; mirrors the Rust `SessionPlanStartPayload`. */
export interface SessionPlanStartPayload {
  readonly command_id: string;
  readonly start_sequence: number;
  readonly plan: ReviewedSessionDraft;
}

/** Committed result of a plan start; mirrors the Rust `SessionPlanStartOutcome`. */
export interface SessionPlanStartOutcome {
  readonly plan: ReviewedSessionDraft;
  readonly started_sequence: number;
  readonly started_candidate_id: string;
  readonly block_id: number;
  readonly snapshot: RepSnapshot;
}

const SESSION_PLAN_START = defineCommand<
  { payload: SessionPlanStartPayload },
  MutationReceipt<SessionPlanStartOutcome>
>("session_plan_start", "The reviewed session plan could not be started.");

/**
 * A reviewed plan the user has started at least one item of. The plan itself is
 * the durable receipt's evidence; the frontend tracks which sequence numbers
 * have opened so far so the remaining items can be started explicitly, one at a
 * time, under the single-live-set invariant.
 */
export interface ActiveSessionPlan {
  readonly planId: string;
  readonly plan: ReviewedSessionDraft;
  readonly startedSequences: readonly number[];
}

const ACTIVE_PLAN_KEY = "codakiller.sessionPlan.active.v1";

function isReviewedPlan(value: unknown): value is ReviewedSessionDraft {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<ReviewedSessionDraft>;
  return (
    plan.mode === "reviewed_session_draft" &&
    Array.isArray(plan.sequence) &&
    plan.sequence.length > 0 &&
    plan.sequence.every(
      (item) =>
        item != null &&
        typeof item === "object" &&
        Number.isSafeInteger((item as { sequence?: unknown }).sequence) &&
        typeof (item as { candidate_id?: unknown }).candidate_id === "string",
    )
  );
}

function readActivePlan(): ActiveSessionPlan | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_PLAN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ActiveSessionPlan>;
    if (
      typeof value.planId !== "string" ||
      value.planId.trim() === "" ||
      !isReviewedPlan(value.plan) ||
      !Array.isArray(value.startedSequences) ||
      !value.startedSequences.every(Number.isSafeInteger)
    ) {
      window.localStorage.removeItem(ACTIVE_PLAN_KEY);
      return null;
    }
    return {
      planId: value.planId,
      plan: value.plan,
      startedSequences: [...new Set(value.startedSequences)],
    };
  } catch {
    try {
      window.localStorage.removeItem(ACTIVE_PLAN_KEY);
    } catch {
      // Storage can be unavailable in hardened webviews; memory still works.
    }
    return null;
  }
}

function writeActivePlan(value: ActiveSessionPlan | null) {
  try {
    if (value) window.localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(ACTIVE_PLAN_KEY);
  } catch {
    // A storage failure must not turn a committed practice write into an error.
  }
}

export interface UseSessionPlan {
  readonly activePlan: ActiveSessionPlan | null;
  /** The sequence number currently being started, or null when idle. */
  readonly startingSequence: number | null;
  /** Start the plan by opening its first item. Rejection throws so the composer
   *  surfaces it and preserves the reviewed draft. */
  readonly startPlan: (reviewed: ReviewedSessionDraft) => Promise<void>;
  /** Explicitly start a later item. Surfaces its own receipt/error; never throws. */
  readonly startItem: (sequence: number) => Promise<void>;
  readonly clearPlan: () => void;
}

/** True when a target reference names a concrete measure-anchored region that a
 *  rep set can open (a `goal:` reference cannot). */
export function isStartableTargetRef(targetRef: string): boolean {
  return /^\d+$/u.test(targetRef.trim());
}

export function useSessionPlan(): UseSessionPlan {
  const receipts = useReceipts();
  const [activePlan, setActivePlan] = useState<ActiveSessionPlan | null>(
    readActivePlan,
  );
  const [startingSequence, setStartingSequence] = useState<number | null>(null);
  const startInFlight = useRef(false);

  const runStart = useCallback(
    async (
      commandId: string,
      sequence: number,
      plan: ReviewedSessionDraft,
    ): Promise<MutationReceipt<SessionPlanStartOutcome>> => {
      if (startInFlight.current) {
        throw new Error("Another session-plan item is already starting.");
      }
      startInFlight.current = true;
      setStartingSequence(sequence);
      try {
        const receipt = await executeCommand(SESSION_PLAN_START, {
          payload: { command_id: commandId, start_sequence: sequence, plan },
        });
        receipts.mutation(receipt);
        if (receipt.status !== "committed") {
          // The rejection is already surfaced by receipts.mutation; throw a
          // plain Error so callers can react without re-toasting.
          throw new Error(
            receipt.error_detail?.trim() || receipt.summary || SESSION_PLAN_START.fallbackMessage,
          );
        }
        return receipt;
      } catch (cause) {
        // Only a native transport failure is un-surfaced at this point.
        if (cause instanceof CommandError) receipts.error(cause);
        throw cause;
      } finally {
        startInFlight.current = false;
        setStartingSequence(null);
      }
    },
    [receipts],
  );

  const startPlan = useCallback(
    async (reviewed: ReviewedSessionDraft) => {
      const first = reviewed.sequence[0];
      if (!first) throw new Error("The reviewed plan has no item to start.");
      const planId = createCommandId("session-plan");
      await runStart(`${planId}:${first.sequence}`, first.sequence, reviewed);
      const next = {
        planId,
        plan: reviewed,
        startedSequences: [first.sequence],
      } satisfies ActiveSessionPlan;
      setActivePlan(next);
      writeActivePlan(next);
    },
    [runStart],
  );

  const startItem = useCallback(
    async (sequence: number) => {
      if (!activePlan) return;
      try {
        await runStart(`${activePlan.planId}:${sequence}`, sequence, activePlan.plan);
        setActivePlan((current) => {
          if (!current) return current;
          const next = {
            ...current,
            startedSequences: current.startedSequences.includes(sequence)
              ? current.startedSequences
              : [...current.startedSequences, sequence],
          };
          writeActivePlan(next);
          return next;
        });
      } catch {
        // Already surfaced by runStart; a per-item Start button must not crash.
      }
    },
    [activePlan, runStart],
  );

  const clearPlan = useCallback(() => {
    setActivePlan(null);
    writeActivePlan(null);
  }, []);

  return { activePlan, startingSequence, startPlan, startItem, clearPlan };
}
