import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commandErrorMessage,
  defineCommand,
  executeCommand,
} from "../../services/command";
import { useReceipts } from "../receipts/ReceiptCenter";

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
// snapshots — whenever `reps_done` advances we push the snapshot's `last` rep —
// so voice-driven and button-driven checks both appear in the feed.
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
  bpm: number;
}

export interface IncrementRule {
  clean_needed: number;
  bpm_step: number;
}

export interface VariantSpec {
  name: string;
  reps: number;
}

/** Mirrors the backend `RepSnapshot` serde payload (snake_case). */
export interface RepSnapshot {
  block_id: number;
  piece_id: number;
  piece_title: string;
  m_start: number;
  m_end: number;
  label: string | null;
  bpm: number;
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
}

/** Mirrors the backend `CheckOutcome` serde payload. */
export interface CheckOutcome {
  snap: RepSnapshot;
  new_bpm: number | null;
  block_done: boolean;
  say: string;
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
  increment: IncrementRule | null;
  variants: VariantSpec[];
  focus: string;
  use_metronome: boolean;
}

/** Verdict strings accepted by `rep_check`. */
export type Verdict = "clean" | "flawed" | "failed";

const FEED_MAX = 5;
const REP_STATE = defineCommand<undefined, RepSnapshot | null>(
  "rep_state",
  "The current practice block could not be loaded.",
);
const REP_OPEN = defineCommand<{ args: RepOpenArgs }, RepSnapshot>(
  "rep_open",
  "The practice block could not be opened.",
);
const REP_CHECK = defineCommand<
  { verdict: Verdict; note: string | null },
  CheckOutcome
>("rep_check", "The attempt could not be saved.");
const REP_CLOSE = defineCommand<undefined, RepSnapshot | null>(
  "rep_close",
  "The practice block could not be closed.",
);
const METRO_START = defineCommand<{ bpm: number }, unknown>(
  "metro_start",
  "The block opened, but the metronome could not be started.",
);
const METRO_SET = defineCommand<{ bpm: number }, unknown>(
  "metro_set",
  "The attempt saved, but the metronome tempo could not be updated.",
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
  open: (args: RepOpenArgs) => Promise<void>;
  /** Record a verdict (same path as a voice ack). */
  check: (verdict: Verdict, note?: string | null) => Promise<void>;
  /** Close the active block. */
  close: () => Promise<void>;
}

