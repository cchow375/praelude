import { useEffect, useRef, useState } from "react";
import type {
  LastRep,
  RecoveryActionRequest,
  RepSnapshot,
  Verdict,
} from "./useRep";
import { repMasteryStatus, repMasteryVerified, repTries } from "./useRep";
import { Button, type ButtonVariant } from "../../ui";
import "./RepHud.css";

interface RepHudProps {
  snap: RepSnapshot | null;
  feed: LastRep[];
  error: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onCheck: (verdict: Verdict, note?: string | null) => Promise<void>;
  onUndo: () => Promise<void>;
  onCorrect: (
    attemptId: number | null,
    verdict: Verdict,
    note?: string | null,
  ) => Promise<void>;
  onReverseAdjustment: (adjustmentId: number) => Promise<void>;
  onRestart: (requiredCleanStreak?: number | null) => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onReflect: (reflection: string) => Promise<void>;
  onSafetyStop: (reason?: string | null) => Promise<void>;
  onRecover: (action: RecoveryActionRequest) => Promise<void>;
  onClose: () => void;
}

const VERDICT_BUTTONS: {
  verdict: Verdict;
  label: string;
  variant: ButtonVariant;
}[] = [
  { verdict: "clean", label: "Clean", variant: "primary" },
  { verdict: "flawed", label: "Sloppy", variant: "text" },
  { verdict: "failed", label: "Again", variant: "text" },
];

const VERDICT_SYMBOL: Record<string, string> = {
  clean: "✓",
  flawed: "~",
  failed: "✗",
};

