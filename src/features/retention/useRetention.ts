import { useCallback, useEffect, useRef, useState } from "react";
import { commandErrorMessage } from "../../services/command";
import { createCommandId } from "../../services/commandId";
import {
  useReceipts,
  type MutationReceipt,
} from "../receipts/ReceiptCenter";
import { nativeRetentionApi } from "./api";
import { isIsoDate, isValidSnoozeDate } from "./date";
import type {
  RetentionApi,
  RetentionCheckView,
  RetentionDecision,
  RetentionMutation,
  RetentionResult,
} from "./types";

export interface UseRetentionOptions {
  readonly asOfDate: string;
  readonly api?: RetentionApi;
}

export interface UseRetention {
  readonly checks: readonly RetentionCheckView[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly pending_check_ids: ReadonlySet<number>;
  readonly reload: () => Promise<void>;
  readonly clearError: () => void;
  readonly snooze: (checkId: number, dueDate: string) => Promise<boolean>;
  readonly confirm: (checkId: number, note: string) => Promise<boolean>;
  readonly lower: (checkId: number, note: string) => Promise<boolean>;
  readonly reopen: (checkId: number, note: string) => Promise<boolean>;
}

function compareChecks(left: RetentionCheckView, right: RetentionCheckView): number {
  if (left.due_date !== right.due_date) return left.due_date < right.due_date ? -1 : 1;
  return left.id - right.id;
}

function remainsDue(check: RetentionCheckView, asOfDate: string): boolean {
  return (check.state === "due" || check.state === "snoozed")
    && isIsoDate(check.due_date)
    && check.due_date <= asOfDate;
}

function receiptError(receipt: MutationReceipt): string {
  return receipt.error_detail?.trim()
    || receipt.summary.trim()
    || "The retention action was rejected.";
}

export function useRetention({
  asOfDate,
  api = nativeRetentionApi,
}: UseRetentionOptions): UseRetention {
  const receipts = useReceipts();
  const [checks, setChecks] = useState<RetentionCheckView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCheckIds, setPendingCheckIds] = useState<Set<number>>(new Set());
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const appliedReceiptIdsRef = useRef<Set<string>>(new Set());
  const pendingCommandIdsRef = useRef<Map<string, string>>(new Map());
  const asOfDateRef = useRef(asOfDate);
  asOfDateRef.current = asOfDate;

