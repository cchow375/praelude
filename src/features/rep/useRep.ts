import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commandErrorMessage,
  defineCommand,
  executeCommand,
} from "../../services/command";
import type { MetroState } from "../metronome/useMetronome";
import { HISTORY_LOWER } from "../../shell/terms";
import { readMetroIntentState } from "../metronome/intentGuard";
import { useReceipts, type MutationReceipt } from "../receipts/ReceiptCenter";
import { createCommandId } from "../../services/commandId";

// ---------------------------------------------------------------------------
// Rep-engine hook.
//
// The Rust backend (src-tauri/src/rep) is the single source of truth for the
// active practice block. Every open/check/close emits a `rep://state` event
// carrying the full `Option<RepSnapshot>` (null = no active block -> hide the
// HUD). This hook subscribes to that event FIRST, then does ONE `rep_state`
// fetch on mount — same ordering as useMetronome so an event emitted while the
// fetch is in flight is never dropped.
//
// Both voice acks ("that was clean") and the HUD verdict buttons flow through
// the same `rep_check` command, so the snapshot updates identically regardless
// of input surface. The last-verdict feed (last 5) is derived from successive
// authoritative snapshots. Attempts, corrections, and reversals all reconcile
// through this projection; the UI never derives mastery from an attempt count.
//
// Command args are camelCase from JS (Tauri maps them to Rust snake_case). The
// nested `RepOpenArgs` / `Intake` structs are serde-deserialized, so THEIR
// fields stay snake_case. Event payloads are serde snake_case to match.
// ---------------------------------------------------------------------------

export interface VerdictCounts {
  clean: number;
  flawed: number;
  failed: number;
}

export interface LastRep {
  verdict: string;
  note: string | null;
  /** Null means tempo was not part of this attempt; legacy 0-BPM sentinels map here. */
  bpm: number | null;
}

export interface IncrementRule {
  clean_needed: number;
  bpm_step: number;
  /** A1: per-set override of `rep.demote_enabled`. `null`/absent = use the
   * global setting. */
  demote_enabled?: boolean | null;
  /** A1: per-set override of `rep.demote_first`. `null`/absent = use the
   * global setting. */
  demote_first?: number | null;
  /** A1: per-set override of `rep.demote_repeat`. `null`/absent = use the
   * global setting. */
  demote_repeat?: number | null;
}

export interface VariantSpec {
  name: string;
  reps: number;
}

/** A5: the note value a set's bpm number counts. A LABEL only — the entered
 * bpm is exactly the click rate; changing this never multiplies/divides it. */
export type BeatUnit = "quarter" | "eighth" | "dotted_quarter" | "half";

/** A5: a set's own metronome tuning — the beat-unit label plus the engine's
 * existing subdivision/beats-per-bar dimensions. Mirrors the backend
 * `SetTuning` (defaults: quarter / 1 / 4). */
export interface SetTuning {
  beat_unit: BeatUnit;
  subdivision: number;
  beats_per_bar: number;
}

/** Mirrors the backend `RepSnapshot` serde payload (snake_case). */
export interface RepSnapshot {
  block_id: number;
  piece_id: number;
  piece_title: string;
  m_start: number;
  m_end: number;
  label: string | null;
  /** Null when this set has no tempo or metronome dimension. */
  bpm: number | null;
  start_bpm: number;
  target_bpm: number | null;
  planned_reps: number;
  reps_done: number;
  cleans_at_step: number;
  rule: IncrementRule;
  variant: string | null;
  variants: VariantSpec[];
  verdicts: VerdictCounts;
  last: LastRep | null;
  status: string;
  focus: string;
  use_metronome: boolean;
  /** V2 authoritative ledger projection. Absent only on legacy/test payloads. */
  attempts_recorded?: number;
  tries?: number;
  voided_attempts?: number;
  /** Trailing clean attempts under the current working condition/rung. */
  current_clean_streak?: number;
  /** Trailing clean attempts eligible for the captured mastery condition. */
  mastery_progress_streak?: number;
  best_clean_streak?: number;
  reset_count?: number;
  accuracy?: number | null;
  required_clean_streak?: number | null;
  effective_required_clean_streak?: number | null;
  recovery_remaining?: number;
  mastery_status?: MasteryStatus;
  mastery_verified?: boolean;
  set_state?: string;
  last_attempt_id?: number | null;
  last_adjustment_id?: number | null;
  review_boundary_reached?: boolean;
  /** Seconds durably checkpointed as focused practice; paused/relaunch gaps are excluded. */
  active_seconds?: number;
  timer_state?: "active" | "paused" | string;
  intention?: string | null;
  judging_axis?: string;
  hands?: string;
  method?: string;
  planned_seconds?: number | null;
  reflection?: string | null;
  safety_state?: "clear" | "stopped" | string;
  manual_clean_debt?: number;
  recovery_actions?: RecoveryActionView[];
  retention_check?: RetentionCheckView | null;
  working_m_start?: number;
  working_m_end?: number;
  /** A5: the set's own metronome tuning. Absent only on legacy/test payloads. */
  tuning?: SetTuning;
  /** A1: trailing sloppy attempts under the current working tempo, reset by
   * a clean. Counts SLOPPY only — "again"/failed neither counts nor resets. */
  current_sloppy_streak?: number;
  /** A1: whether this set has been demoted at least once — the repeat
   * threshold (2, not 3) applies for the remainder of the set once true. */
  demoted_this_set?: boolean;
}

export interface RecoveryActionView {
  id: number;
  kind: RecoveryActionRequest["kind"] | string;
  after_attempt_id: number | null;
  payload: unknown;
  rationale: string;
  source: string;
  created_ts: string;
}

export interface RetentionCheckView {
  id: number;
  region_id: number;
  source_set_id: number | null;
  due_date: string;
  original_due_date: string;
  condition: RetentionCondition;
  state: string;
  result: RetentionResult | null;
  completed_ts: string | null;
  created_ts: string;
  updated_ts: string;
}