export function formatFocusedTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function RepHud({
  snap,
  feed,
  error,
  collapsed = false,
  onToggleCollapsed,
  onCheck,
  onUndo,
  onCorrect,
  onReverseAdjustment,
  onRestart,
  onPause,
  onResume,
  onReflect,
  onSafetyStop,
  onRecover,
  onClose,
}: RepHudProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<
    | "check"
    | "undo"
    | "correct"
    | "reverse"
    | "restart"
    | "pause"
    | "resume"
    | "reflect"
    | "safety"
    | "recovery"
    | null
  >(null);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctVerdict, setCorrectVerdict] = useState<Verdict>("clean");
  const [correctNote, setCorrectNote] = useState("");
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [resetPulse, setResetPulse] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [reflection, setReflection] = useState("");
  const [recoveryStart, setRecoveryStart] = useState("");
  const [recoveryEnd, setRecoveryEnd] = useState("");
  const [recoveryHands, setRecoveryHands] = useState("left hand");
  const [recoveryMethod, setRecoveryMethod] = useState("rhythmic variants");
  const previousResetCount = useRef<number | undefined>(undefined);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const restartConfirmRef = useRef<HTMLButtonElement>(null);
  // React state does not update until the next render, so keep a same-tick
  // guard as well. This prevents rapid keyboard/click activation from sending
  // two verdicts against the same authoritative set projection.
  const checkPending = useRef(false);

  const lastAttemptId = snap?.last_attempt_id ?? null;
  const lastAdjustmentId = snap?.last_adjustment_id ?? null;
  useEffect(() => {
    if (!snap?.last) return;
    const verdict = snap.last.verdict;
    if (verdict === "clean" || verdict === "flawed" || verdict === "failed") {
      setCorrectVerdict(verdict);
    }
    setCorrectNote(snap.last.note ?? "");
  }, [lastAttemptId, lastAdjustmentId, snap?.last]);

  useEffect(() => {
    const next = snap?.reset_count;
    const previous = previousResetCount.current;
    previousResetCount.current = next;
    if (next == null || previous == null || next <= previous) return;
    setResetPulse(false);
    const frame = requestAnimationFrame(() => setResetPulse(true));
    const timer = window.setTimeout(() => setResetPulse(false), 520);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [snap?.reset_count]);

  // The recovery desk stays closed until the pianist opens it — auto-opening
  // on every non-clean verdict buried the verdict loop under a wall of
  // recovery controls (Christian: "clustered with text, impossible to read").

  useEffect(() => {
    setReflection(snap?.reflection ?? "");
  }, [snap?.block_id, snap?.reflection]);

  useEffect(() => {
    if (restartConfirm) restartConfirmRef.current?.focus();
  }, [restartConfirm]);

  if (!snap) return null;

  const submit = async (verdict: Verdict) => {
    if (mastered || busy || checkPending.current) return;
    checkPending.current = true;
    setBusy("check");
    const trimmed = note.trim();
    const submittedNote = note;
    setNote("");
    try {
      await onCheck(verdict, trimmed === "" ? null : trimmed);
    } catch {
      // The typed note is part of the user's evidence. A rejected native write
      // must not erase it; restore the draft for an explicit retry.
      setNote(submittedNote);
    } finally {
      checkPending.current = false;
      setBusy(null);
    }
  };

  const runUndo = async () => {
    if (busy) return;
    setBusy("undo");
    try {
      await onUndo();
    } catch {
      // useRep owns the normalized inline and global error receipts.
    } finally {
      setBusy(null);
    }
  };

  const runCorrection = async () => {
    if (busy) return;
    setBusy("correct");
    try {
      await onCorrect(
        snap.last_attempt_id ?? null,
        correctVerdict,
        correctNote.trim() || null,
      );
      setCorrecting(false);
    } catch {
      // Preserve the draft so a rejected correction can be retried.
    } finally {
      setBusy(null);
    }
  };

  const runReversal = async () => {
    if (busy || lastAdjustmentId == null) return;
    setBusy("reverse");
    try {
      await onReverseAdjustment(lastAdjustmentId);
    } catch {
      // useRep owns the normalized inline and global error receipts.
    } finally {
      setBusy(null);
    }
  };

  const runRestart = async () => {
    if (busy) return;
    setBusy("restart");
    try {
      await onRestart(snap.required_clean_streak ?? null);
      setRestartConfirm(false);
    } catch {
      // Keep confirmation visible after a rejected restart.
    } finally {
      setBusy(null);
    }
  };

  const runTimer = async () => {
    const paused = snap.timer_state === "paused" || snap.set_state === "paused";
    setBusy(paused ? "resume" : "pause");
    try {
      if (paused) await onResume();
      else await onPause();
    } finally {
      setBusy(null);
    }
  };

  const runReflection = async () => {
    if (!reflection.trim() || busy) return;
    setBusy("reflect");
    try {
      await onReflect(reflection);
      setReflectionOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const runSafetyStop = async () => {
    if (safetyBusy) return;
    setSafetyBusy(true);
    try {
      await onSafetyStop(
        "Pain, numbness, or weakness reported by the pianist.",
      );
    } finally {
      setSafetyBusy(false);
    }
  };

  const runRecovery = async (action: RecoveryActionRequest) => {
    if (busy) return;
    setBusy("recovery");
    try {
      await onRecover(action);
    } finally {
      setBusy(null);
    }
  };

  const range =
    snap.m_start === snap.m_end
      ? `m. ${snap.m_start}`
      : `mm. ${snap.m_start}–${snap.m_end}`;
  const tries = repTries(snap);
  const currentStreak = snap.current_clean_streak;
  const tempoMastery = snap.focus === "tempo" && snap.target_bpm != null;
  const masteryStreak = tempoMastery
    ? (snap.mastery_progress_streak ?? currentStreak)
    : currentStreak;
  const requiredStreak =
    snap.effective_required_clean_streak ?? snap.required_clean_streak;
  // Below the target tempo, target-mastery progress is legitimately 0 — the
  // pianist must first climb the ladder to the target before any clean can
  // count toward the "N in a row at target" proof. Showing that frozen "0/7"
  // as the primary number made every logged clean look ignored (the number
  // never moved) — exactly the confusion Christian hit climbing 45 → 52.
  // While climbing we instead surface the RUNG streak, which advances on every
  // clean (mirroring the spoken "Rung X of N"), and only switch to the target
  // proof once the working tempo has reached the target. This keeps the
  // honest-design rule — never render a false mastery fraction — while making
  // the primary number always respond to the current clean.
  const climbingToTarget =
    tempoMastery &&
    typeof currentStreak === "number" &&
    snap.bpm != null &&
    snap.target_bpm != null &&
    snap.bpm < snap.target_bpm &&
    snap.mastery_status !== "satisfied";
  const streakValue = climbingToTarget ? currentStreak : masteryStreak;
  const streakRequired = climbingToTarget
    ? snap.rule.clean_needed
    : requiredStreak;
  const verified = repMasteryVerified(snap);
  const mastery = repMasteryStatus(snap);
  const mastered = verified && mastery === "satisfied";
  const masteryLabel = mastered
    ? "Mastery verified"
    : !verified
      ? "Mastery unverified"
      : mastery === "not_applicable"
        ? "Mastery not applicable"
        : "Mastery not yet satisfied";
  const accuracy =
    snap.accuracy == null ? "—" : `${Math.round(snap.accuracy * 100)}%`;
  const showFeedTempo = snap.focus === "tempo" || snap.use_metronome;
  const paused = snap.timer_state === "paused" || snap.set_state === "paused";
  const workingStart = snap.working_m_start || snap.m_start;
  const workingEnd = snap.working_m_end || snap.m_end;
  const recoveryRangeStart = Number(recoveryStart);
  const recoveryRangeEnd = Number(recoveryEnd);
  const validNarrowRange =
    Number.isSafeInteger(recoveryRangeStart) &&
    Number.isSafeInteger(recoveryRangeEnd) &&
    recoveryRangeStart >= workingStart &&
    recoveryRangeEnd <= workingEnd &&
    recoveryRangeStart <= recoveryRangeEnd &&
    (recoveryRangeStart !== workingStart || recoveryRangeEnd !== workingEnd);

  return (
    <div
      className={`rep-hud ${collapsed ? "is-collapsed" : ""} ${resetPulse ? "is-reset-pulse" : ""} ${mastered ? "is-mastered" : ""} ${!verified ? "is-unverified" : ""}`}
      role="region"
      aria-label="Active practice set"
      data-set-state={snap.set_state ?? "legacy_unverified"}
    >
      <div className="rep-hud-context">
        <span className="rep-hud-piece">{snap.piece_title}</span>
        <span className="rep-hud-range">{range}</span>
        {snap.label && <span className="rep-hud-label">{snap.label}</span>}
        {snap.variant && (
          <span className="rep-hud-variant">{snap.variant}</span>
        )}
        <span className="rep-hud-time">
          {formatFocusedTime(snap.active_seconds ?? 0)}
          {paused ? " · paused" : ""}
        </span>
        {onToggleCollapsed && (
          <button
            type="button"
            className="rep-hud-collapse"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {collapsed ? "Expand set" : "Collapse set"}
          </button>
        )}
      </div>

      <div className="rep-hud-main">
        <div
          className="rep-hud-streak"
          aria-label={
            climbingToTarget
              ? `Clean streak at this rung ${streakValue ?? "unavailable"} of ${streakRequired ?? "unavailable"}, climbing to ${snap.target_bpm} BPM`
              : `${tempoMastery ? "Mastery proof at target" : "Current clean streak"} ${streakValue ?? "unavailable"} of ${streakRequired ?? "unavailable"}`
          }
        >
          <span className="rep-hud-streak-value">
            <strong>{streakValue ?? "—"}</strong>
            <span aria-hidden="true">/</span>
            <span>{streakRequired ?? "—"}</span>
          </span>
          {snap.focus === "tempo" || snap.use_metronome ? (
            snap.bpm != null && (
              <span className="rep-hud-tempo">
                ♩ {snap.bpm}
                {climbingToTarget && (
                  <span className="rep-hud-tempo-target">
                    {" → "}
                    {snap.target_bpm}
                  </span>
                )}
              </span>
            )
          ) : (
            <span className="rep-hud-tempo">{snap.focus}</span>
          )}
          {climbingToTarget && (
            <span className="rep-hud-climb" role="status">
              Climbing to ♩{snap.target_bpm} — then {requiredStreak ?? "—"}{" "}
              clean in a row
            </span>
          )}
          {(mastered || !verified) && (
            <span
              className={`rep-hud-mastery ${mastered ? "is-satisfied" : ""}`}
            >
              {masteryLabel}
            </span>
          )}
          {(snap.recovery_remaining ?? 0) > 0 && (
            <span className="rep-hud-recovery" role="status">
              Recovery: {snap.recovery_remaining} clean{" "}
              {snap.recovery_remaining === 1 ? "attempt" : "attempts"} remaining
            </span>
          )}
        </div>
      </div>

      <div className="rep-hud-entry" aria-busy={busy === "check"}>
        <div className="rep-hud-actions" aria-label="Record attempt verdict">
          {VERDICT_BUTTONS.map((button) => (
            <Button
              key={button.verdict}
              variant={button.variant}
              className="rep-verdict"
              disabled={mastered || busy != null}
              onClick={() => void submit(button.verdict)}
            >
              {button.label}
            </Button>
          ))}
        </div>
        <input
          className="rep-hud-note"
          type="text"
          value={note}
          placeholder="attempt note (optional)…"
          aria-label="Attempt note"
          disabled={mastered || busy != null}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="rep-hud-tools" aria-label="Set controls">
        <button
          type="button"
          className={paused ? "rep-hud-resume" : ""}
          disabled={busy != null}
          onClick={() => void runTimer()}
        >
          {busy === "pause"
            ? "Pausing…"
            : busy === "resume"
              ? "Resuming…"
              : paused
                ? "Resume"
                : "Pause"}
        </button>
        <button
          type="button"
          disabled={busy != null || tries === 0}
          onClick={() => void runUndo()}
        >
          {busy === "undo" ? "Undoing…" : "Undo"}
        </button>
        <button
          type="button"
          className="rep-hud-close"
          aria-label="Close practice set"
          disabled={busy != null}
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <details className="rep-hud-more">
        <summary>Details</summary>
        <section className="rep-focus-strip" aria-label="Focus contract">
          <div>
            <span>Intention</span>
            <strong>{snap.intention || "Make one thing more reliable"}</strong>
          </div>
          <div>
            <span>Judge only</span>
            <strong>{snap.judging_axis || "One chosen criterion"}</strong>
          </div>
          <div>
            <span>Condition</span>
            <strong>
              {[snap.hands, snap.method].filter(Boolean).join(" · ") ||
                "As opened"}
            </strong>
          </div>
        </section>
        <dl className="rep-hud-metrics">
          <div>
            <dt>Tries</dt>
            <dd>{tries}</dd>
          </div>
          {tempoMastery && (
            <div>
              <dt>Current rung</dt>
              <dd>
                {currentStreak ?? "—"}/{snap.rule.clean_needed}
              </dd>
            </div>
          )}
          <div>
            <dt>Best streak</dt>
            <dd>{snap.best_clean_streak ?? "—"}</dd>
          </div>
          <div>
            <dt>Resets</dt>
            <dd>{snap.reset_count ?? "—"}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>{accuracy}</dd>
          </div>
          <div>
            <dt>Voided</dt>
            <dd>{snap.voided_attempts ?? "—"}</dd>
          </div>
        </dl>
        <div className="rep-hud-tools" aria-label="More set controls">
          <button
            type="button"
            disabled={busy != null || snap.last_attempt_id == null}
            aria-expanded={correcting}
            onClick={() => setCorrecting((value) => !value)}
          >
            Correct latest
          </button>
          {lastAdjustmentId != null && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void runReversal()}
            >
              {busy === "reverse" ? "Reversing…" : "Reverse latest adjustment"}
            </button>
          )}
          <button
            ref={restartTriggerRef}
            type="button"
            disabled={busy != null}
            aria-expanded={restartConfirm}
            onClick={() => setRestartConfirm(true)}
          >
            Restart set
          </button>
          <button
            type="button"
            disabled={busy != null}
            aria-expanded={reflectionOpen}
            onClick={() => setReflectionOpen((value) => !value)}
          >
            Reflect
          </button>
        </div>
      </details>

      {!paused && snap.set_state === "active" && (
        <button
          type="button"
          className="rep-safety-stop"
          data-compact-visible="true"
          disabled={safetyBusy}
          onClick={() => void runSafetyStop()}
        >
          {safetyBusy ? "Stopping now…" : "Pain, numbness, or weakness — stop"}
        </button>
      )}

      {snap.review_boundary_reached && !mastered && (
        <p className="rep-hud-boundary" role="status">
          Review boundary reached — continue, change strategy, restart, or
          close.
        </p>
      )}

      {reflectionOpen && (
        <form
          className="rep-reflection"
          aria-label="Set reflection"
          onSubmit={(event) => {
            event.preventDefault();
            void runReflection();
          }}
        >
          <label htmlFor="rep-reflection-input">
            What changed? Keep it short and observable.
          </label>
          <textarea
            id="rep-reflection-input"
            value={reflection}
            rows={2}
            maxLength={2000}
            onChange={(event) => setReflection(event.target.value)}
          />
          <div>
            <button type="submit" disabled={busy != null || !reflection.trim()}>
              {busy === "reflect" ? "Saving…" : "Save reflection"}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => setReflectionOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <details
        className="rep-recovery-desk"
        open={recoveryOpen}
        onToggle={(event) => setRecoveryOpen(event.currentTarget.open)}
      >
        <summary>Change the condition</summary>
        <div className="rep-recovery-quick">
          <button
            type="button"
            disabled={busy != null || snap.last_attempt_id == null}
            onClick={() =>
              void runRecovery({
                kind: "reset_streak",
                rationale:
                  "Pianist chose to restart the clean proof after an error.",
              })
            }
          >
            Reset clean proof
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() =>
              void runRecovery({
                kind: "clean_debt",
                clean_count: 2,
                rationale: "Pianist chose two additional recovery cleans.",
              })
            }
          >
            Add 2 recovery cleans
          </button>
          {snap.focus === "tempo" && snap.bpm != null && snap.bpm > 20 && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() =>
                void runRecovery({
                  kind: "tempo_backoff",
                  bpm: Math.max(
                    20,
                    snap.bpm! - Math.max(2, snap.rule.bpm_step),
                  ),
                  rationale:
                    "Pianist chose to rebuild below the failed working tempo.",
                })
              }
            >
              Back off tempo
            </button>
          )}
          <button
            type="button"
            disabled={busy != null}
            onClick={() =>
              void runRecovery({
                kind: "break",
                planned_seconds: 60,
                rationale: "Pianist chose a short reset before continuing.",
              })
            }
          >
            Take a 60-second break
          </button>
        </div>
        <div className="rep-recovery-editors">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (validNarrowRange)
                void runRecovery({
                  kind: "narrow_target",
                  m_start: recoveryRangeStart,
                  m_end: recoveryRangeEnd,
                  rationale:
                    "Pianist narrowed the working target to isolate the failure.",
                });
            }}
          >
            <span>
              Narrow {workingStart}–{workingEnd}
            </span>
            <input
              aria-label="Recovery start measure"
              type="number"
              min={workingStart}
              max={workingEnd}
              value={recoveryStart}
              onChange={(event) => setRecoveryStart(event.target.value)}
            />
            <input
              aria-label="Recovery end measure"
              type="number"
              min={workingStart}
              max={workingEnd}
              value={recoveryEnd}
              onChange={(event) => setRecoveryEnd(event.target.value)}
            />
            <button type="submit" disabled={busy != null || !validNarrowRange}>
              Apply range
            </button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runRecovery({
                kind: "change_hands",
                hands: recoveryHands,
                rationale:
                  "Pianist changed the hand condition to rebuild control.",
              });
            }}
          >
            <select
              aria-label="Recovery hands"
              value={recoveryHands}
              onChange={(event) => setRecoveryHands(event.target.value)}
            >
              <option value="left hand">Left hand</option>
              <option value="right hand">Right hand</option>
              <option value="hands separate">Hands separate</option>
              <option value="hands together">Hands together</option>
            </select>
            <button type="submit" disabled={busy != null}>
              Change hands
            </button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runRecovery({
                kind: "change_method",
                method: recoveryMethod,
                rationale:
                  "Pianist changed method instead of repeating the same failure.",
              });
            }}
          >
            <select
              aria-label="Recovery method"
              value={recoveryMethod}
              onChange={(event) => setRecoveryMethod(event.target.value)}
            >
              <option value="rhythmic variants">Rhythmic variants</option>
              <option value="blocked practice">Blocked practice</option>
              <option value="silent fingering">Silent fingering</option>
              <option value="backward chaining">Backward chaining</option>
            </select>
            <button type="submit" disabled={busy != null}>
              Change method
            </button>
          </form>
        </div>
        {(snap.recovery_actions?.length ?? 0) > 0 && (
          <small>
            {snap.recovery_actions!.length} accepted recovery{" "}
            {snap.recovery_actions!.length === 1 ? "choice" : "choices"} in this
            set.
          </small>
        )}
      </details>

      {correcting && (
        <form
          className="rep-hud-correction"
          aria-label="Correct latest attempt"
          onSubmit={(event) => {
            event.preventDefault();
            void runCorrection();
          }}
        >
          <strong>Correct latest attempt</strong>
          <select
            aria-label="Corrected verdict"
            value={correctVerdict}
            onChange={(event) =>
              setCorrectVerdict(event.target.value as Verdict)
            }
          >
            <option value="clean">Clean</option>
            <option value="flawed">Sloppy</option>
            <option value="failed">Again</option>
          </select>
          <input
            aria-label="Corrected note"
            value={correctNote}
            placeholder="note (blank clears it)"
            onChange={(event) => setCorrectNote(event.target.value)}
          />
          <button type="submit" disabled={busy != null}>
            {busy === "correct" ? "Saving…" : "Save correction"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => setCorrecting(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {restartConfirm && (
        <div
          className="rep-hud-confirm"
          role="group"
          aria-live="polite"
          aria-labelledby="rep-restart-title"
          aria-describedby="rep-restart-description"
        >
          <strong id="rep-restart-title">Restart this set?</strong>
          <span id="rep-restart-description">
            The current set is marked restarted. Its attempts stay in history,
            and a fresh streak starts at zero.
          </span>
          <button
            ref={restartConfirmRef}
            type="button"
            disabled={busy != null}
            onClick={() => void runRestart()}
          >
            {busy === "restart" ? "Restarting…" : "Restart set"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => {
              setRestartConfirm(false);
              requestAnimationFrame(() => restartTriggerRef.current?.focus());
            }}
          >
            Keep current set
          </button>
        </div>
      )}

      {feed.length > 0 && (
        <ul className="rep-hud-feed" aria-label="Recent attempt verdicts">
          {feed.map((rep, index) => (
            <li
              key={`${rep.verdict}:${rep.bpm}:${rep.note ?? ""}:${index}`}
              className={`rep-feed-item is-${rep.verdict}`}
            >
              <span className="rep-feed-symbol" aria-hidden="true">
                {VERDICT_SYMBOL[rep.verdict] ?? "•"}
              </span>
              {showFeedTempo && rep.bpm != null && (
                <span className="rep-feed-bpm">{rep.bpm}</span>
              )}
              {rep.note && <span className="rep-feed-note">{rep.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {resetPulse && (
        <p className="rep-hud-reset" role="status">
          Streak reset. The attempt is preserved.
        </p>
      )}
      {error && (
        <p className="rep-hud-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
