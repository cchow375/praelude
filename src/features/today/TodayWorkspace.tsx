import { useCallback, useEffect, useMemo, useState } from "react";
import { universeSnapshot } from "../universe/api";
import type { PracticePieceContext, UniverseSnapshot } from "../universe/types";
import { todayLocal } from "../calendar/dates";
import { RetentionQueue } from "../retention";
import {
  isStartableTargetRef,
  SessionComposer,
  useComposerCandidates,
  useSessionPlan,
} from "../composer";
import type { RepSnapshot } from "../rep/useRep";
import {
  readTodayPlan,
  TODAY_PLAN_MAX_LENGTH,
  writeTodayPlan,
} from "./todayPlan";
import "./TodayWorkspace.css";

interface TodayWorkspaceProps {
  onOpenAtlas: () => void;
  onOpenCalendar: () => void;
  onOpenPiece: (piece: PracticePieceContext) => void;
  defaultCleanStreak?: number;
  /** The live rep set, sourced from the shell's rep engine, or null when none is
   *  open. A live set blocks starting the next plan item (single-live-set). */
  activeBlock?: RepSnapshot | null;
}

function messageOf(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string"
    ? reason
    : "Today's practice state could not be loaded.";
}

function compactDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function todayLabel(now = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

/**
 * A sourced launch surface, never a synthetic scorecard. It only projects
 * canonical Universe totals and the most recently practiced piece.
 */
export function TodayWorkspace({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiece,
  defaultCleanStreak = 5,
  activeBlock = null,
}: TodayWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const date = todayLocal();
  const [todayPlan, setTodayPlan] = useState(() => readTodayPlan(date));

  // Candidate evidence reloads whenever Today is visible. The reviewed active
  // plan itself is persisted by useSessionPlan so Score/Brain navigation or a
  // relaunch cannot silently discard the remaining sequence.
  const {
    candidates,
    loading: candidatesLoading,
    error: candidatesError,
  } = useComposerCandidates({ active: true, asOfDate: todayLocal() });
  const plan = useSessionPlan();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await universeSnapshot());
    } catch (reason) {
      setSnapshot(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recent = useMemo(() => {
    const pieces = snapshot?.pieces ?? [];
    return (
      [...pieces].sort((left, right) => {
        const a = Date.parse(left.last_practiced ?? "") || 0;
        const b = Date.parse(right.last_practiced ?? "") || 0;
        return b - a;
      })[0] ?? null
    );
  }, [snapshot]);

  return (
    <main className="today-workspace" data-testid="today-workspace">
      <header className="today-masthead ck-reveal-item">
        <p className="today-date">{todayLabel()}</p>
        <h1 aria-label="Make one thing reliable.">
          Make one thing
          <br />
          <em>reliable.</em>
        </h1>
      </header>

      {error && (
        <div className="today-error ck-reveal-item" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      <section
        className="today-intention ck-reveal-item"
        aria-labelledby="today-intention-title"
      >
        <div className="today-intention-copy">
          <p className="ck-kicker">Today's plan</p>
          <h2 id="today-intention-title">What are you here to get done?</h2>
          <p>
            Write the outcome in ordinary language. Coda keeps it with today so
            the Brain can use it as practice context.
          </p>
        </div>
        <label>
          <span className="ck-visually-hidden">Today's plan and intention</span>
          <textarea
            aria-label="Today's plan and intention"
            maxLength={TODAY_PLAN_MAX_LENGTH}
            placeholder="Example: 20 minutes — diagnose page 4, then make the right-hand dotted rhythm reliable at 72."
            value={todayPlan}
            onChange={(event) => {
              const next = writeTodayPlan(date, event.currentTarget.value);
              setTodayPlan(next);
            }}
          />
        </label>
        <p className="today-intention-status" role="status">
          {todayPlan.trim() ? "Saved for today on this Mac." : "Nothing is scheduled by typing here."}
        </p>
      </section>

      <section className="today-board" aria-label="Today's practice launchpad">
        <article className="today-next ck-reveal-item">
          <p className="ck-kicker">Next honest move</p>
          {loading ? (
            <p className="today-loading" role="status">
              Reading the ledger…
            </p>
          ) : recent ? (
            <>
              <div className="today-index" aria-hidden="true">
                01
              </div>
              <h2>{recent.title}</h2>
              <p className="today-composer">
                {recent.composer ?? "Selected repertoire"}
              </p>
              <p className="today-copy">Resume from the score.</p>
              <div className="today-actions">
                <button
                  type="button"
                  className="ck-primary-action"
                  onClick={() =>
                    onOpenPiece({
                      piece_id: recent.piece_id,
                      title: recent.title,
                    })
                  }
                >
                  Continue in Atlas <span aria-hidden="true">↗</span>
                </button>
                <button
                  type="button"
                  className="ck-text-action"
                  onClick={onOpenAtlas}
                >
                  Choose another piece
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="today-index" aria-hidden="true">
                01
              </div>
              <h2>Open the score.</h2>
              <p className="today-copy">
                Choose a piece, mark the exact target, and begin with a small
                explicit contract.
              </p>
              <button
                type="button"
                className="ck-primary-action"
                onClick={onOpenAtlas}
              >
                Open Score Atlas <span aria-hidden="true">↗</span>
              </button>
            </>
          )}
        </article>

        <aside
          className="today-rule ck-reveal-item"
          aria-label={`Default contract: ${defaultCleanStreak} clean attempts in a row`}
        >
          <p className="ck-kicker">Default contract</p>
          <p className="today-rule-number" aria-hidden="true">
            {defaultCleanStreak}
          </p>
          <h2 id="today-rule-title">
            clean attempts
            <br />
            in a row
          </h2>
          <p>
            A miss resets the streak. Nothing is erased; recovery is part of the
            evidence.
          </p>
        </aside>

        <article
          className="today-ledger ck-reveal-item"
          aria-labelledby="today-ledger-title"
        >
          <div>
            <p className="ck-kicker">Ledger, not judgment</p>
            <h2 id="today-ledger-title">What the record can prove</h2>
          </div>
          <dl>
            <div>
              <dt>Focused time</dt>
              <dd>
                {snapshot
                  ? compactDuration(snapshot.totals.focused_seconds)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Active days · 28</dt>
              <dd>{snapshot?.totals.active_days_28 ?? "—"}</dd>
            </div>
            <div>
              <dt>Targets touched</dt>
              <dd>{snapshot?.totals.regions_practiced ?? "—"}</dd>
            </div>
            <div>
              <dt>Targets revisited</dt>
              <dd>{snapshot?.totals.regions_revisited ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <button
          type="button"
          className="today-plan ck-reveal-item"
          onClick={onOpenCalendar}
        >
          <span className="ck-kicker">Time available?</span>
          <strong>Shape the day</strong>
          <span>Review the Calendar and due work</span>
          <span className="today-plan-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </section>

      <section
        className="today-composer ck-reveal-item"
        aria-label="Compose a reviewed session"
      >
        {candidatesError ? (
          <p className="today-composer-note" role="status">
            {candidatesError}
          </p>
        ) : candidatesLoading && candidates.length === 0 ? (
          <p className="today-composer-note" role="status">
            Reading explicit retention, repair, and planned work…
          </p>
        ) : (
          <SessionComposer
            candidates={candidates}
            onStartSession={(reviewed) => plan.startPlan(reviewed)}
          />
        )}
      </section>

      {plan.activePlan && (
        <section
          className="today-plan-progress ck-reveal-item"
          aria-label="Active session plan"
        >
          <header className="today-plan-progress-head">
            <div>
              <p className="ck-kicker">Active session plan</p>
              <h2>Start each item when you are ready.</h2>
              <p className="today-plan-progress-copy">
                One live set at a time. The record already holds the started
                item; nothing else is written until you start it.
              </p>
            </div>
            <button
              type="button"
              className="ck-text-action"
              onClick={plan.clearPlan}
            >
              Dismiss plan
            </button>
          </header>
          <ol className="today-plan-list">
            {plan.activePlan.plan.sequence.map((item) => {
              const started =
                plan.activePlan?.startedSequences.includes(item.sequence) ??
                false;
              const startable = isStartableTargetRef(item.target_ref);
              const busy = plan.startingSequence !== null;
              const blockedByLive = activeBlock != null;
              const name =
                item.target_label?.trim() || `Target ${item.target_ref}`;
              const piece =
                item.piece_label?.trim() || `Piece ${item.piece_ref}`;
              return (
                <li
                  key={item.candidate_id}
                  className="today-plan-item"
                  data-started={started}
                >
                  <div className="today-plan-item-main">
                    <span className="today-plan-order" aria-hidden="true">
                      {String(item.sequence).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <p>
                        {piece} · {item.allocated_minutes} min
                      </p>
                    </div>
                  </div>
                  {started ? (
                    <span className="today-plan-status" data-kind="started">
                      Started
                    </span>
                  ) : startable ? (
                    <button
                      type="button"
                      className="ck-primary-action today-plan-start"
                      disabled={busy || blockedByLive}
                      onClick={() => void plan.startItem(item.sequence)}
                    >
                      {plan.startingSequence === item.sequence
                        ? "Starting…"
                        : "Start item"}
                    </button>
                  ) : (
                    <span className="today-plan-status" data-kind="unstartable">
                      No measure target to open
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {activeBlock != null && (
            <p className="today-plan-hint" role="status">
              Finish or close the current set before starting the next item.
            </p>
          )}
        </section>
      )}

      <details
        className="today-retention ck-reveal-item"
        onToggle={(event) => setRetentionOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="ck-kicker">What survived?</span>
          <strong>Retention checks</strong>
          <span>Yesterday’s peak stays historical until you test it.</span>
        </summary>
        {retentionOpen && <RetentionQueue asOfDate={todayLocal()} />}
      </details>
    </main>
  );
}

export { compactDuration, todayLabel };
