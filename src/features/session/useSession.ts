import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commandErrorMessage,
  defineCommand,
  executeCommand,
} from "../../services/command";
import { useReceipts } from "../receipts/ReceiptCenter";

// ---------------------------------------------------------------------------
// Practice-session hook.
//
// The Rust backend (src-tauri/src/sessions) owns the current session. It emits
// a `session://event` for every logged event (payload: a single
// `SessionEventView`) and exposes `session_current` (snapshot) and
// `session_end` (ends the session, writes the summary, appends to the vault).
//
// Subscribe FIRST, then fetch once on mount — the useMetronome ordering, so an
// event emitted during the in-flight fetch is not dropped. Incoming events are
// prepended (the timeline is newest-first, capped at 200 like the backend). If
// an event arrives while we have no session in hand (a session that started
// after mount), we re-fetch `session_current` to bootstrap it.
//
// Command args are camelCase from JS. Event payloads are serde snake_case.
// ---------------------------------------------------------------------------

const EVENTS_MAX = 200;

/** Mirrors a backend `SessionEventView` serde payload. */
export interface SessionEventView {
  ts: string | number;
  kind: string;
  payload: unknown;
}

/** Mirrors the backend `SessionView` serde payload. */
export interface SessionView {
  id: number;
  started_at: string | number;
  events: SessionEventView[];
}

/** Mirrors the backend `ExportResult` serde payload. */
export interface ExportResult {
  session_id: number;
  files: string[];
  pieces: number;
  reps: number;
}

const SESSION_CURRENT = defineCommand<undefined, SessionView | null>(
  "session_current",
  "The current practice session could not be loaded.",
);
const SESSION_END = defineCommand<undefined, ExportResult | null>(
  "session_end",
  "The practice session could not be ended.",
);

export interface UseSession {
  /** The active session, or null when none is running (bar hidden). */
  session: SessionView | null;
  /** Last command rejection, shown as a quiet inline notice. Auto-clears. */
  error: string | null;
  clearError: () => void;
  /** End the current session; rejects without clearing when native export fails. */
  endSession: () => Promise<ExportResult | null>;
}

export function useSession(): UseSession {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receipts = useReceipts();

  const sessionRef = useRef<SessionView | null>(null);
  sessionRef.current = session;
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4500);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(null);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const s = await executeCommand(SESSION_CURRENT, undefined);
      setSession(s ?? null);
    } catch {
      // Backend absent — leave the current state alone.
    }
  }, []);

  // Mount: subscribe to the event bus FIRST, then the one-time initial fetch.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    let eventArrived = false;

    const onEvent = (ev: SessionEventView) => {
      if (!alive) return;
      const cur = sessionRef.current;
      if (!cur) {
        // A session started after mount but we have no snapshot — bootstrap it.
        void refetch();
        return;
      }
      const next: SessionView = {
        ...cur,
        events: [ev, ...cur.events].slice(0, EVENTS_MAX),
      };
      sessionRef.current = next;
      setSession(next);
    };

    (async () => {
      try {
        const un = await listen<SessionEventView>("session://event", (e) => {
          eventArrived = true;
          onEvent(e.payload);
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — snapshot fetch still drives the UI.
      }
      try {
        const s = await executeCommand(SESSION_CURRENT, undefined);
        if (alive && !eventArrived) {
          sessionRef.current = s ?? null;
          setSession(s ?? null);
        }
      } catch {
        // Backend absent — keep the empty state.
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [refetch]);

  const endSession = useCallback(async (): Promise<ExportResult | null> => {
    try {
      const res = await executeCommand(SESSION_END, undefined);
      sessionRef.current = null;
      setSession(null);
      setError(null);
      receipts.committed(
        res
          ? `Session saved: ${res.reps} attempts across ${res.pieces} piece${res.pieces === 1 ? "" : "s"}.`
          : "Practice session ended.",
      );
      return res ?? null;
    } catch (cause) {
      const message = commandErrorMessage(
        cause,
        "The practice session could not be ended.",
      );
      showError(message);
      receipts.error(cause, message);
      throw cause;
    }
  }, [receipts, showError]);

  return { session, error, clearError, endSession };
}
