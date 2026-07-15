import { useEffect, useRef, useState } from "react";
import type { LastRep, RepSnapshot, Verdict } from "./useRep";
import {
  repMasteryStatus,
  repMasteryVerified,
  repTries,
} from "./useRep";
import "./RepHud.css";

interface RepHudProps {
  snap: RepSnapshot | null;
  feed: LastRep[];
  error: string | null;
  onCheck: (verdict: Verdict, note?: string | null) => Promise<void>;
  onUndo: () => Promise<void>;
  onCorrect: (
    attemptId: number | null,
    verdict: Verdict,
    note?: string | null,
  ) => Promise<void>;
  onReverseAdjustment: (adjustmentId: number) => Promise<void>;
  onRestart: (requiredCleanStreak?: number | null) => Promise<void>;
  onClose: () => void;
}

const VERDICT_BUTTONS: { verdict: Verdict; label: string; cls: string }[] = [
  { verdict: "clean", label: "Clean", cls: "is-clean" },
  { verdict: "flawed", label: "Sloppy", cls: "is-flawed" },
  { verdict: "failed", label: "Again", cls: "is-failed" },
];

const VERDICT_SYMBOL: Record<string, string> = {
  clean: "✓",
  flawed: "~",
  failed: "✗",
};

export function RepHud({
  snap,
  feed,
  error,
  onCheck,
  onUndo,
  onCorrect,
  onReverseAdjustment,
  onRestart,
  onClose,
}: RepHudProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"check" | "undo" | "correct" | "reverse" | "restart" | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctVerdict, setCorrectVerdict] = useState<Verdict>("clean");
  const [correctNote, setCorrectNote] = useState("");
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [resetPulse, setResetPulse] = useState(false);
  const previousResetCount = useRef<number | undefined>(undefined);
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

  const range = snap.m_start === snap.m_end
    ? `m. ${snap.m_start}`
    : `mm. ${snap.m_start}–${snap.m_end}`;
  const tries = repTries(snap);
  const currentStreak = snap.current_clean_streak;
  const tempoMastery = snap.focus === "tempo" && snap.target_bpm != null;
  const masteryStreak = tempoMastery
    ? snap.mastery_progress_streak ?? currentStreak
    : currentStreak;
  const requiredStreak = snap.effective_required_clean_streak
    ?? snap.required_clean_streak;
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
  const accuracy = snap.accuracy == null
    ? "—"
    : `${Math.round(snap.accuracy * 100)}%`;
  const showFeedTempo = snap.focus === "tempo" || snap.use_metronome;

  return (
    <div
      className={`rep-hud ${resetPulse ? "is-reset-pulse" : ""} ${mastered ? "is-mastered" : ""} ${!verified ? "is-unverified" : ""}`}
      role="region"
      aria-label="Active practice set"
      data-set-state={snap.set_state ?? "legacy_unverified"}
    >
      <div className="rep-hud-context">
        <span className="rep-hud-piece">{snap.piece_title}</span>
        <span className="rep-hud-range">{range}</span>
        {snap.label && <span className="rep-hud-label">{snap.label}</span>}
        {snap.variant && <span className="rep-hud-variant">{snap.variant}</span>}
        <span className="rep-hud-state">Set state: {snap.set_state ?? "legacy_unverified"}</span>
      </div>

      <div className="rep-hud-main">
        <div className="rep-hud-streak" aria-label={`${tempoMastery ? "Mastery proof at target" : "Current clean streak"} ${masteryStreak ?? "unavailable"} of ${requiredStreak ?? "unavailable"}`}>
          <span className="rep-hud-streak-label">{tempoMastery ? "Mastery proof at target" : "Current clean streak"}</span>
          <span className="rep-hud-streak-value">
            <strong>{masteryStreak ?? "—"}</strong>
            <span aria-hidden="true">/</span>
            <span>{requiredStreak ?? "—"}</span>
          </span>
          <span className={`rep-hud-mastery ${mastered ? "is-satisfied" : ""}`}>
            {masteryLabel}
          </span>
          {(snap.recovery_remaining ?? 0) > 0 && (
            <span className="rep-hud-recovery" role="status">
              Recovery: {snap.recovery_remaining} clean {snap.recovery_remaining === 1 ? "attempt" : "attempts"} remaining
            </span>
          )}
        </div>

        <dl className="rep-hud-metrics">
          <div><dt>Tries</dt><dd>{tries}</dd></div>
          {tempoMastery && <div><dt>Current rung</dt><dd>{currentStreak ?? "—"}/{snap.rule.clean_needed}</dd></div>}
          <div><dt>Best streak</dt><dd>{snap.best_clean_streak ?? "—"}</dd></div>
          <div><dt>Resets</dt><dd>{snap.reset_count ?? "—"}</dd></div>
          <div><dt>Accuracy</dt><dd>{accuracy}</dd></div>
          <div><dt>Voided</dt><dd>{snap.voided_attempts ?? "—"}</dd></div>
          <div><dt>{snap.focus === "tempo" || snap.use_metronome ? "Tempo" : "Focus"}</dt><dd>{snap.focus === "tempo" || snap.use_metronome ? (snap.bpm == null ? "—" : `♩ ${snap.bpm}`) : snap.focus}</dd></div>
        </dl>
      </div>

      <div className="rep-hud-entry" aria-busy={busy === "check"}>
        <div className="rep-hud-actions" aria-label="Record attempt verdict">
          {VERDICT_BUTTONS.map((button) => (
            <button
              key={button.verdict}
              type="button"
              className={`rep-verdict ${button.cls}`}
              disabled={mastered || busy != null}
              onClick={() => void submit(button.verdict)}
            >
              {button.label}
            </button>
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
        <button type="button" disabled={busy != null || tries === 0} onClick={() => void runUndo()}>
          {busy === "undo" ? "Undoing…" : "Undo last"}
        </button>
        <button type="button" disabled={busy != null || snap.last_attempt_id == null} aria-expanded={correcting} onClick={() => setCorrecting((value) => !value)}>
          Correct latest
        </button>
        {lastAdjustmentId != null && (
          <button type="button" disabled={busy != null} onClick={() => void runReversal()}>
            {busy === "reverse" ? "Reversing…" : "Reverse latest adjustment"}
          </button>
        )}
        <button type="button" disabled={busy != null} aria-expanded={restartConfirm} onClick={() => setRestartConfirm(true)}>
          Restart set
        </button>
        <button type="button" className="rep-hud-close" aria-label="Close practice set" disabled={busy != null} onClick={onClose}>Close</button>
      </div>

      {snap.review_boundary_reached && !mastered && (
        <p className="rep-hud-boundary" role="status">
          Review boundary reached — continue, change strategy, restart, or close.
        </p>
      )}

      {correcting && (
        <form className="rep-hud-correction" aria-label="Correct latest attempt" onSubmit={(event) => { event.preventDefault(); void runCorrection(); }}>
          <strong>Correct latest attempt</strong>
          <select aria-label="Corrected verdict" value={correctVerdict} onChange={(event) => setCorrectVerdict(event.target.value as Verdict)}>
            <option value="clean">Clean</option>
            <option value="flawed">Sloppy</option>
            <option value="failed">Again</option>
          </select>
          <input aria-label="Corrected note" value={correctNote} placeholder="note (blank clears it)" onChange={(event) => setCorrectNote(event.target.value)} />
          <button type="submit" disabled={busy != null}>{busy === "correct" ? "Saving…" : "Save correction"}</button>
          <button type="button" disabled={busy != null} onClick={() => setCorrecting(false)}>Cancel</button>
        </form>
      )}

      {restartConfirm && (
        <div className="rep-hud-confirm" role="alertdialog" aria-labelledby="rep-restart-title" aria-describedby="rep-restart-description">
          <strong id="rep-restart-title">Restart this set?</strong>
          <span id="rep-restart-description">The current set is marked restarted. Its attempts stay in history, and a fresh streak starts at zero.</span>
          <button type="button" disabled={busy != null} onClick={() => void runRestart()}>{busy === "restart" ? "Restarting…" : "Restart set"}</button>
          <button type="button" disabled={busy != null} onClick={() => setRestartConfirm(false)}>Keep current set</button>
        </div>
      )}

      {feed.length > 0 && (
        <ul className="rep-hud-feed" aria-label="Recent attempt verdicts">
          {feed.map((rep, index) => (
            <li key={`${rep.verdict}:${rep.bpm}:${rep.note ?? ""}:${index}`} className={`rep-feed-item is-${rep.verdict}`}>
              <span className="rep-feed-symbol" aria-hidden="true">{VERDICT_SYMBOL[rep.verdict] ?? "•"}</span>
              {showFeedTempo && rep.bpm != null && <span className="rep-feed-bpm">{rep.bpm}</span>}
              {rep.note && <span className="rep-feed-note">{rep.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {resetPulse && <p className="rep-hud-reset" role="status">Streak reset. The attempt is preserved.</p>}
      {error && <p className="rep-hud-error" role="alert">{error}</p>}
    </div>
  );
}
