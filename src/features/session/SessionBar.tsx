import { useEffect, useRef, useState } from "react";
import type { SessionView } from "./useSession";
import "./SessionBar.css";

// ---------------------------------------------------------------------------
// The session bar: a slim, always-available strip (rendered at shell level)
// showing that a practice session is live — a pulsing dot, the elapsed time,
// and the event count. It expands into a newest-first timeline and offers the
// End-session control (which writes the summary and appends to the vault).
// ---------------------------------------------------------------------------

interface SessionBarProps {
  session: SessionView | null;
  onEnd: () => void;
  ending?: boolean;
  blockedReason?: string | null;
}

/** Resolve `started_at` (RFC3339 string or unix number) to epoch millis. */
export function parseStartedAt(v: string | number): number | null {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Format an elapsed span (ms) as H:MM:SS or M:SS. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function eventSummary(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ["verdict", "bpm", "m", "measures", "note", "title"]) {
      if (obj[k] != null && obj[k] !== "") parts.push(String(obj[k]));
    }
    if (parts.length) return parts.join(" · ");
  }
  return "";
}

export function SessionBar({
  session,
  onEnd,
  ending = false,
  blockedReason = null,
}: SessionBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startedRef = useRef<number | null>(null);

  startedRef.current = session ? parseStartedAt(session.started_at) : null;

  // Tick once a second while a session is live so the elapsed clock advances.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  const started = startedRef.current;
  const elapsed = started != null ? formatElapsed(now - started) : "—";
  const count = session.events.length;

  return (
    <div className={`session-bar ${expanded ? "is-expanded" : ""}`}>
      <div className="session-bar-row">
        <button
          type="button"
          className="session-bar-toggle"
          aria-expanded={expanded}
          aria-label={
            expanded ? "Collapse session timeline" : "Expand session timeline"
          }
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="session-dot" aria-hidden="true" />
          <span className="session-elapsed">{elapsed}</span>
          <span className="session-count">
            {count} event{count === 1 ? "" : "s"}
          </span>
          <span className="session-caret" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        <button
          type="button"
          className="session-end"
          onClick={onEnd}
          disabled={ending || Boolean(blockedReason)}
          title={blockedReason ?? undefined}
        >
          {ending ? "Ending…" : "End session"}
        </button>
      </div>

      {/* The helper sentence is a SIBLING of the control row, not a child of a
          width-capped column beside the button. It used to be squeezed into a
          12rem flex column, where it ran underneath the End-session button and
          off the panel edge; on its own full-width line it wraps instead. */}
      {blockedReason && (
        <p className="session-blocked" role="status">
          {blockedReason}
        </p>
      )}

      {expanded && (
        <ul className="session-timeline" aria-label="Session timeline">
          {count === 0 ? (
            <li className="session-timeline-empty">No events yet.</li>
          ) : (
            session.events.map((ev, i) => (
              <li className="session-event" key={i}>
                <span className="session-event-kind">{ev.kind}</span>
                <span className="session-event-detail">
                  {eventSummary(ev.payload)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