export interface RetentionCondition {
  bpm?: number | null;
  m_start?: number | null;
  m_end?: number | null;
  hands?: string | null;
  method?: string | null;
  judging_axis?: string | null;
  required_clean_streak?: number | null;
  cold?: boolean | null;
}

export interface RetentionResult {
  decision: "confirm_retained" | "lower_working_condition" | "reopen_target";
  note: string;
  checked_as_of: string;
  observed_condition?: RetentionCondition | null;
  next_condition?: RetentionCondition | null;
}

export type RecoveryActionRequest =
  | { kind: "reset_streak"; rationale: string }
  | { kind: "clean_debt"; clean_count: number; rationale: string }
  | { kind: "tempo_backoff"; bpm: number; rationale: string }
  | { kind: "narrow_target"; m_start: number; m_end: number; rationale: string }
  | { kind: "change_hands"; hands: string; rationale: string }
  | { kind: "change_method"; method: string; rationale: string }
  | { kind: "break"; planned_seconds?: number | null; rationale: string }
  | {
      kind: "schedule_retention";
      due_date: string;
      condition?: RetentionCondition;
      rationale: string;
    };

export type MasteryStatus =
  "satisfied" | "not_satisfied" | "not_applicable" | "unverified_legacy";

/** A legacy count is safe to call attempts, but never proves mastery. */
export function repAttempts(snap: RepSnapshot): number {
  return snap.attempts_recorded ?? snap.tries ?? snap.reps_done;
}

export function repTries(snap: RepSnapshot): number {
  return snap.tries ?? snap.attempts_recorded ?? snap.reps_done;
}

export function repMasteryStatus(snap: RepSnapshot): MasteryStatus {
  return snap.mastery_status ?? "unverified_legacy";
}

export function repMasteryVerified(snap: RepSnapshot): boolean {
  return (
    snap.mastery_verified === true &&
    repMasteryStatus(snap) !== "unverified_legacy"
  );
}

function sameRepProjection(
  current: RepSnapshot,
  expected: RepSnapshot,
): boolean {
  return (
    current.block_id === expected.block_id &&
    current.last_attempt_id === expected.last_attempt_id &&
    current.last_adjustment_id === expected.last_adjustment_id &&
    repTries(current) === repTries(expected) &&
    current.bpm === expected.bpm &&
    current.set_state === expected.set_state
  );
}

interface MetroCommandGuard {
  eventRevision: number;
  intentRevision: number;
  pendingIntents: number;
}

function captureMetroCommandGuard(eventRevision: number): MetroCommandGuard {
  const intent = readMetroIntentState();
  return {
    eventRevision,
    intentRevision: intent.revision,
    pendingIntents: intent.pending,
  };
}

function metroCommandGuardIsCurrent(
  guard: MetroCommandGuard,
  eventRevision: number,
): boolean {
  const intent = readMetroIntentState();
  return (
    guard.eventRevision === eventRevision &&
    guard.intentRevision === intent.revision &&
    guard.pendingIntents === 0 &&
    intent.pending === 0
  );
}

interface ReadinessLatch {
  promise: Promise<void>;
  resolve: () => void;
}

function createReadinessLatch(): ReadinessLatch {
  let settle: () => void = () => undefined;
  let settled = false;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      settle();
    },
  };
}

function isBrowserDevUnavailable(cause: unknown): boolean {
  const message = commandErrorMessage(cause, "").toLocaleLowerCase();
  return (
    message.includes("__tauri") ||
    message.includes("outside a tauri") ||
    message.includes("outside of a tauri") ||
    message.includes("tauri is not available") ||
    message.includes("cannot read properties of undefined")
  );
}

class MutationReceiptRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationReceiptRejectedError";
  }
}

/** Mirrors the backend `CheckOutcome` serde payload. */
export interface CheckOutcome {
  snap: RepSnapshot;
  new_bpm: number | null;
  block_done: boolean;
  say: string;
  receipt?: MutationReceipt<RepSnapshot> | null;
}

/** Argument bag for `rep_open` (passed as the single `args` command param). */
export interface RepOpenArgs {
  piece_id: number;
  region_id?: number | null;
  m_start: number;
  m_end: number;
  label: string | null;
  start_bpm: number | null;
  target_bpm: number | null;
  planned_reps: number | null;
  /** Consecutive-clean target. Null delegates to the persisted v2 default. */
  required_clean_streak?: number | null;
  increment: IncrementRule | null;
  variants: VariantSpec[];
  focus: string;
  use_metronome: boolean;
  /** A5: the set's own metronome tuning. Omitted delegates to the backend
   * default (quarter / 1 / 4). */
  tuning?: SetTuning;
}

export interface SetFocusContextInput {
  intention?: string | null;
  judging_axis?: string | null;
  hands?: string | null;
  method?: string | null;
  planned_seconds?: number | null;
  reflection?: string | null;
  /** Task A10: estimated seconds for one pass through the set's ladder. */
  pass_seconds?: number | null;
}

/** Verdict strings accepted by `rep_check`. */
export type Verdict = "clean" | "flawed" | "failed";

const FEED_MAX = 5;
const REP_STATE = defineCommand<undefined, RepSnapshot | null>(
  "rep_state",
  "The current practice block could not be loaded.",
);
const REP_OPEN = defineCommand<
  {
    args: RepOpenArgs;
    context: SetFocusContextInput | null;
  },
  RepSnapshot
>("rep_open", "The practice set could not be opened.");
const REP_CHECK = defineCommand<
  { verdict: Verdict; note: string | null; commandId: string },
  CheckOutcome
