import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalDock } from "../dock/DockProvider";
import { universeHistoryDays, universeSnapshot } from "./api";
import {
  buildCadenceWindow,
  type CadenceDay,
  type CadenceWindow,
} from "./cadence";
import { DetailPanel } from "./DetailPanel";
import { formatDuration, formatSince } from "./format";
import { earnedGameStatus, gameEvidenceFromTotals } from "./gameEvidence";
import {
  deriveUniverseProgress,
  momentumCopy,
  nextLandmarks,
  recentEvidence,
  type EvidenceRatio,
  type PracticeLandmark,
  type RecentEvidence,
} from "./progress";
import {
  blockState,
  BLOCK_STATE_LABEL,
  groupByComposer,
  pieceAttention,
  selectionExists,
  type Attention,
  type ComposerGroup,
  type Selection,
} from "./repertoire";
import { UniverseGamePanel } from "./UniverseGamePanel";
import type { UniverseGameEvidence } from "./game";
import type {
  PracticePieceContext,
  UniversePiece,
  UniverseSnapshot,
} from "./types";
import "./universe.css";

interface UniverseWorkspaceProps {
  /** Jump to the Score/Atlas workspace (null = open Atlas with no piece). */
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  /** Optional jump to the History workspace for a piece. */
  onOpenLedger?: (piece: PracticePieceContext) => void;
  /** The canonical day-streak read model. Null means no streak is asserted. */
  streak?: { current_days: number } | null;
}

const CADENCE_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : "Practice progress could not be loaded.";
}

/**
 * Universe is the evidence-first motivation surface. In response to the latest
 * feedback it now has one explicit game rule — one Practice XP per completed
 * focused minute — while quality and verdicts remain unscored. Levels, badges,
 * rails, cadence and repertoire marks all resolve from canonical evidence.
 */