  useEffect(() => {
    // React StrictMode intentionally performs setup → cleanup → setup in dev.
    // Re-arm the guard on the second setup so valid native responses are not
    // mistaken for work from an unmounted component.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const requestSequence = ++loadSequenceRef.current;
    const mutationGeneration = mutationGenerationRef.current;
    if (!isIsoDate(asOfDate)) {
      if (mountedRef.current) {
        setChecks([]);
        setLoading(false);
        setError("Retention date must use YYYY-MM-DD.");
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const due = await api.due(asOfDate);
      if (
        !mountedRef.current
        || requestSequence !== loadSequenceRef.current
        || mutationGeneration !== mutationGenerationRef.current
      ) return;
      setChecks([...due].sort(compareChecks));
    } catch (cause) {
      if (
        !mountedRef.current
        || requestSequence !== loadSequenceRef.current
        || mutationGeneration !== mutationGenerationRef.current
      ) return;
      const message = commandErrorMessage(cause, "Retention checks could not be loaded.");
      setError(message);
      setChecks([]);
    } finally {
      if (
        mountedRef.current
        && requestSequence === loadSequenceRef.current
        && mutationGeneration === mutationGenerationRef.current
      ) setLoading(false);
    }
  }, [api, asOfDate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reconcileCommitted = useCallback((
    checkId: number,
    value: RetentionCheckView,
  ) => {
    setChecks((current) => {
      const without = current.filter((check) => check.id !== checkId);
      return remainsDue(value, asOfDateRef.current)
        ? [...without, value].sort(compareChecks)
        : without;
    });
  }, []);

  const mutate = useCallback(async (
    checkId: number,
    mutation: RetentionMutation,
    payload: string,
  ): Promise<boolean> => {
    const check = checks.find((candidate) => candidate.id === checkId);
    if (!check) {
      setError("That retention check is no longer in the due queue.");
      return false;
    }

    const trimmed = payload.trim();
    if (mutation === "snooze") {
      if (!isValidSnoozeDate(trimmed, check.due_date, asOfDateRef.current)) {
        setError("Snooze date must be a valid date after both the current due date and queue date.");
        return false;
      }
    } else if (trimmed === "") {
      setError("Add a result or note before resolving this retention check.");
      return false;
    }

    // A native mutation may commit even when its response is lost. Preserve the
    // command identity for an exact retry so the backend can replay its durable
    // receipt instead of applying the same decision twice. A changed payload is
    // intentionally a new command.
    const commandKey = JSON.stringify([
      mutation,
      checkId,
      trimmed,
      asOfDateRef.current,
    ]);
    const commandId = pendingCommandIdsRef.current.get(commandKey)
      ?? createCommandId(`retention-${mutation}`);
    pendingCommandIdsRef.current.set(commandKey, commandId);
    mutationGenerationRef.current += 1;
    setError(null);
    setPendingCheckIds((current) => new Set(current).add(checkId));

    const result: RetentionResult | null = mutation === "snooze" ? null : {
      decision: ({
        confirm: "confirm_retained",
        lower: "lower_working_condition",
        reopen: "reopen_target",
      } satisfies Record<Exclude<RetentionMutation, "snooze">, RetentionDecision>)[mutation],
      note: trimmed,
      checked_as_of: asOfDateRef.current,
    };

    try {
      const receipt = mutation === "snooze"
        ? await api.snooze(commandId, checkId, trimmed)
        : mutation === "confirm"
          ? await api.confirm(commandId, checkId, result as RetentionResult)
          : mutation === "lower"
            ? await api.lower(commandId, checkId, result as RetentionResult)
            : await api.reopen(commandId, checkId, result as RetentionResult);
      pendingCommandIdsRef.current.delete(commandKey);
      if (!mountedRef.current) return false;

      const seen = appliedReceiptIdsRef.current.has(receipt.receipt_id);
      receipts.mutation({
        ...receipt,
        command_id: receipt.command_id || commandId,
        replayed: receipt.replayed === true || seen,
      });
      if (receipt.status === "rejected") {
        setError(receiptError(receipt));
        return false;
      }
      if (receipt.status !== "committed") {
        setError("The retention action needs confirmation before the queue can change.");
        return false;
      }
      if (seen) return true;
      if (!receipt.value) {
        setError("The committed receipt did not include an updated retention check.");
        return false;
      }

      appliedReceiptIdsRef.current.add(receipt.receipt_id);
      reconcileCommitted(checkId, receipt.value);
      return true;
    } catch (cause) {
      if (!mountedRef.current) return false;
      const message = commandErrorMessage(cause, "The retention action could not be completed.");
      setError(message);
      receipts.error(cause, "The retention action could not be completed.");
      return false;
    } finally {
      if (mountedRef.current) {
        setPendingCheckIds((current) => {
          const next = new Set(current);
          next.delete(checkId);
          return next;
        });
      }
    }
  }, [api, checks, receipts, reconcileCommitted]);

  return {
    checks,
    loading,
    error,
    pending_check_ids: pendingCheckIds,
    reload,
    clearError: () => setError(null),
    snooze: (checkId, dueDate) => mutate(checkId, "snooze", dueDate),
    confirm: (checkId, note) => mutate(checkId, "confirm", note),
    lower: (checkId, note) => mutate(checkId, "lower", note),
    reopen: (checkId, note) => mutate(checkId, "reopen", note),
  };
}
