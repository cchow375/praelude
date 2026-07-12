import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

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

  const snapRef = useRef<RepSnapshot | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Apply an authoritative snapshot and maintain the derived verdict feed. The
  // feed resets when the block changes (or clears) and grows by one whenever
  // `reps_done` advances — capturing both voice- and button-driven checks.
  const applySnapshot = useCallback((next: RepSnapshot | null) => {
    const prev = snapRef.current;
    if (next == null) {
      setFeed([]);
    } else if (!prev || prev.block_id !== next.block_id) {
      setFeed(next.last ? [next.last] : []);
    } else if (next.reps_done > prev.reps_done && next.last) {
      const last = next.last;
      setFeed((f) => [last, ...f].slice(0, FEED_MAX));
    }
    snapRef.current = next;
    setSnap(next);
  }, []);

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
          if (alive) applySnapshot(e.payload ?? null);
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — actions still drive the UI optimistically.
      }
      try {
        const s = await invoke<RepSnapshot | null>("rep_state");
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
      try {
        const s = await invoke<RepSnapshot>("rep_open", { args });
        if (s) applySnapshot(s);
      } catch (e) {
        showError(messageOf(e));
      }
    },
    [applySnapshot, showError],
  );

  const check = useCallback(
    async (verdict: Verdict, note?: string | null) => {
      try {
        await invoke("rep_check", { verdict, note: note ?? null });
        // The authoritative `rep://state` event reconciles snap + feed.
      } catch (e) {
        showError(messageOf(e));
      }
    },
    [showError],
  );

  const close = useCallback(async () => {
    try {
      const s = await invoke<RepSnapshot | null>("rep_close");
      applySnapshot(s ?? null);
    } catch (e) {
      showError(messageOf(e));
    }
  }, [applySnapshot, showError]);

  return { snap, feed, error, clearError, open, check, close };
}