export function UniverseWorkspace({
  onOpenPractice,
  onOpenLedger,
  streak = null,
}: UniverseWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [gameEvidence, setGameEvidence] = useState<UniverseGameEvidence | null>(
    null,
  );
  const gameEvidenceRef = useRef<UniverseGameEvidence | null>(null);
  const mountedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const [earnedStatus, setEarnedStatus] = useState<string | null>(null);
  const [cadence, setCadence] = useState<{
    state: "idle" | "loading" | "ready" | "unavailable";
    window: CadenceWindow | null;
  }>({ state: "idle", window: null });

  // This is the app's progress overview, so a floating Rep Counter should not
  // cover it at any window size. Keep the active set untouched, tuck only its
  // panel into the existing Tools row while entering, and restore it on the
  // way out. A deliberate restore while staying here is respected.
  const repDock = useOptionalDock("rep");
  const latestRepDock = useRef(repDock);
  const autoMinimizedRep = useRef(false);
  const restoreRepTimer = useRef<number | null>(null);
  latestRepDock.current = repDock;

  useEffect(() => {
    if (
      repDock?.isOpen &&
      !repDock.isMinimized &&
      !autoMinimizedRep.current
    ) {
      autoMinimizedRep.current = true;
      repDock.minimize();
    }
  }, [repDock]);

  useEffect(() => {
    // React StrictMode deliberately runs an effect cleanup/setup pair at mount.
    // Defer restoration by one tick so that simulated cleanup can be cancelled;
    // a real workspace exit has no replacement setup and therefore restores.
    if (restoreRepTimer.current != null) {
      window.clearTimeout(restoreRepTimer.current);
      restoreRepTimer.current = null;
    }
    return () => {
      restoreRepTimer.current = window.setTimeout(() => {
        const current = latestRepDock.current;
        // Closing the panel while reading progress is an explicit user choice;
        // never turn that close back into an open panel on workspace exit.
        if (autoMinimizedRep.current && current?.isOpen) current.open();
      }, 0);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextSnapshot = await universeSnapshot();
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      const canonicalEvidence = gameEvidenceFromTotals(nextSnapshot.totals);
      const previousEvidence = gameEvidenceRef.current;

      // The first snapshot is a baseline, not a reason to announce historical
      // work as newly earned. Later snapshots may announce real crossings seen
      // during this mounted view, but the current SQLite snapshot always wins.
      setEarnedStatus(
        previousEvidence
          ? earnedGameStatus(previousEvidence, canonicalEvidence)
          : null,
      );
      gameEvidenceRef.current = canonicalEvidence;
      setGameEvidence(canonicalEvidence);
      setSnapshot(nextSnapshot);
    } catch (reason) {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setSnapshot(null);
      setError(messageOf(reason));
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!snapshot) {
      setCadence({ state: "idle", window: null });
      return;
    }
    let current = true;
    const { active_window_start: from, active_window_end: to } =
      snapshot.traces;
    setCadence({ state: "loading", window: null });
    void universeHistoryDays(from, to)
      .then((rows) => {
        if (!current) return;
        const window = buildCadenceWindow(from, to, rows);
        setCadence(
          window
            ? { state: "ready", window }
            : { state: "unavailable", window: null },
        );
      })
      .catch(() => {
        if (current) setCadence({ state: "unavailable", window: null });
      });
    return () => {
      current = false;
    };
  }, [snapshot]);

  const pieces = useMemo(() => snapshot?.pieces ?? [], [snapshot]);
  const activePieceCount = useMemo(
    () => pieces.filter((piece) => piece.archived_at == null).length,
    [pieces],
  );
  const archivedPieceCount = pieces.length - activePieceCount;
  const technique = snapshot?.technique ?? null;
  const hasTechniqueEvidence = Boolean(
    technique &&
    (technique.focused_seconds > 0 ||
      technique.active_days_28 > 0 ||
      technique.completed_warmups > 0 ||
      technique.practice_sessions > 0 ||
      technique.last_practiced),
  );
  const reference = snapshot?.generated_at ?? null;
  const groups = useMemo(() => groupByComposer(pieces), [pieces]);
  const liveSelection = selectionExists(snapshot, selection) ? selection : null;
  const progress = useMemo(
    () => (snapshot ? deriveUniverseProgress(snapshot, streak) : null),
    [snapshot, streak],
  );
  const momentum = useMemo(
    () => (progress ? momentumCopy(progress) : null),
    [progress],
  );
  const landmarks = useMemo(
    () => (snapshot ? nextLandmarks(snapshot, streak) : []),
    [snapshot, streak],
  );
  const recent = useMemo(
    () => recentEvidence(pieces, reference),
    [pieces, reference],
  );
  const repCounterTucked = Boolean(
    autoMinimizedRep.current && repDock?.isOpen && repDock.isMinimized,
  );

  const openScore = useCallback(
    (piece: PracticePieceContext) => onOpenPractice(piece),
    [onOpenPractice],
  );

  const selectLandmark = useCallback((landmark: PracticeLandmark) => {
    if (landmark.pieceId == null) return;
    setSelection(
      landmark.regionId == null
        ? { kind: "piece", pieceId: landmark.pieceId }
        : {
            kind: "block",
            pieceId: landmark.pieceId,
            regionId: landmark.regionId,
          },
    );
  }, []);

  return (
    <main className="universe-workspace" data-testid="universe-workspace">
      <header className="universe-intro">
        <div>
          <p className="universe-eyebrow">Earned from your practice record</p>
          <h1 id="universe-title">Practice progress</h1>
        </div>
        <div className="universe-intro-actions">
          <button
            type="button"
            className="universe-refresh"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Reading record…" : "Refresh progress"}
          </button>
          <button
            type="button"
            className="universe-atlas-cta"
            onClick={() => onOpenPractice(null)}
          >
            Open score map
          </button>
        </div>
      </header>

      {repCounterTucked && (
        <aside className="universe-dock-note" role="status">
          <span>
            Your active set is safe. Rep Counter is tucked into Tools so it
            cannot cover this overview.
          </span>
          <button type="button" onClick={() => repDock?.open()}>
            Show Rep Counter
          </button>
        </aside>
      )}

      {error && (
        <div className="universe-error" role="alert">
          <span>{error}</span>
          {!snapshot && (
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="universe-state" role="status" aria-live="polite">
          Reading your practice record…
        </p>
      ) : snapshot && pieces.length === 0 && !hasTechniqueEvidence ? (
        <>
          {gameEvidence && <UniverseGamePanel evidence={gameEvidence} />}
          <section
            className="universe-state universe-empty"
            aria-labelledby="universe-empty-title"
          >
            <p className="universe-section-kicker">Nothing invented</p>
            <h2 id="universe-empty-title">Your practice record is quiet.</h2>
            <p>
              Import a piece and begin a focused session. The first completed
              focused minute earns the first Practice XP; target coverage and
              mastery appear only after they are actually recorded.
            </p>
            <button
              type="button"
              className="universe-atlas-cta"
              onClick={() => onOpenPractice(null)}
            >
              Open score map
            </button>
          </section>
        </>
      ) : snapshot && progress && momentum ? (
        <>
          {earnedStatus && (
            <p
              className="universe-earned-status"
              role="status"
              aria-live="polite"
            >
              {earnedStatus}
            </p>
          )}

          {gameEvidence && <UniverseGamePanel evidence={gameEvidence} />}

          <CadencePanel cadence={cadence} />

          <section
            className="universe-momentum"
            aria-labelledby="universe-momentum-title"
            data-testid="universe-momentum"
          >
            <div className="universe-momentum-copy">
              <p className="universe-section-kicker">Current momentum</p>
              <h2 id="universe-momentum-title">{momentum.title}</h2>
              <p>{momentum.detail}</p>
              <ul
                className="universe-momentum-facts"
                aria-label="Momentum facts"
              >
                <li>
                  <strong>{progress.activeDays.value}</strong> active days · 28
                </li>
                <li>
                  {progress.currentStreak > 0 ? (
                    <>
                      <strong>{progress.currentStreak}</strong>-day current
                      streak
                    </>
                  ) : (
                    "No current streak"
                  )}
                </li>
                <li>
                  <strong>{progress.practiceSessions}</strong>{" "}
                  {progress.practiceSessions === 1 ? "session" : "sessions"}
                </li>
              </ul>
            </div>
            <div
              className="universe-focus-total"
              data-evidence="totals.focused_seconds"
            >
              <span>Recorded focused time</span>
              <strong>{formatDuration(progress.focusedSeconds)}</strong>
              <small>Idle gaps removed</small>
            </div>
          </section>

          <section
            className="universe-progress"
            aria-labelledby="universe-progress-title"
          >
            <div className="universe-section-head is-compact">
              <div>
                <p className="universe-section-kicker">Exact, earned state</p>
                <h2 id="universe-progress-title">What has moved</h2>
              </div>
              <p>
                Practice XP counts focused minutes; quality and verdicts are
                never scored.
              </p>
            </div>
            <div className="universe-progress-grid">
              <ProgressRail
                label="Active days"
                note="current 28-day window"
                ratio={progress.activeDays}
                evidence="totals.active_days_28"
              />
              <ProgressRail
                label="Targets practiced"
                note="of mapped targets"
                ratio={progress.coverage}
                evidence="active_pieces.regions_practiced"
              />
              <ProgressRail
                label="Targets revisited"
                note="on at least two dates"
                ratio={progress.revisited}
                evidence="active_pieces.regions_revisited"
              />
              <ProgressRail
                label="Mastery verified"
                note="clean contracts satisfied"
                ratio={progress.mastery}
                evidence="active_pieces.mastered_targets"
              />
            </div>
            {technique && (
              <article
                className="universe-technique"
                data-testid="universe-technique"
                data-evidence="technique"
              >
                <div>
                  <p className="universe-section-kicker">Technique record</p>
                  <strong>
                    {technique.completed_warmups}{" "}
                    {technique.completed_warmups === 1
                      ? "warmup completed"
                      : "warmups completed"}
                  </strong>
                  <span>
                    {technique.last_practiced
                      ? formatSince(technique.last_practiced, reference)
                      : "No warmup practice recorded yet"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Focused</dt>
                    <dd>{formatDuration(technique.focused_seconds)}</dd>
                  </div>
                  <div>
                    <dt>Active days · 28</dt>
                    <dd>{technique.active_days_28}</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>{technique.practice_sessions}</dd>
                  </div>
                </dl>
              </article>
            )}
            <p
              className="universe-recovery-line"
              data-testid="universe-recovery-line"
            >
              <span>
                <strong>{progress.recovered}</strong> honestly recovered
              </span>
              <span data-state={progress.recoveryDebt > 0 ? "open" : "clear"}>
                <strong>{progress.recoveryDebt}</strong> open recovery
              </span>
            </p>
          </section>

          <div className="universe-insights">
            <section
              className="universe-landmarks"
              aria-labelledby="universe-landmarks-title"
              data-testid="universe-landmarks"
            >
              <div className="universe-section-head">
                <div>
                  <p className="universe-section-kicker">Choose if useful</p>
                  <h2 id="universe-landmarks-title">Next landmarks</h2>
                </div>
                <p>Milestones, not assignments.</p>
              </div>
              {landmarks.length === 0 ? (
                <p className="universe-insight-empty">
                  No unfinished landmark is visible in this snapshot.
                </p>
              ) : (
                <ol className="universe-landmark-list">
                  {landmarks.map((landmark) => (
                    <li
                      key={`${landmark.kind}:${landmark.pieceId}:${landmark.regionId}`}
                    >
                      {landmark.pieceId == null ? (
                        <LandmarkBody landmark={landmark} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectLandmark(landmark)}
                        >
                          <LandmarkBody landmark={landmark} />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section
              className="universe-recent"
              aria-labelledby="universe-recent-title"
              data-testid="universe-recent"
            >
              <div className="universe-section-head">
                <div>
                  <p className="universe-section-kicker">
                    Newest target touches
                  </p>
                  <h2 id="universe-recent-title">Recent evidence</h2>
                </div>
                <p>Current earned state, not a guessed change log.</p>
              </div>
              {recent.length === 0 ? (
                <p className="universe-insight-empty">
                  No target activity is recorded in the last 14 days.
                </p>
              ) : (
                <ul className="universe-recent-list">
                  {recent.map((entry) => (
                    <li key={`${entry.pieceId}:${entry.regionId}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelection({
                            kind: "block",
                            pieceId: entry.pieceId,
                            regionId: entry.regionId,
                          })
                        }
                      >
                        <span
                          className="universe-block"
                          data-state={blockState(entry.region)}
                          aria-hidden="true"
                        />
                        <span className="universe-recent-copy">
                          <strong>
                            {entry.pieceTitle} · {entry.regionName}
                          </strong>
                          <span>{recentEvidenceLabel(entry)}</span>
                        </span>
                        <span className="universe-recent-when">
                          {formatSince(entry.lastPracticed, reference)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section
            className="universe-map"
            aria-labelledby="universe-map-title"
          >
            <div className="universe-map-heading">
              <div>
                <p className="universe-section-kicker">
                  {activePieceCount === 1
                    ? "1 active piece"
                    : `${activePieceCount} active pieces`}
                  {archivedPieceCount > 0
                    ? ` · ${archivedPieceCount} archived`
                    : ""}
                  {" · one mark per target"}
                </p>
                <h2 id="universe-map-title">Your repertoire</h2>
              </div>
              <BlockLegend />
            </div>

            <div className="universe-map-and-detail">
              <div className="universe-index">
                {groups.length === 0 ? (
                  <p className="universe-insight-empty">
                    No repertoire pieces are on this shelf yet. Technique work
                    remains counted above.
                  </p>
                ) : (
                  groups.map((group) => (
                    <ComposerSection
                      key={group.key}
                      group={group}
                      reference={reference}
                      selectedPieceId={liveSelection?.pieceId ?? null}
                      onSelectPiece={(pieceId) =>
                        setSelection({ kind: "piece", pieceId })
                      }
                    />
                  ))
                )}
              </div>

              <DetailPanel
                selection={liveSelection}
                snapshot={snapshot}
                reference={reference}
                onClose={() => setSelection(null)}
                onSelect={setSelection}
                onOpenScore={openScore}
                onOpenLedger={onOpenLedger}
              />
            </div>
          </section>

          <details className="universe-method">
            <summary>How these numbers are earned</summary>
            <dl>
              {snapshot.definitions
                .filter(
                  (definition) => definition.signal !== "quality_brightness",
                )
                .map((definition) => (
                  <div key={definition.signal}>
                    <dt>{definition.label}</dt>
                    <dd>{definition.definition}</dd>
                  </div>
                ))}
            </dl>
            <p>
              Drawn from {snapshot.traces.source}, over{" "}
              {snapshot.traces.active_window_start} to{" "}
              {snapshot.traces.active_window_end}. Idle time beyond{" "}
              {snapshot.traces.idle_threshold_seconds} seconds is not counted as
              focus.
            </p>
          </details>
        </>
      ) : null}
    </main>
  );
}

function ProgressRail({
  label,
  note,
  ratio,
  evidence,
}: {
  label: string;
  note: string;
  ratio: EvidenceRatio;
  evidence: string;
}) {
  return (
    <article className="universe-progress-card" data-evidence={evidence}>
      <div className="universe-progress-value">
        <strong>{ratio.value}</strong>
        <span>/ {ratio.total}</span>
      </div>
      <p>
        <strong>{label}</strong>
        <span>{note}</span>
      </p>
      <div
        className="universe-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={ratio.total || 1}
        aria-valuenow={Math.min(ratio.value, ratio.total || 1)}
        aria-valuetext={`${ratio.value} of ${ratio.total}`}
      >
        <span style={{ width: `${ratio.percent}%` }} />
      </div>
    </article>
  );
}

function cadenceDateLabel(date: string): string {
  return CADENCE_DATE.format(new Date(`${date}T00:00:00Z`));
}

function cadenceDayLabel(day: CadenceDay): string {
  const date = cadenceDateLabel(day.date);
  if (day.focusedSeconds === 0) {
    return `${date}: no focused practice recorded`;
  }
  if (day.completedMinutes === 0) {
    return `${date}: less than 1 focused minute`;
  }
  return `${date}: ${day.completedMinutes} focused ${day.completedMinutes === 1 ? "minute" : "minutes"}`;
}

function CadencePanel({
  cadence,
}: {
  cadence: {
    state: "idle" | "loading" | "ready" | "unavailable";
    window: CadenceWindow | null;
  };
}) {
  return (
    <section
      className="universe-cadence"
      aria-labelledby="universe-cadence-title"
      data-testid="universe-cadence"
    >
      <div className="universe-section-head is-compact">
        <div>
          <p className="universe-section-kicker">Visible consistency</p>
          <h2 id="universe-cadence-title">28-day cadence</h2>
        </div>
        {cadence.window && (
          <p>
            <strong>{cadence.window.activeDays}</strong> days with focused work
            · <strong>{formatDuration(cadence.window.focusedSeconds)}</strong>
          </p>
        )}
      </div>

      {cadence.state === "loading" || cadence.state === "idle" ? (
        <p className="universe-cadence-state">Reading daily practice marks…</p>
      ) : cadence.state === "unavailable" || !cadence.window ? (
        <p className="universe-cadence-state">
          Daily cadence is unavailable; no days have been guessed.
        </p>
      ) : (
        <>
          <ol
            className="universe-cadence-days"
            aria-label="28-day focused-practice cadence"
          >
            {cadence.window.days.map((day) => (
              <li
                key={day.date}
                data-band={day.band}
                aria-label={cadenceDayLabel(day)}
                title={cadenceDayLabel(day)}
              >
                <span aria-hidden="true" />
              </li>
            ))}
          </ol>
          <div className="universe-cadence-foot">
            <span>{cadenceDateLabel(cadence.window.days[0]?.date ?? "")}</span>
            <ul aria-label="Focused minutes per day legend">
              <li data-band="none">0</li>
              <li data-band="light">1–14m</li>
              <li data-band="medium">15–29m</li>
              <li data-band="strong">30–59m</li>
              <li data-band="peak">60m+</li>
            </ul>
            <span>
              {cadenceDateLabel(
                cadence.window.days[cadence.window.days.length - 1]?.date ?? "",
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function LandmarkBody({ landmark }: { landmark: PracticeLandmark }) {
  return (
    <span className="universe-landmark-body" data-kind={landmark.kind}>
      <span className="universe-landmark-index" aria-hidden="true" />
      <span>
        <strong>{landmark.title}</strong>
        <span>{landmark.detail}</span>
      </span>
    </span>
  );
}

function recentEvidenceLabel(entry: RecentEvidence): string {
  const region = entry.region;
  if ((region.open_recovery_debt ?? 0) > 0) {
    const debt = region.open_recovery_debt ?? 0;
    return `${debt} ${debt === 1 ? "recovery" : "recoveries"} open`;
  }
  if (region.recovered) return "Honestly recovered";
  if ((region.mastery_contracts_completed ?? 0) > 0) {
    return "Mastery verified";
  }
  if (region.revisited) {
    return `${region.distinct_practice_dates} practice dates on record`;
  }
  if (region.rated_rep_events > 0) {
    return `${region.clean_rep_events} clean of ${region.rated_rep_events} rated reps`;
  }
  return "Practice recorded";
}

function ComposerSection({
  group,
  reference,
  selectedPieceId,
  onSelectPiece,
}: {
  group: ComposerGroup;
  reference: string | null;
  selectedPieceId: number | null;
  onSelectPiece: (pieceId: number) => void;
}) {
  const titleId = `universe-composer-${group.key}`;
  return (
    <section className="universe-group" aria-labelledby={titleId}>
      <h3 className="universe-group-name" id={titleId}>
        {group.composer}
      </h3>
      <ul className="universe-cards">
        {group.pieces.map((piece) => (
          <li key={piece.piece_id}>
            <PieceCard
              piece={piece}
              reference={reference}
              selected={piece.piece_id === selectedPieceId}
              onSelect={() => onSelectPiece(piece.piece_id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PieceCard({
  piece,
  reference,
  selected,
  onSelect,
}: {
  piece: UniversePiece;
  reference: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const archived = piece.archived_at != null;
  const attention: Attention | null = archived
    ? null
    : pieceAttention(piece, reference);
  return (
    <button
      type="button"
      className="universe-card"
      data-testid={`universe-piece-${piece.piece_id}`}
      data-piece-id={piece.piece_id}
      data-attention={attention?.kind ?? "none"}
      data-archived={archived ? "true" : "false"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="universe-card-identity">
        <span className="universe-card-title">
          {piece.title}
          {archived && <small>Archived</small>}
        </span>
        <span className="universe-card-when">
          {formatSince(piece.last_practiced, reference)}
          {attention?.kind === "recovering" ? ` · ${attention.label}` : ""}
        </span>
      </span>

      <span className="universe-card-progress">
        <span className="universe-blocks" aria-hidden="true">
          {piece.region_signals.map((signal) => (
            <span
              key={signal.region_id}
              className="universe-block"
              data-state={blockState(signal)}
            />
          ))}
        </span>
        <span className="universe-card-line">
          {piece.regions_practiced} / {piece.regions_total} targets practiced ·{" "}
          {piece.mastered_targets ?? 0} verified
        </span>
      </span>

      <span className="universe-card-line is-quiet">
        {formatDuration(piece.focused_seconds)} focused · {piece.active_days_28}{" "}
        active days · {piece.practice_sessions ?? 0} sessions
      </span>
    </button>
  );
}

function BlockLegend() {
  return (
    <ul className="universe-legend" aria-label="What a target mark means">
      {(
        [
          "untouched",
          "practiced",
          "revisited",
          "mastered",
          "recovering",
        ] as const
      ).map((state) => (
        <li key={state}>
          <span
            className="universe-block"
            data-state={state}
            aria-hidden="true"
          />
          {BLOCK_STATE_LABEL[state]}
        </li>
      ))}
    </ul>
  );
}

export { formatDuration };