export function useRep(): UseRep {
  const [snap, setSnap] = useState<RepSnapshot | null>(null);
  const [feed, setFeed] = useState<LastRep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const receipts = useReceipts();

  const snapRef = useRef<RepSnapshot | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announcedAttempts = useRef(new Set<string>());
  const eventRevision = useRef(0);

  const publishAttemptReceipt = useCallback(
    (next: RepSnapshot, fallbackVerdict?: Verdict) => {
      const verdict = next.last?.verdict ?? fallbackVerdict;
      if (!verdict || next.reps_done < 1) return;
      const key = `${next.block_id}:${next.reps_done}`;
      if (announcedAttempts.current.has(key)) return;
      announcedAttempts.current.add(key);
      if (announcedAttempts.current.size > 100) {
        const oldest = announcedAttempts.current.values().next().value;
        if (oldest) announcedAttempts.current.delete(oldest);
      }
      receipts.committed(`Attempt ${next.reps_done} saved — ${verdict}.`);
    },
    [receipts],
  );

  // Apply an authoritative snapshot and maintain the derived verdict feed. The
  // feed resets when the block changes (or clears) and grows by one whenever
  // `reps_done` advances — capturing both voice- and button-driven checks.
  const applySnapshot = useCallback((
    next: RepSnapshot | null,
    announceCommittedAttempt = false,
  ) => {
    const prev = snapRef.current;
    if (next == null) {
      setFeed([]);
    } else if (!prev || prev.block_id !== next.block_id) {
      setFeed(next.last ? [next.last] : []);
    } else if (next.reps_done > prev.reps_done && next.last) {
      const last = next.last;
      setFeed((f) => [last, ...f].slice(0, FEED_MAX));
      if (announceCommittedAttempt) publishAttemptReceipt(next);
    }
    snapRef.current = next;
    setSnap(next);
  }, [publishAttemptReceipt]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4500);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(null);
  }, []);

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
            applySnapshot(e.payload ?? null, true);
          }
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — actions still drive the UI optimistically.
      }
      try {
        const s = await executeCommand(REP_STATE, undefined);
        if (alive && !eventArrived) applySnapshot(s ?? null);
      } catch {
        // Backend absent (plain `vite` browser dev) — keep the empty state.
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [applySnapshot]);

  const open = useCallback(
    async (args: RepOpenArgs) => {
      clearError();
      const eventsAtStart = eventRevision.current;
      let remainsActive = false;
      try {
        const s = await executeCommand(REP_OPEN, { args });
        remainsActive = (
          eventRevision.current === eventsAtStart
          || snapRef.current?.block_id === s.block_id
        );
        if (remainsActive) applySnapshot(s);
        receipts.committed(
          `Practice block opened for measures ${s.m_start}–${s.m_end}.`,
        );
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The practice block could not be opened.",
        );
        showError(message);
        receipts.error(cause, message);
        throw cause;
      }

      if (remainsActive && args.use_metronome && args.start_bpm != null) {
        try {
          await executeCommand(METRO_START, { bpm: args.start_bpm });
        } catch (cause) {
          const message = commandErrorMessage(
            cause,
            "The block opened, but the metronome could not be started.",
          );
          showError(message);
          receipts.error(cause, message);
        }
      }
    },
    [applySnapshot, clearError, receipts, showError],
  );

  const check = useCallback(
    async (verdict: Verdict, note?: string | null) => {
      clearError();
      const blockAtStart = snapRef.current?.block_id ?? null;
      try {
        const outcome = await executeCommand(REP_CHECK, {
          verdict,
          note: note ?? null,
        });
        // The native event normally arrives first, but the returned committed
        // snapshot is also enough to update and receipt the write when the
        // event bus is unavailable. The operation key prevents a duplicate.
        const current = snapRef.current;
        if (
          blockAtStart === outcome.snap.block_id
          && current?.block_id === blockAtStart
          && outcome.snap.reps_done >= current.reps_done
        ) {
          applySnapshot(outcome.snap);
        }
        publishAttemptReceipt(outcome.snap, verdict);
        if (
          outcome?.new_bpm != null
          && outcome.snap.use_metronome
          && blockAtStart === snapRef.current?.block_id
        ) {
          try {
            await executeCommand(METRO_SET, { bpm: outcome.new_bpm });
          } catch (cause) {
            const message = commandErrorMessage(
              cause,
              "The attempt saved, but the metronome tempo could not be updated.",
            );
            showError(message);
            receipts.error(cause, message);
          }
        }
        // The authoritative `rep://state` event reconciles snap + feed.
      } catch (cause) {
        const message = commandErrorMessage(
          cause,
          "The attempt could not be saved.",
        );
        showError(message);
        receipts.error(cause, message);
      }
    },
    [applySnapshot, clearError, publishAttemptReceipt, receipts, showError],
  );

  const close = useCallback(async () => {
    clearError();
    const eventsAtStart = eventRevision.current;
    try {
      const s = await executeCommand(REP_CLOSE, undefined);
      const current = snapRef.current;
      if (
        eventRevision.current === eventsAtStart
        || (s == null && current == null)
        || (s != null && current?.block_id === s.block_id)
      ) {
        applySnapshot(s ?? null);
      }
      receipts.committed("Practice block closed.");
    } catch (cause) {
      const message = commandErrorMessage(
        cause,
        "The practice block could not be closed.",
      );
      showError(message);
      receipts.error(cause, message);
    }
  }, [applySnapshot, clearError, receipts, showError]);

  return { snap, feed, error, clearError, open, check, close };
}