>("rep_check", "The attempt could not be saved.");
const REP_CLOSE = defineCommand<undefined, RepSnapshot | null>(
  "rep_close",
  "The practice set could not be closed.",
);
const REP_UNDO = defineCommand<undefined, CheckOutcome>(
  "rep_undo",
  "The latest attempt could not be undone.",
);
const REP_CORRECT = defineCommand<
  {
    attemptId: number | null;
    verdict: Verdict;
    note: string | null;
    replaceNote: boolean;
  },
  CheckOutcome
>("rep_correct", "The latest attempt could not be corrected.");
const REP_ADJUSTMENT_REVERSE = defineCommand<
  { adjustmentId: number },
  CheckOutcome
>("rep_adjustment_reverse", "The latest adjustment could not be reversed.");
const REP_RESTART = defineCommand<
  { requiredCleanStreak: number | null },
  RepSnapshot
>("rep_restart", "The practice set could not be restarted.");
const REP_PAUSE = defineCommand<
  { commandId: string },
  MutationReceipt<RepSnapshot>
>("rep_pause", "The practice timer could not be paused.");
const REP_RESUME = defineCommand<
  { commandId: string },
  MutationReceipt<RepSnapshot>
>("rep_resume", "The practice timer could not be resumed.");
const REP_CHECKPOINT = defineCommand<
  { commandId: string },
  MutationReceipt<RepSnapshot>
>("rep_checkpoint", "Focused time could not be checkpointed.");
const REP_REFLECT = defineCommand<
  { commandId: string; reflection: string },
  MutationReceipt<RepSnapshot>
>("rep_reflect", "The set reflection could not be saved.");
const REP_SAFETY_STOP = defineCommand<
  { commandId: string; reason: string | null },
  MutationReceipt<RepSnapshot>
>("rep_safety_stop", "The safety stop could not be saved.");
const REP_RECOVERY = defineCommand<
  { commandId: string; action: RecoveryActionRequest },
  MutationReceipt<RepSnapshot>
>("rep_recovery", "The recovery choice could not be saved.");
const METRO_START = defineCommand<
  {
    setId: number;
    bpm: number;
    beatsPerBar?: number;
    subdivision?: number;
  },
  unknown
>(
  "metro_practice_start",
  "The set opened, but the metronome could not be started.",
);
const METRO_STATE = defineCommand<undefined, MetroState>(
  "metro_state",
  "The metronome state could not be loaded.",
);
const METRO_SET = defineCommand<
  {
    setId: number;
    bpm: number;
    beatsPerBar?: number;
    subdivision?: number;
  },
  unknown
>(
  "metro_practice_retune",
  "The attempt saved, but the metronome tempo could not be updated.",
);
const METRO_RESTART = defineCommand<
  {
    oldSetId: number;
    newSetId: number;
    bpm: number;
    beatsPerBar?: number;
    subdivision?: number;
  },
  unknown
>(
  "metro_practice_restart",
  "The set restarted, but the metronome could not be synchronized.",
);
const METRO_PAUSE = defineCommand<{ setId: number }, unknown>(
  "metro_practice_pause",
  "Practice paused, but the metronome could not be synchronized.",
);
const METRO_RESUME = defineCommand<
  {
    setId: number;
    bpm: number;
    beatsPerBar?: number;
    subdivision?: number;
  },
  unknown
>(
  "metro_practice_resume",
  "Practice resumed, but the metronome could not be synchronized.",
);
const METRO_CLOSE = defineCommand<{ setId: number }, unknown>(
  "metro_practice_close",
  "The set closed, but the metronome could not be synchronized.",
);

export interface UseRep {
  /** The active block snapshot, or null when no block is open (HUD hidden). */
  snap: RepSnapshot | null;
  /** Last verdicts, newest first, capped at 5 — from both voice and buttons. */
  feed: LastRep[];
  /** Last command rejection, shown as a quiet inline notice. Auto-clears. */
  error: string | null;
  clearError: () => void;
  /** Open a new practice block. Applies the returned snapshot immediately. */
  open: (
    args: RepOpenArgs,
    context?: SetFocusContextInput | null,
  ) => Promise<void>;
  /** Record a verdict (same path as a voice ack). */
  check: (verdict: Verdict, note?: string | null) => Promise<void>;
  /** Append a reversal for the latest attempt. No attempt row is deleted. */
  undo: () => Promise<void>;
  /** Append a correction, defaulting to the latest attempt when id is null. */
  correct: (
    attemptId: number | null,
    verdict: Verdict,
    note?: string | null,
  ) => Promise<void>;
  /** Reverse an active correction/void through another ledger adjustment. */
  reverseAdjustment: (adjustmentId: number) => Promise<void>;
  /** Mark this set restarted and create a fresh set with the same contract. */
  restart: (requiredCleanStreak?: number | null) => Promise<void>;
  /** Close the active timing interval without closing the set. */
  pause: () => Promise<void>;
  /** Start a fresh focused timing interval on the same set. */
  resume: () => Promise<void>;
  /** Persist elapsed focused time; internal checkpoints do not create UI noise. */
  checkpoint: () => Promise<void>;
  /** Save the pianist's own focus/quality reflection. */
  reflect: (reflection: string) => Promise<void>;
  /** Commit a pain/weakness stop before stopping the metronome. */
  safetyStop: (reason?: string | null) => Promise<void>;
  /** Apply one explicit, deterministic recovery choice. */
  recover: (action: RecoveryActionRequest) => Promise<void>;
  /** Close the active block. */
  close: () => Promise<void>;
  /**
   * Fix wave item 10: applies an EXTERNALLY-committed receipt's snapshot
   * (e.g. the paused-sets tray's own `rep_resume` call, which does not go
   * through this hook's `resume()`) through the SAME `applySnapshot` seam
   * every one of this hook's own mutations uses — no parallel state. A
   * no-op for anything that isn't a committed receipt with a value; the
   * caller is expected to have already handled a rejection on its own.
   */
  applyExternalReceipt: (receipt: MutationReceipt<RepSnapshot>) => void;
}

