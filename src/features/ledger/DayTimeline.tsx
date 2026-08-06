import { useCallback, useEffect, useMemo, useState } from "react";
import { commandErrorMessage } from "../../services/command";
import {
  addDays,
  dayLabel,
  parseLocalDate,
  todayLocal,
} from "../calendar/dates";
import {
  historyDays,
  historyDayDetail,
  type HistoryDayDetail,
  type HistoryDaySummary,
} from "./historyDays";
import "./dayTimeline.css";

/** Initial fetch window: today back 120 days. */
const INITIAL_WINDOW_DAYS = 120;
/** How many further days "Earlier days" pulls the window back by, once the
 * already-fetched days are exhausted. */
const EXTEND_WINDOW_DAYS = 120;
/** How many evidence-days are revealed per page. */
const PAGE_SIZE = 21;
/** The backend's hard cap (`history_days.rs::MAX_RANGE_DAYS`) — mirrored here
 * so the "Earlier days" control never requests a range the server will 400. */
const MAX_WINDOW_DAYS = 400;

function windowSpanDays(from: string, to: string): number {
  const ms = parseLocalDate(to).getTime() - parseLocalDate(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** The later (more recent) of two `YYYY-MM-DD` local dates — plain string
 * comparison is valid because the format is zero-padded and lexicographic. */
function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Card header, exactly: "Wed · Aug 6 — 42 min · Scherzo No. 2 · 3 sets · 2
 * mastered" — piece list truncated to 2 titles + "+N". */
export function formatDayHeader(day: HistoryDaySummary): string {
  const { weekday, date } = dayLabel(day.date);
  const minutes = Math.round(day.focused_seconds / 60);
  const titles = day.pieces.map((piece) => piece.title);
  const shown = titles.slice(0, 2);
  const extra = titles.length - shown.length;
  const pieceList = shown.join(", ") + (extra > 0 ? ` +${extra}` : "");
  const sets = `${day.sets_touched} set${day.sets_touched === 1 ? "" : "s"}`;
  const mastered = `${day.mastered_sets} mastered`;
  return `${weekday} · ${date} — ${minutes} min · ${pieceList} · ${sets} · ${mastered}`;
}

function formatClock(ts: string | null): string {
  if (!ts) return "ongoing";
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

interface DayCardProps {
  day: HistoryDaySummary;
  expanded: boolean;
  detail: HistoryDayDetail | undefined;
  detailLoading: boolean;
  detailError: string | null;
  onToggle: (date: string) => void;
}

function DayCard({
  day,
  expanded,
  detail,
  detailLoading,
  detailError,
  onToggle,
}: DayCardProps) {
  const detailId = `day-detail-${day.date}`;
  return (
    <li className="day-card" data-testid={`day-card-${day.date}`}>
      <button
        type="button"
        className="day-card-toggle"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => onToggle(day.date)}
      >
        <span className="day-card-header">{formatDayHeader(day)}</span>
        <span className="day-card-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div id={detailId} className="day-card-detail">
          {detailLoading ? (
            <p role="status">Loading day…</p>
          ) : detailError ? (
            <p className="ck-inline-error" role="alert">
              {detailError}
            </p>
          ) : detail ? (
            <>
              {detail.sessions.length > 0 && (
                <ul className="day-card-sessions">
                  {detail.sessions.map((session) => (
                    <li key={session.session_id}>
                      {formatClock(session.started_at)}–
                      {formatClock(session.ended_at)} ·{" "}
                      {Math.round(session.focused_seconds / 60)} min
                    </li>
                  ))}
                </ul>
              )}
              {detail.sets.length > 0 ? (
                <ul className="day-card-sets">
                  {detail.sets.map((set) => (
                    <li key={set.block_id} className="day-card-set">
                      <strong className="ck-fit">{set.piece_title}</strong>
                      {set.region_name && (
                        <span className="ck-fit"> · {set.region_name}</span>
                      )}
                      <span>
                        {" "}
                        mm. {set.m_start}–{set.m_end} · {set.attempts} attempt
                        {set.attempts === 1 ? "" : "s"}, {set.cleans} clean ·{" "}
                        {set.start_bpm}→{set.end_bpm} bpm · {set.mastery_status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="day-card-empty">No sets recorded.</p>
              )}
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function DayTimeline() {
  const today = useMemo(() => todayLocal(), []);
  const [windowFrom, setWindowFrom] = useState(() =>
    addDays(today, -(INITIAL_WINDOW_DAYS - 1)),
  );
  const [windowTo] = useState(today);
  const [days, setDays] = useState<HistoryDaySummary[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, HistoryDayDetail>>(
    new Map(),
  );
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Map<string, string>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    historyDays(windowFrom, windowTo)
      .then((result) => {
        if (cancelled) return;
        setDays(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setDays([]);
        setError(
          commandErrorMessage(reason, "Practice history could not be loaded."),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only the initial mount fetches windowFrom/windowTo — later extensions
    // are driven explicitly by handleEarlierDays, not by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEarlierDays = useCallback(async () => {
    if (visibleCount < days.length) {
      setVisibleCount((count) => Math.min(count + PAGE_SIZE, days.length));
      return;
    }
    const currentSpan = windowSpanDays(windowFrom, windowTo);
    if (currentSpan >= MAX_WINDOW_DAYS) return;
    const floor = addDays(windowTo, -(MAX_WINDOW_DAYS - 1));
    const nextFrom = laterDate(addDays(windowFrom, -EXTEND_WINDOW_DAYS), floor);
    setLoadingMore(true);
    setError(null);
    try {
      const nextDays = await historyDays(nextFrom, windowTo);
      setWindowFrom(nextFrom);
      setDays(nextDays);
      setVisibleCount((count) =>
        Math.min(count + PAGE_SIZE, nextDays.length || count + PAGE_SIZE),
      );
    } catch (reason) {
      setError(
        commandErrorMessage(
          reason,
          "Earlier practice history could not be loaded.",
        ),
      );
    } finally {
      setLoadingMore(false);
    }
  }, [days.length, visibleCount, windowFrom, windowTo]);

  const handleToggle = useCallback(
    (date: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(date)) next.delete(date);
        else next.add(date);
        return next;
      });
      // Disclosure-first: never prefetch. Fetch once on first expand; a
      // cached detail (or an in-flight fetch) is never re-requested.
      if (details.has(date) || detailLoading.has(date)) return;
      setDetailLoading((prev) => new Set(prev).add(date));
      historyDayDetail(date)
        .then((detail) => {
          setDetails((prev) => new Map(prev).set(date, detail));
        })
        .catch((reason) => {
          setDetailErrors((prev) =>
            new Map(prev).set(
              date,
              commandErrorMessage(reason, "That day could not be loaded."),
            ),
          );
        })
        .finally(() => {
          setDetailLoading((prev) => {
            const next = new Set(prev);
            next.delete(date);
            return next;
          });
        });
    },
    [detailLoading, details],
  );

  const visibleDays = days.slice(0, visibleCount);
  const hasMoreFetchedDays = visibleCount < days.length;
  const canExtendWindow =
    windowSpanDays(windowFrom, windowTo) < MAX_WINDOW_DAYS;
  const showEarlierButton = !loading && (hasMoreFetchedDays || canExtendWindow);
  const showEndOfHistory = !loading && !hasMoreFetchedDays && !canExtendWindow;

  return (
    <section className="day-timeline" aria-label="History day timeline">
      {loading ? (
        <p role="status">Reading practice history…</p>
      ) : error ? (
        <p className="ledger-error" role="alert">
          {error}
        </p>
      ) : days.length === 0 ? (
        <p className="day-timeline-empty">No practice evidence recorded yet.</p>
      ) : (
        <ul className="day-timeline-list">
          {visibleDays.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              expanded={expanded.has(day.date)}
              detail={details.get(day.date)}
              detailLoading={detailLoading.has(day.date)}
              detailError={detailErrors.get(day.date) ?? null}
              onToggle={handleToggle}
            />
          ))}
        </ul>
      )}
      {showEarlierButton && (
        <button
          type="button"
          className="day-timeline-earlier"
          onClick={() => void handleEarlierDays()}
          disabled={loadingMore}
        >
          {loadingMore ? "Reaching back…" : "Earlier days"}
        </button>
      )}
      {showEndOfHistory && (
        <p className="day-timeline-end">You’ve reached the end of history.</p>
      )}
    </section>
  );
}