export function useRep(): UseRep {
  const [snap, setSnap] = useState<RepSnapshot | null>(null);
  const [feed, setFeed] = useState<LastRep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const receipts = useReceipts();

  // Residuals fix wave (defect 3, "rep elapsed-time stale ~10s around
  // pause/resume"): `active_seconds` only ever changed when a fresh snapshot
  // landed (a mutation's receipt, or the 15s checkpoint interval below) — the
  // HUD showed a flat number between those, so right after a pause/resume the
  // readout looked "stuck" for up to ~10-15s until the next snapshot bumped
  // it. This anchors a locally-ticking display value to the LAST authoritative
  // `active_seconds` + the wall-clock moment it landed, so it advances
  // smoothly every second instead of only on receipt. The anchor is reset
  // inside `applySnapshot` below — the ONE seam both this hook's own
  // mutations AND `applyExternalReceipt` (the paused-sets tray's resume) flow
  // through — so a resume's fresh snapshot re-anchors immediately instead of
  // the display continuing to extrapolate from a now-stale base.
  const activeSecondsAnchor = useRef<{
    base: number;
    at: number;
    ticking: boolean;
  }>({ base: 0, at: Date.now(), ticking: false });
  const [elapsedTick, setElapsedTick] = useState(0);

  const snapRef = useRef<RepSnapshot | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announcedAttempts = useRef(new Set<string>());
  const pendingAttemptCommands = useRef(0);
  const commandIds = useRef(new Map<string, string>());
  const eventRevision = useRef(0);
  const mutationRevision = useRef(0);
  const metroRef = useRef<MetroState | null>(null);
  const metroRevision = useRef(0);
  const metroReadinessRef = useRef<ReadinessLatch | null>(null);
  if (metroReadinessRef.current == null) {
    metroReadinessRef.current = createReadinessLatch();
  }
  const metroReadiness = metroReadinessRef.current;

  const publishAttemptReceipt = useCallback(
    (
      next: RepSnapshot,
      fallbackVerdict?: Verdict,
      receipt?: MutationReceipt<RepSnapshot> | null,
    ) => {
      const verdict = next.last?.verdict ?? fallbackVerdict;
      const tries = repTries(next);
      if (!verdict || tries < 1) return;
      const key =
        next.last_attempt_id != null
          ? `${next.block_id}:attempt:${next.last_attempt_id}`
          : `${next.block_id}:legacy-attempt:${tries}`;
      if (announcedAttempts.current.has(key)) return;
      announcedAttempts.current.add(key);
      if (announcedAttempts.current.size > 100) {
        const oldest = announcedAttempts.current.values().next().value;
        if (oldest) announcedAttempts.current.delete(oldest);
      }
      if (receipt) receipts.mutation(receipt);
      else receipts.committed(`Attempt ${tries} saved — ${verdict}.`);
    },
    [receipts],
  );

  // Apply an authoritative snapshot and maintain the derived verdict feed. The
  // feed resets when the block changes (or clears) and grows by one whenever
  // the attempt ledger advances — capturing both voice- and button-driven
  // checks. Reversals remove the voided attempt from the visible feed and a
  // correction replaces the latest projected verdict.
  const applySnapshot = useCallback(
    (next: RepSnapshot | null, announceCommittedAttempt = false) => {
      const prev = snapRef.current;
      if (next == null) {
        setFeed([]);
      } else if (!prev || prev.block_id !== next.block_id) {
        setFeed(next.last ? [next.last] : []);
      } else if (next.last_adjustment_id !== prev.last_adjustment_id) {
        // An adjustment can target any attempt, so the previous short feed can
        // no longer be reconciled safely by count or position. Collapse to the
        // authoritative latest effective attempt (or empty after a full void).
        setFeed(next.last ? [next.last] : []);
      } else if (repTries(next) > repTries(prev) && next.last) {
        const last = next.last;
        setFeed((f) => [last, ...f].slice(0, FEED_MAX));
        if (announceCommittedAttempt) publishAttemptReceipt(next);
      } else if (repTries(next) < repTries(prev)) {
        const removed = Math.max(1, repTries(prev) - repTries(next));
        setFeed((f) => f.slice(removed));
      }
      snapRef.current = next;
      setSnap(next);
      // Residuals fix wave (defect 3): re-anchor the ticking elapsed display
      // to THIS authoritative snapshot the instant it lands — same seam every
      // snapshot (own mutations, the event stream, and applyExternalReceipt)
      // already funnels through, no parallel state.
      activeSecondsAnchor.current = {
        base: next?.active_seconds ?? 0,
        at: Date.now(),
        ticking:
          next != null &&
          (next.timer_state ??
            (next.set_state === "active" ? "active" : "")) === "active",
      };
    },
    [publishAttemptReceipt],
  );

  // Ticks the elapsed-time display once a second while the anchor above is
  // "live" (an active timing interval) — purely cosmetic re-render, same
  // pattern as ClockPanel/SessionBar's own `now` tick; the anchor's `base` +
  // `at` stay the source of truth so this never drifts from what the backend
  // last durably confirmed.
  useEffect(() => {
    if (!activeSecondsAnchor.current.ticking) return undefined;
    const id = window.setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [snap?.block_id, snap?.timer_state, snap?.set_state]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4500);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(null);
  }, []);

  const commandId = useCallback((operation: string) => {
    const existing = commandIds.current.get(operation);
    if (existing) return existing;
    const created = createCommandId(operation);
    commandIds.current.set(operation, created);
    if (commandIds.current.size > 32) {
      const oldest = commandIds.current.keys().next().value;
      if (oldest) commandIds.current.delete(oldest);
    }
    return created;
  }, []);

  const settleCommandId = useCallback((operation: string) => {
    commandIds.current.delete(operation);
  }, []);

  /**
   * A returned command snapshot is a fallback for environments without the
   * event bus. Once a newer rep event or mutation exists, that authoritative
   * state wins. This is essential for undo/correct because attempt totals may
   * move backward and therefore cannot be guarded with a monotonic count.
   */
  const applyReturnedSnapshot = useCallback(
    (
      next: RepSnapshot,
      blockAtStart: number | null,
      eventsAtStart: number,
      mutationAtStart: number,
    ) => {
      if (mutationRevision.current !== mutationAtStart) return false;
      if (next.block_id !== blockAtStart) return false;
      if (snapRef.current?.block_id !== blockAtStart) return false;
      if (eventRevision.current !== eventsAtStart) return false;
      applySnapshot(next);
      return true;
    },
    [applySnapshot],
  );

  const retuneIfCurrent = useCallback(
    async (
      outcome: CheckOutcome,
      blockAtStart: number | null,
      mutationAtStart: number,
      metroAtStart: MetroCommandGuard,
    ) => {
      if (outcome.new_bpm == null) return;
      // The ledger is already committed. If the one-time metronome read is still
      // in flight, wait only before the optional side effect, then revalidate all
      // rep, event, and manual-intent ownership before changing tempo.
      if (metroRef.current == null) await metroReadiness.promise;
      const current = snapRef.current;
      const expected = outcome.snap;
      const responseIsCurrent =
        mutationRevision.current === mutationAtStart &&
        metroCommandGuardIsCurrent(metroAtStart, metroRevision.current) &&
        blockAtStart != null &&
        current != null &&
        current.block_id === blockAtStart &&
        sameRepProjection(current, expected);
      if (
        !responseIsCurrent ||
        !current.use_metronome ||
        current.set_state !== "active" ||
        metroRef.current?.running !== true
      )
        return;
      try {
        await executeCommand(METRO_SET, {
          setId: current.block_id,
          bpm: outcome.new_bpm,
          beatsPerBar: current.tuning?.beats_per_bar,
          subdivision: current.tuning?.subdivision,
        });
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          `The change was saved to your ${HISTORY_LOWER}, but the metronome tempo could not be updated.`,
        );
        showError(message);
        receipts.error(cause, message);
      }
    },
    [metroReadiness, receipts, showError],
  );

  const runSnapshotReceiptMutation = useCallback(
    async (
      operation: string,
      fallbackMessage: string,
      invokeReceipt: (id: string) => Promise<MutationReceipt<RepSnapshot>>,
      publishCommitted = true,
    ): Promise<RepSnapshot> => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      const eventsAtStart = eventRevision.current;
      const mutationAtStart = mutationRevision.current + 1;
      mutationRevision.current = mutationAtStart;
      const id = commandId(operation);
      try {
        const receipt = await invokeReceipt(id);
        // Fix wave item 8: an unmocked/misbehaving backend resolving with
        // `null`/`undefined` instead of a receipt used to reach
        // `receipt.status` below and throw a raw TypeError — caught by the
        // generic `catch` further down, which ALSO calls `receipts.error`,
        // so every occurrence (e.g. the 15s checkpoint heartbeat hitting an
        // unhandled command) stacked a fresh toast. Guard explicitly so this
        // is treated exactly like any other rejected receipt: one
        // `showError` call, one thrown `MutationReceiptRejectedError`, no
        // `receipts.error` toast pile-up.
        if (receipt == null) {
          settleCommandId(operation);
          showError(fallbackMessage);
          throw new MutationReceiptRejectedError(fallbackMessage);
        }
        if (
          publishCommitted ||
          receipt.status !== "committed" ||
          receipt.value == null ||
          receipt.replayed
        ) {
          receipts.mutation(receipt);
        }
        settleCommandId(operation);
        if (receipt.status !== "committed" || receipt.value == null) {
          const message =
            receipt.error_detail?.trim() ||
            receipt.summary.trim() ||
            fallbackMessage;
          showError(message);
          throw new MutationReceiptRejectedError(message);
        }

        const next = receipt.value;
        if (
          mutationRevision.current === mutationAtStart &&
          eventRevision.current === eventsAtStart &&
          blockAtStart != null &&
          snapRef.current?.block_id === blockAtStart
        ) {
          applySnapshot(next);
        }
        return next;
      } catch (cause) {
        if (cause instanceof MutationReceiptRejectedError) throw cause;
        const message = commandErrorMessage(cause, fallbackMessage);
        showError(message);
        if (!isBrowserDevUnavailable(cause)) receipts.error(cause, message);
        // Transport uncertainty deliberately retains the command id so the same
        // exact user action can be retried without a second native write.
        throw cause;
      }
    },
    [
      applySnapshot,
      clearError,
      commandId,
      receipts,
      settleCommandId,
      showError,
    ],
  );

  // Mount: subscribe to the event bus FIRST, then the one-time initial fetch.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    let eventArrived = false;
    (async () => {
      try {
        const un = await listen<RepSnapshot | null>("rep://state", (e) => {
          eventArrived = true;
          if (alive) {
            eventRevision.current += 1;
            applySnapshot(
              e.payload ?? null,
              pendingAttemptCommands.current === 0,
            );
          }
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — successful command returns still drive
        // authoritative state; rejected commands never change the snapshot.
      }
      try {
        const s = await executeCommand(REP_STATE, undefined);
        if (alive && !eventArrived) applySnapshot(s ?? null);
      } catch (cause) {
        if (alive && !isBrowserDevUnavailable(cause)) {
          const message = commandErrorMessage(
            cause,
            "The current practice set could not be restored safely.",
          );
          showError(message);
          receipts.error(cause, message);
        }
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [applySnapshot, receipts, showError]);

  // The rep engine and metronome are independent native state machines. Keep
  // an authoritative metronome snapshot plus a revision so a delayed practice
  // command can never overwrite a newer manual/voice metronome action.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    let eventArrived = false;
    (async () => {
      try {
        const un = await listen<MetroState>("metro://state", (event) => {
          eventArrived = true;
          if (alive) {
            metroRevision.current += 1;
            metroRef.current = event.payload;
            metroReadiness.resolve();
          }
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // Plain browser development has no event bus.
      }
      try {
        const state = await executeCommand(METRO_STATE, undefined);
        if (alive && state && !eventArrived) {
          metroRef.current = state;
        }
      } catch {
        // Without an authoritative metronome state, practice commands simply
        // skip automatic start/retune; manual metronome control still owns it.
      } finally {
        metroReadiness.resolve();
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
      metroReadiness.resolve();
    };
  }, [metroReadiness]);

  const open = useCallback(
    async (args: RepOpenArgs, context?: SetFocusContextInput | null) => {
      clearError();
      const eventsAtStart = eventRevision.current;
      const metroAtStart = captureMetroCommandGuard(metroRevision.current);
      let openedBlockId: number | null = null;
      try {
        const s = await executeCommand(REP_OPEN, {
          args,
          context: context ?? null,
        });
        openedBlockId = s.block_id;
        const noNewerEvent = eventRevision.current === eventsAtStart;
        // A rep_open return is only the no-event-bus fallback. In native use,
        // an opened event can already have been followed by a same-block voice
        // attempt; applying the older zero-attempt return would erase it.
        if (noNewerEvent) applySnapshot(s);
        receipts.committed(
          `Practice set opened for measures ${s.m_start}–${s.m_end}.`,
        );
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The practice set could not be opened.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      }

      if (metroRef.current == null) await metroReadiness.promise;
      const current = snapRef.current;
      const metro = metroRef.current;
      const setId = current?.block_id ?? null;
      const authoritativeStartBpm =
        metro != null &&
        metroCommandGuardIsCurrent(metroAtStart, metroRevision.current) &&
        current != null &&
        current.block_id === openedBlockId &&
        current.set_state === "active" &&
        current.use_metronome
          ? current.bpm
          : null;
      if (authoritativeStartBpm != null && setId != null) {
        try {
          if (metro?.running === true) {
            if (metro.bpm !== authoritativeStartBpm) {
              await executeCommand(METRO_SET, {
                setId,
                bpm: authoritativeStartBpm,
                beatsPerBar: current?.tuning?.beats_per_bar,
                subdivision: current?.tuning?.subdivision,
              });
            }
          } else {
            await executeCommand(METRO_START, {
              setId,
              bpm: authoritativeStartBpm,
              beatsPerBar: current?.tuning?.beats_per_bar,
              subdivision: current?.tuning?.subdivision,
            });
          }
        } catch (cause) {
          const message = commandErrorMessage(
            cause,
            "The set opened, but the metronome could not be started.",
          );
          showError(message);
          receipts.error(cause, message);
        }
      }
    },
    [applySnapshot, clearError, metroReadiness, receipts, showError],
  );

  const check = useCallback(
    async (verdict: Verdict, note?: string | null) => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      const eventsAtStart = eventRevision.current;
      const metroAtStart = captureMetroCommandGuard(metroRevision.current);
      const mutationAtStart = mutationRevision.current + 1;
      mutationRevision.current = mutationAtStart;
      const operation = `rep-check:${blockAtStart ?? "none"}:${verdict}:${note ?? ""}`;
      const id = commandId(operation);
      pendingAttemptCommands.current += 1;
      try {
        const outcome = await executeCommand(REP_CHECK, {
          verdict,
          note: note ?? null,
          commandId: id,
        });
        // The native event normally arrives first, but the returned committed
        // snapshot is also enough to update and receipt the write when the
        // event bus is unavailable. The operation key prevents a duplicate.
        applyReturnedSnapshot(
          outcome.snap,
          blockAtStart,
          eventsAtStart,
          mutationAtStart,
        );
        settleCommandId(operation);
        publishAttemptReceipt(outcome.snap, verdict, outcome.receipt);
        await retuneIfCurrent(
          outcome,
          blockAtStart,
          mutationAtStart,
          metroAtStart,
        );
        // The authoritative `rep://state` event reconciles snap + feed.
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The attempt could not be saved.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      } finally {
        pendingAttemptCommands.current = Math.max(
          0,
          pendingAttemptCommands.current - 1,
        );
      }
    },
    [
      applyReturnedSnapshot,
      clearError,
      commandId,
      publishAttemptReceipt,
      receipts,
      retuneIfCurrent,
      settleCommandId,
      showError,
    ],
  );

  const undo = useCallback(async () => {
    clearError();
    const blockAtStart = snapRef.current?.block_id ?? null;
    const attemptOrdinal =
      snapRef.current == null ? null : repTries(snapRef.current);
    const eventsAtStart = eventRevision.current;
    const metroAtStart = captureMetroCommandGuard(metroRevision.current);
    const mutationAtStart = mutationRevision.current + 1;
    mutationRevision.current = mutationAtStart;
    try {
      const outcome = await executeCommand(REP_UNDO, undefined);
      applyReturnedSnapshot(
        outcome.snap,
        blockAtStart,
        eventsAtStart,
        mutationAtStart,
      );
      await retuneIfCurrent(
        outcome,
        blockAtStart,
        mutationAtStart,
        metroAtStart,
      );
      receipts.undone(
        attemptOrdinal == null
          ? "Latest attempt undone."
          : `Attempt ${attemptOrdinal} undone.`,
      );
    } catch (cause) {
      const message = commandErrorMessage(
        cause,
        "The latest attempt could not be undone.",
      );
      showError(message);
      receipts.error(cause, message);
      throw cause;
    }
  }, [applyReturnedSnapshot, clearError, receipts, retuneIfCurrent, showError]);

  const correct = useCallback(
    async (
      attemptId: number | null,
      verdict: Verdict,
      note?: string | null,
    ) => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      const eventsAtStart = eventRevision.current;
      const metroAtStart = captureMetroCommandGuard(metroRevision.current);
      const mutationAtStart = mutationRevision.current + 1;
      mutationRevision.current = mutationAtStart;
      try {
        const replaceNote = note !== undefined;
        const outcome = await executeCommand(REP_CORRECT, {
          attemptId,
          verdict,
          note: note ?? null,
          replaceNote,
        });
        applyReturnedSnapshot(
          outcome.snap,
          blockAtStart,
          eventsAtStart,
          mutationAtStart,
        );
        await retuneIfCurrent(
          outcome,
          blockAtStart,
          mutationAtStart,
          metroAtStart,
        );
        receipts.committed(`Latest attempt corrected — ${verdict}.`);
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The latest attempt could not be corrected.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      }
    },
    [applyReturnedSnapshot, clearError, receipts, retuneIfCurrent, showError],
  );

  const reverseAdjustment = useCallback(
    async (adjustmentId: number) => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      const eventsAtStart = eventRevision.current;
      const metroAtStart = captureMetroCommandGuard(metroRevision.current);
      const mutationAtStart = mutationRevision.current + 1;
      mutationRevision.current = mutationAtStart;
      try {
        const outcome = await executeCommand(REP_ADJUSTMENT_REVERSE, {
          adjustmentId,
        });
        applyReturnedSnapshot(
          outcome.snap,
          blockAtStart,
          eventsAtStart,
          mutationAtStart,
        );
        await retuneIfCurrent(
          outcome,
          blockAtStart,
          mutationAtStart,
          metroAtStart,
        );
        receipts.undone("Latest adjustment reversed.");
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The latest adjustment could not be reversed.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      }
    },
    [applyReturnedSnapshot, clearError, receipts, retuneIfCurrent, showError],
  );

  const restart = useCallback(
    async (requiredCleanStreak?: number | null) => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      const eventsAtStart = eventRevision.current;
      const metroAtStart = captureMetroCommandGuard(metroRevision.current);
      const mutationAtStart = mutationRevision.current + 1;
      mutationRevision.current = mutationAtStart;
      try {
        const next = await executeCommand(REP_RESTART, {
          requiredCleanStreak: requiredCleanStreak ?? null,
        });
        // Restart may return a new block id. When the event bus is silent, the
        // result is accepted only while the set that initiated it remains open.
        if (
          mutationRevision.current === mutationAtStart &&
          eventRevision.current === eventsAtStart &&
          snapRef.current?.block_id === blockAtStart
        ) {
          applySnapshot(next);
        }
        receipts.committed(
          "Practice set restarted. The previous attempts remain in history.",
        );

        // Restart creates a new authoritative set at its original start tempo.
        // Keep the click aligned with that fresh state, but only while no newer
        // rep mutation/event or manual/voice metronome command has taken ownership.
        if (metroRef.current == null) await metroReadiness.promise;
        const current = snapRef.current;
        const restartIsCurrent =
          mutationRevision.current === mutationAtStart &&
          metroCommandGuardIsCurrent(metroAtStart, metroRevision.current) &&
          current != null &&
          current.block_id === next.block_id &&
          sameRepProjection(current, next);
        const bpm = next.bpm ?? next.start_bpm;
        if (
          restartIsCurrent &&
          blockAtStart != null &&
          current.use_metronome &&
          current.set_state === "active" &&
          Number.isFinite(bpm)
        ) {
          try {
            await executeCommand(METRO_RESTART, {
              oldSetId: blockAtStart,
              newSetId: next.block_id,
              bpm,
              beatsPerBar: next.tuning?.beats_per_bar,
              subdivision: next.tuning?.subdivision,
            });
          } catch (cause) {
            const message = commandErrorMessage(
              cause,
              "The set restarted, but the metronome could not be synchronized.",
            );
            showError(message);
            receipts.error(cause, message);
          }
        }
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The practice set could not be restarted.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      }
    },
    [applySnapshot, clearError, metroReadiness, receipts, showError],
  );

  const pause = useCallback(async () => {
    const blockAtStart = snapRef.current?.block_id ?? null;
    const metroAtStart = captureMetroCommandGuard(metroRevision.current);
    const next = await runSnapshotReceiptMutation(
      `rep-pause:${snapRef.current?.block_id ?? "none"}`,
      "The practice timer could not be paused.",
      (id) => executeCommand(REP_PAUSE, { commandId: id }),
    );
    if (
      blockAtStart != null &&
      next.block_id === blockAtStart &&
      snapRef.current?.block_id === blockAtStart &&
      next.use_metronome &&
      metroCommandGuardIsCurrent(metroAtStart, metroRevision.current)
    ) {
      try {
        await executeCommand(METRO_PAUSE, { setId: blockAtStart });
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "Practice paused, but the metronome could not be synchronized.",
        );
        showError(message);
        receipts.error(cause, message);
      }
    }
  }, [receipts, runSnapshotReceiptMutation, showError]);

  const resume = useCallback(async () => {
    const blockAtStart = snapRef.current?.block_id ?? null;
    const metroAtStart = captureMetroCommandGuard(metroRevision.current);
    const next = await runSnapshotReceiptMutation(
      `rep-resume:${snapRef.current?.block_id ?? "none"}`,
      "The practice timer could not be resumed.",
      (id) => executeCommand(REP_RESUME, { commandId: id }),
    );
    const bpm = next.bpm ?? next.start_bpm;
    if (
      blockAtStart != null &&
      next.block_id === blockAtStart &&
      snapRef.current?.block_id === blockAtStart &&
      next.use_metronome &&
      Number.isFinite(bpm) &&
      metroCommandGuardIsCurrent(metroAtStart, metroRevision.current)
    ) {
      try {
        await executeCommand(METRO_RESUME, {
          setId: blockAtStart,
          bpm,
          beatsPerBar: next.tuning?.beats_per_bar,
          subdivision: next.tuning?.subdivision,
        });
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "Practice resumed, but the metronome could not be synchronized.",
        );
        showError(message);
        receipts.error(cause, message);
      }
    }
  }, [receipts, runSnapshotReceiptMutation, showError]);

  const checkpoint = useCallback(async () => {
    await runSnapshotReceiptMutation(
      `rep-checkpoint:${snapRef.current?.block_id ?? "none"}`,
      "Focused time could not be checkpointed.",
      (id) => executeCommand(REP_CHECKPOINT, { commandId: id }),
      false,
    );
  }, [runSnapshotReceiptMutation]);

  const reflect = useCallback(
    async (rawReflection: string) => {
      const reflection = rawReflection.trim();
      if (!reflection) throw new Error("Reflection cannot be empty.");
      await runSnapshotReceiptMutation(
        `rep-reflect:${snapRef.current?.block_id ?? "none"}:${reflection}`,
        "The set reflection could not be saved.",
        (id) => executeCommand(REP_REFLECT, { commandId: id, reflection }),
      );
    },
    [runSnapshotReceiptMutation],
  );

  const safetyStop = useCallback(
    async (rawReason?: string | null) => {
      const reason = rawReason?.trim() || null;
      await runSnapshotReceiptMutation(
        `rep-safety-stop:${snapRef.current?.block_id ?? "none"}:${reason ?? "unspecified"}`,
        "The safety stop could not be saved.",
        (id) => executeCommand(REP_SAFETY_STOP, { commandId: id, reason }),
      );
    },
    [runSnapshotReceiptMutation],
  );

  const recover = useCallback(
    async (action: RecoveryActionRequest) => {
      await runSnapshotReceiptMutation(
        `rep-recovery:${snapRef.current?.block_id ?? "none"}:${JSON.stringify(action)}`,
        "The recovery choice could not be saved.",
        (id) => executeCommand(REP_RECOVERY, { commandId: id, action }),
      );
    },
    [runSnapshotReceiptMutation],
  );

  // Persist short focused intervals without counting pauses or relaunch gaps.
  // Checkpoints are technical durability writes, so successful ones stay quiet;
  // rejection remains visible through the shared error/receipt path.
  useEffect(() => {
    const blockId = snap?.block_id;
    const timing =
      snap?.timer_state ?? (snap?.set_state === "active" ? "active" : "paused");
    if (blockId == null || timing !== "active") return;
    const persist = () => {
      void checkpoint().catch(() => undefined);
    };
    const timer = window.setInterval(persist, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkpoint, snap?.block_id, snap?.set_state, snap?.timer_state]);

  const close = useCallback(async () => {
    clearError();
    const blockAtStart = snapRef.current?.block_id ?? null;
    const metroAtStart = captureMetroCommandGuard(metroRevision.current);
    const usedMetronome = snapRef.current?.use_metronome === true;
    const eventsAtStart = eventRevision.current;
    const mutationAtStart = mutationRevision.current + 1;
    mutationRevision.current = mutationAtStart;
    try {
      // Native rep_close returns the just-closed snapshot for its receipt while
      // emitting `null` as the active-state event. In eventless/browser tests,
      // the successful return must therefore still clear the active HUD.
      await executeCommand(REP_CLOSE, undefined);
      const current = snapRef.current;
      if (
        mutationRevision.current === mutationAtStart &&
        (current == null ||
          (eventRevision.current === eventsAtStart &&
            current.block_id === blockAtStart))
      ) {
        applySnapshot(null);
      }
      receipts.committed("Practice set closed.");
      if (
        blockAtStart != null &&
        usedMetronome &&
        metroCommandGuardIsCurrent(metroAtStart, metroRevision.current)
      ) {
        try {
          await executeCommand(METRO_CLOSE, { setId: blockAtStart });
        } catch (cause) {
          const message = commandErrorMessage(
            cause,
            "The set closed, but the metronome could not be synchronized.",
          );
          showError(message);
          receipts.error(cause, message);
        }
      }
    } catch (cause) {
      const message = commandErrorMessage(
        cause,
        "The practice set could not be closed.",
      );
      showError(message);
      receipts.error(cause, message);
    }
  }, [applySnapshot, clearError, receipts, showError]);

  // Fix wave item 10: the paused-sets tray resumes through its OWN direct
  // `rep_resume` call (pausedSets.ts's `resumePausedSet`), not through this
  // hook's `resume()` — so the receipt it gets back never otherwise reaches
  // `applySnapshot`, and the rep panel kept showing the pre-resume "· paused"
  // state until an unrelated event happened to refresh it. This applies that
  // receipt through the exact same seam `resume()`/every other mutation here
  // uses, so there is one snapshot-of-record, not a second copy.
  const applyExternalReceipt = useCallback(
    (receipt: MutationReceipt<RepSnapshot>) => {
      if (receipt.status === "committed" && receipt.value != null) {
        applySnapshot(receipt.value);
      }
    },
    [applySnapshot],
  );

  // Residuals fix wave (defect 3): overlay the ticking `active_seconds` onto
  // the returned snapshot — `elapsedTick` (bumped once a second while the
  // anchor is live) is this render's only reason to recompute it. Everything
  // BUT `active_seconds` still comes straight from the authoritative `snap`;
  // this is a display-only derivation, never written back to `snapRef`/state,
  // so it can never itself become the "prev" a future `applySnapshot` diffs
  // against.
  void elapsedTick;
  const anchor = activeSecondsAnchor.current;
  const displaySnap: RepSnapshot | null = snap
    ? {
        ...snap,
        active_seconds: anchor.ticking
          ? anchor.base +
            Math.max(0, Math.floor((Date.now() - anchor.at) / 1000))
          : (snap.active_seconds ?? anchor.base),
      }
    : null;

  return {
    snap: displaySnap,
    feed,
    error,
    clearError,
    open,
    check,
    undo,
    correct,
    reverseAdjustment,
    restart,
    pause,
    resume,
    checkpoint,
    reflect,
    safetyStop,
    recover,
    close,
    applyExternalReceipt,
  };
}
