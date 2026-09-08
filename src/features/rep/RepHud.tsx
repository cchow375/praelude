import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BeatUnit,
  CheckOutcome,
  LastRep,
  RecoveryActionRequest,
  RepSnapshot,
  Verdict,
} from "./useRep";
import { repMasteryStatus, repMasteryVerified, repTries } from "./useRep";
import {
  hotkeyLabel,
  useVerdictHotkeyConfig,
  useVerdictHotkeys,
} from "./useVerdictHotkeys";
import { useSetCompletion } from "./useSetCompletion";
import { RepReplayControl } from "./replay/RepReplayControl";
import { useRepReplay } from "./replay/useRepReplay";
import type { RepReplayCaptureOwnership } from "./replay/types";
import { Button, type ButtonVariant } from "../../ui";
import { unlockCompletionAudio } from "../ritual/completionSound";
import { PracticeEnergy, usePracticeEnergy } from "../ritual/practiceEnergy";
import "./RepHud.css";

export interface RepHudProps {
  snap: RepSnapshot | null;
  feed: LastRep[];
  error: string | null;
  collapsed?: boolean;
  /** The panel persists globally, but verdict keys only belong to the active
   * practice workspace. Direct mounts default on for backwards compatibility. */
  hotkeysActive?: boolean;
  metroRunning?: boolean;
  runningSubdivision?: number;
  onSetRunningSubdivision?: (value: number) => void;
  onToggleCollapsed?: () => void;
  /** Shell-owned voice gate: review mode must not let a spoken verdict bypass
   * its record/listen evidence path. */
  onReplayModeChange?: (enabled: boolean) => void;
  /** Native recognizer ownership barrier used before WebView recording starts. */
  replayCaptureOwnership?: RepReplayCaptureOwnership;
  /** False when the runtime cannot safely hand microphone ownership to review. */
  replayAvailable?: boolean;
  /** Honest capability/recovery copy shown instead of a failing control. */
  replayUnavailableReason?: string | null;
  /** Earned visual moment after an explicitly kept reference take commits. */
  onKeptTake?: () => void;
  /** Region Sound target persistence seam. Production writes the Region;
   * focused UI tests can inject a side-effect-free implementation. */
  onSoundTargetSave?: (regionId: number, value: string | null) => Promise<void>;
  onCheck: (
    verdict: Verdict,
    note?: string | null,
  ) => Promise<CheckOutcome | void>;
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
  onClose: () => Promise<void>;
  /** Test-only override for acknowledgement chimes; production always uses
   * `new Audio("/chime.wav")` — the same file `ClockPanel` plays. */
  audioFactory?: AudioFactory;
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

/**
 * A clean that COMPLETES a rung is a success: the engine steps the tempo up and
 * resets `current_clean_streak` to 0 in the very same snapshot. Rendering that
 * raw snapshot makes the big headline number drop to 0 the instant a clean is
 * logged — Christian reads it as "my clean didn't count / it reset". This holds
 * the reconstructed FILLED rung ("N/N" at the old tempo with a step receipt) for
 * a beat so the headline only ever moves upward as the immediate consequence of a
 * clean; the live new-rung "0/N at the new tempo" appears once the hold releases.
 */
interface RungCelebration {
  /** rule.clean_needed — the just-completed rung renders as filledStreak/filledStreak. */
  filledStreak: number;
  /** Tempo the completed rung was proven at (the prior snapshot's BPM). */
  atBpm: number;
  /** Tempo the engine stepped to (the new snapshot's BPM). */
  nextBpm: number;
  /** Whether the stepped tempo is still below the target (a new rung follows). */
  belowTarget: boolean;
}

/** How long the filled-rung receipt holds before the live new-rung state shows. */
const RUNG_CELEBRATION_MS = 1200;

/**
 * B3 — the same guarantee, for the CHAIN stage.
 *
 * While a variant chain is running the stage counter IS the headline (see
 * below), and clearing a stage resets it to 0 in the very same snapshot —
 * "5/5 → 0/5". Held for a beat, that reads as the advance Christian asked for
 * ("then it automatically moves me onto the next variation"); unheld, it reads
 * as the number he watched freeze and then vanish.
 */
interface StageCelebration {
  /** The stage requirement, rendered filled as `filled/filled`. */
  filled: number;
  /** The variant that was just cleared — the name the receipt belongs to. */
  name: string | null;
}

/**
 * A1 "the punishment": how long the demotion moment holds. A demotion is not
 * a celebration (it never touches `fireCompletionFx`/the confetti layer) —
 * just a calm, ink-colored line naming the new tempo, plus the same chime
 * `ClockPanel` already uses for a quiet done-signal. Held about as long as
 * the rung celebration so it reads, not flashes.
 */
const DEMOTION_MOMENT_MS = 1200;

const BEAT_UNIT_DISPLAY: Record<
  BeatUnit,
  { mark: string; spokenLabel: string }
> = {
  quarter: { mark: "♩", spokenLabel: "Quarter note" },
  eighth: { mark: "♪", spokenLabel: "Eighth note" },
  dotted_quarter: { mark: "♩.", spokenLabel: "Dotted quarter note" },
  half: { mark: "𝅗𝅥", spokenLabel: "Half note" },
};

/** Test-only override; production always uses `new Audio(...)` — same shape
 * as `ClockPanel`'s `AudioFactory`, not a new audio path. */
type AudioFactory = (src: string) => { play: () => Promise<void> };
const defaultAudioFactory: AudioFactory = (src) =>
  new Audio(src) as unknown as { play: () => Promise<void> };

const defaultSoundTargetSave = async (
  regionId: number,
  value: string | null,
) => {
  await invoke("region_update", {
    id: regionId,
    patch: { notes: value },
  });
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
  hotkeysActive = true,
  metroRunning = false,
  runningSubdivision,
  onSetRunningSubdivision,
  onToggleCollapsed,
  onReplayModeChange,
  replayCaptureOwnership,
  replayAvailable = true,
  replayUnavailableReason,
  onKeptTake,
  onSoundTargetSave = defaultSoundTargetSave,
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
  audioFactory = defaultAudioFactory,
}: RepHudProps) {
  const [note, setNote] = useState("");
  const [soundTarget, setSoundTarget] = useState("");
  const [soundEditing, setSoundEditing] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
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
  const energyPulse = usePracticeEnergy(snap);
  const verdictPulse = energyPulse?.verdict ?? null;
  const [celebration, setCelebration] = useState<RungCelebration | null>(null);
  const [stageCelebration, setStageCelebration] =
    useState<StageCelebration | null>(null);
  // A1 "the punishment": the new (lower) tempo while the demotion moment
  // holds, or `null` when none is showing.
  const [demotionBpm, setDemotionBpm] = useState<number | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [reflection, setReflection] = useState("");
  const [recoveryStart, setRecoveryStart] = useState("");
  const [recoveryEnd, setRecoveryEnd] = useState("");
  const [recoveryHands, setRecoveryHands] = useState("left hand");
  const [recoveryMethod, setRecoveryMethod] = useState("rhythmic variants");
  const previousResetCount = useRef<number | undefined>(undefined);
  // Prior-snapshot values, read by the celebration + pulse effects and committed
  // by a trailing effect AFTER those reads, so both always see the pre-transition
  // state (the streak/tempo before the clean that changed them).
  const prevBpmRef = useRef<number | null>(null);
  const prevStreakRef = useRef<number | undefined>(undefined);
  // B3: the same "read prior, then commit" discipline for the chain stage.
  const prevStageCleansRef = useRef<number | null>(null);
  const prevStageRequiredRef = useRef<number | null>(null);
  const prevStageNameRef = useRef<string | null>(null);
  const prevStageIndexRef = useRef<number | null>(null);
  const prevStageAttemptIdRef = useRef<number | null>(null);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const restartConfirmRef = useRef<HTMLButtonElement>(null);
  // React state does not update until the next render, so keep a same-tick
  // guard as well. This prevents rapid keyboard/click activation from sending
  // two verdicts against the same authoritative set projection.
  const checkPending = useRef(false);
  // A6: the hotkeys route through the very same `submit()` the verdict buttons
  // call, so provenance, receipts, the busy guard and the mastered guard are
  // identical to a click. `submit` is defined below the `!snap` early return,
  // so the listener reaches it through this ref rather than a second write path.
  const submitRef = useRef<((verdict: Verdict) => Promise<void>) | null>(null);

  // B2: a satisfied set closes itself after a visible six-second countdown.
  // Placed with the other hooks (above the `!snap` early return) so the
  // countdown is governed by the snapshot alone and cannot be skipped by a
  // render that happens to have no set.
  const completion = useSetCompletion(snap, onClose);
  const replay = useRepReplay({
    repBlockId: snap?.block_id ?? 0,
    onKept: onKeptTake,
    captureOwnership: replayCaptureOwnership,
  });
  useEffect(() => {
    if (!replayAvailable && replay.enabled) replay.setEnabled(false);
    // `setEnabled` is an imperative controller member whose identity changes
    // with the controller object; availability/enabled are the transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayAvailable, replay.enabled]);
  useEffect(() => {
    onReplayModeChange?.(replay.enabled);
    return () => {
      if (replay.enabled) onReplayModeChange?.(false);
    };
  }, [onReplayModeChange, replay.enabled]);

  const hotkeys = useVerdictHotkeyConfig();
  const { used: hotkeyUsed } = useVerdictHotkeys({
    active: snap != null && hotkeysActive,
    config: hotkeys,
    onVerdict: (verdict) => void submitRef.current?.(verdict),
  });

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
    // Only announce a reset that actually cost the pianist a streak. A resetting
    // verdict against an already-zero streak breaks nothing, so pulsing "Streak
    // reset" there is a false alarm — stay silent. prevStreakRef still holds the
    // pre-reset streak (the trailing commit effect runs after this one).
    if ((prevStreakRef.current ?? 0) <= 0) return;
    setResetPulse(false);
    const frame = requestAnimationFrame(() => setResetPulse(true));
    const timer = window.setTimeout(() => setResetPulse(false), 520);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [snap?.reset_count]);

  // Rung-completion celebration: when a clean steps the tempo up (the sole cause
  // of an upward BPM step in this engine) we reconstruct the filled rung the
  // engine never surfaces and hold it briefly. Keyed on the attempt identity so
  // it fires once per new verdict; any following verdict clears the hold.
  useEffect(() => {
    if (!snap) return;
    const prevBpm = prevBpmRef.current;
    const curBpm = snap.bpm;
    const targetBpm = snap.target_bpm;
    const completing =
      prevBpm != null &&
      curBpm != null &&
      targetBpm != null &&
      curBpm > prevBpm &&
      snap.focus === "tempo" &&
      snap.last?.verdict === "clean";
    if (!completing) {
      setCelebration(null);
      return;
    }
    setCelebration({
      filledStreak: snap.rule.clean_needed,
      atBpm: prevBpm,
      nextBpm: curBpm,
      belowTarget: curBpm < targetBpm,
    });
    const timer = window.setTimeout(
      () => setCelebration(null),
      RUNG_CELEBRATION_MS,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAttemptId]);

  // A1 "the punishment": when a check's outcome shows the bpm went DOWN, an
  // automatic demotion just happened (the only way this engine ever lowers
  // the working tempo on a plain check — manual "Back off tempo" is a
  // separate recovery action, not a check outcome). §4b visibility: a
  // punishment the pianist cannot perceive teaches nothing, so this renders a
  // calm, ink-colored HUD moment naming the new tempo and fires the existing
  // chime — never `fireCompletionFx`; a demotion is not a celebration.
  useEffect(() => {
    if (!snap) return;
    const prevBpm = prevBpmRef.current;
    const curBpm = snap.bpm;
    const demoted =
      prevBpm != null &&
      curBpm != null &&
      curBpm < prevBpm &&
      snap.focus === "tempo" &&
      snap.last?.verdict === "flawed";
    if (!demoted) {
      setDemotionBpm(null);
      return;
    }
    setDemotionBpm(curBpm);
    void audioFactory("/chime.wav")
      .play()
      .catch(() => {
        // Autoplay can be blocked, or jsdom's stub can reject — same
        // swallow-and-move-on as `ClockPanel`'s chime; never load-bearing.
      });
    const timer = window.setTimeout(
      () => setDemotionBpm(null),
      DEMOTION_MOMENT_MS,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAttemptId]);

  // B3: hold the FILLED stage when a newly committed clean advances forward
  // to the next named variant. This is intentionally an intermediate-stage
  // acknowledgement: Undo, final completion, same-stage recovery cleans, and
  // a chain restart at a new tempo must not replay it.
  useEffect(() => {
    if (!snap || snap.variant_stage_index == null) {
      setStageCelebration(null);
      return;
    }
    const prevCleans = prevStageCleansRef.current;
    const previousIndex = prevStageIndexRef.current;
    const currentIndex = snap.variant_stage_index;
    const previousAttemptId = prevStageAttemptIdRef.current;
    const cleared =
      prevCleans != null &&
      previousIndex != null &&
      currentIndex > previousIndex &&
      snap.variant_chain_complete !== true &&
      lastAttemptId != null &&
      (previousAttemptId == null || lastAttemptId > previousAttemptId) &&
      snap.last?.verdict === "clean";
    if (!cleared) {
      setStageCelebration(null);
      return;
    }
    setStageCelebration({
      filled: prevStageRequiredRef.current ?? prevCleans,
      name: prevStageNameRef.current,
    });
    void audioFactory("/chime.wav")
      .play()
      .catch(() => {
        // A blocked acknowledgement must never interrupt the rep hot loop.
      });
    const timer = window.setTimeout(
      () => setStageCelebration(null),
      RUNG_CELEBRATION_MS,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAttemptId]);

  // Commit the current snapshot's tempo/streak as "previous" AFTER the effects
  // above have read the prior values. No dependency array: it must trail every
  // render so the next transition compares against the state just displayed.
  useEffect(() => {
    prevBpmRef.current = snap?.bpm ?? null;
    prevStreakRef.current = snap?.current_clean_streak;
    const stageIndex = snap?.variant_stage_index ?? null;
    prevStageCleansRef.current =
      stageIndex == null ? null : (snap?.variant_stage_cleans ?? 0);
    prevStageRequiredRef.current =
      stageIndex == null ? null : (snap?.variant_stage_required ?? 0);
    prevStageNameRef.current =
      stageIndex == null
        ? null
        : (snap?.variants?.[stageIndex]?.name ?? snap?.variant ?? null);
    prevStageIndexRef.current = stageIndex;
    prevStageAttemptIdRef.current = snap?.last_attempt_id ?? null;
  });

  // The recovery desk stays closed until the pianist opens it — auto-opening
  // on every non-clean verdict buried the verdict loop under a wall of
  // recovery controls (Christian: "clustered with text, impossible to read").

  useEffect(() => {
    setReflection(snap?.reflection ?? "");
  }, [snap?.block_id, snap?.reflection]);

  useEffect(() => {
    if (soundEditing) return;
    setSoundTarget(snap?.sound_target ?? "");
    setSoundError(null);
  }, [snap?.block_id, snap?.sound_target, soundEditing]);

  useEffect(() => {
    if (restartConfirm) restartConfirmRef.current?.focus();
  }, [restartConfirm]);

  if (!snap) return null;

  const saveSoundTarget = async () => {
    if (snap.region_id == null || soundBusy) return;
    setSoundBusy(true);
    setSoundError(null);
    const normalized = soundTarget.trim();
    try {
      await onSoundTargetSave(snap.region_id, normalized || null);
      setSoundTarget(normalized);
      setSoundEditing(false);
    } catch (reason) {
      setSoundError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSoundBusy(false);
    }
  };

  const submit = async (verdict: Verdict) => {
    if (mastered || busy || checkPending.current) return;
    if (!replay.assertVerdictReady()) return;
    // This must be synchronous with the click or verdict hotkey. The actual
    // sound still waits for the committed snapshot below, but WebKit grants
    // Web Audio only from this user-activation boundary.
    unlockCompletionAudio();
    // A completed listen-back verdict may still be writing an explicitly kept
    // audio file. Keep this set open instead of letting the normal six-second
    // auto-close remove the only retry surface after a disk error.
    if (replay.enabled) completion.cancel();
    checkPending.current = true;
    setBusy("check");
    const trimmed = note.trim();
    const submittedNote = note;
    setNote("");
    try {
      const outcome = await onCheck(verdict, trimmed === "" ? null : trimmed);
      await replay.commitAfterVerdict(outcome?.snap.last_attempt_id ?? null);
    } catch {
      // The typed note is part of the user's evidence. A rejected native write
      // must not erase it; restore the draft for an explicit retry.
      setNote(submittedNote);
    } finally {
      checkPending.current = false;
      setBusy(null);
    }
  };
  submitRef.current = submit;

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
    // Recovery means the pianist has explicitly chosen to keep working. Stop
    // the completion timer synchronously, before the native mutation starts,
    // so its final queued tick cannot race the recovery write with rep_close.
    completion.cancel();
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
  const totalAttempts = snap.mastery_basis === "total_attempts";
  const totalAttemptTarget = totalAttempts
    ? (snap.attempt_target ?? snap.required_clean_streak ?? null)
    : null;
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
  // While the celebration hold is active, the headline shows the FILLED rung the
  // clean just completed instead of the engine's already-reset live streak. This
  // is the guarantee that the big number never drops as the direct result of a
  // clean: it fills up to N/N, holds the step receipt, then the live 0/N at the
  // new tempo takes over once the hold releases.
  // B3: while a variant chain is running, the STAGE counter is the headline.
  // The mastery streak is the wrong number to make big here — with a chain it
  // is no longer what ends the set (see B1), and rendering it meant the
  // advance from one variant to the next showed up only in a small span, which
  // is why Christian experienced the chain as "it just stays 5/5" rather than
  // as the automatic move to the next variation he asked for. With no chain,
  // the headline is exactly what it was.
  const stageIndex = snap.variant_stage_index ?? null;
  const chainComplete = snap.variant_chain_complete === true;
  const chained = stageIndex != null && !chainComplete;
  const liveStageName =
    (stageIndex != null ? snap.variants?.[stageIndex]?.name : null) ??
    snap.variant ??
    null;
  const stageName = stageCelebration
    ? (stageCelebration.name ?? liveStageName)
    : liveStageName;
  const headlineStreak = totalAttempts
    ? tries
    : chained
      ? (stageCelebration?.filled ?? snap.variant_stage_cleans ?? 0)
      : celebration
        ? celebration.filledStreak
        : streakValue;
  const headlineRequired = totalAttempts
    ? totalAttemptTarget
    : chained
      ? (stageCelebration?.filled ?? snap.variant_stage_required ?? 0)
      : celebration
        ? celebration.filledStreak
        : streakRequired;
  const headlineBpm = celebration ? celebration.atBpm : snap.bpm;
  // A5: BPM is already the click rate for the note value captured on this
  // set. This is display metadata only — never multiply or divide the number.
  const beatUnit = BEAT_UNIT_DISPLAY[snap.tuning?.beat_unit ?? "quarter"];
  const beatMark = beatUnit.mark;
  const tuningDetail = snap.tuning
    ? `${snap.tuning.beats_per_bar} beats/bar · subdivision ${snap.tuning.subdivision}`
    : null;
  const verified = repMasteryVerified(snap);
  const mastery = repMasteryStatus(snap);
  const mastered = verified && mastery === "satisfied";
  const masteryLabel = totalAttempts
    ? mastered
      ? "Play target complete"
      : !verified
        ? "Play target unverified"
        : "Play target in progress"
    : mastered
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
        {/* The always-reachable set controls. Pause/Resume and Close ride in
            the context row rather than a card-sized row of their own, so they
            survive the collapsed state and cost no vertical space. */}
        <span className="rep-hud-context-tools">
          <span className="rep-hud-time">
            {formatFocusedTime(snap.active_seconds ?? 0)}
            {paused ? " · paused" : ""}
          </span>
          <button
            type="button"
            className={`rep-hud-chip ${paused ? "rep-hud-resume" : ""}`}
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
          {onToggleCollapsed && (
            <button
              type="button"
              className="rep-hud-chip rep-hud-collapse"
              aria-expanded={!collapsed}
              onClick={onToggleCollapsed}
            >
              {collapsed ? "Expand set" : "Collapse set"}
            </button>
          )}
          <button
            type="button"
            className="rep-hud-chip rep-hud-close"
            aria-label="Close practice set"
            disabled={busy != null}
            // `useRep.close` rejects after publishing its visible error so the
            // auto-completion hook can retry once. A manual click has no retry
            // policy, so absorb that already-reported rejection here instead
            // of leaving an unhandled promise in the browser.
            onClick={() =>
              void Promise.resolve(onClose()).catch(() => undefined)
            }
          >
            Close
          </button>
        </span>
      </div>

      {/* B2: the set finishes itself. Christian had to close every mastered
          set by hand — "it just stays at 5/5 and i have to like manially x out
          of it". This is the visible half of that fix: what happened, how long
          until it closes, and a one-click way to stop it.

          `data-compact-visible` is NOT optional here. `RepHud.css` hides every
          direct child of `.rep-hud.is-collapsed` that is not the context row,
          the main row, or explicitly marked — so without the mark this banner
          would be a feature that "shipped" and was invisible at the app's own
          720x520 floor, which is exactly B82. It is a top-level row (it must
          not compete with the headline inside `.rep-hud-main`), so the mark is
          load-bearing rather than belt-and-braces. */}
      {completion.secondsLeft != null && (
        <div
          className="rep-hud-complete"
          data-compact-visible="true"
          role="status"
        >
          <span className="rep-hud-complete-text">
            Set complete · closing in {completion.secondsLeft}…
          </span>
          <button
            type="button"
            className="rep-hud-chip rep-hud-stay-open"
            onClick={completion.cancel}
          >
            Stay open
          </button>
        </div>
      )}

      <div className="rep-hud-main">
        <PracticeEnergy
          progress={
            mastered || chainComplete
              ? 1
              : headlineRequired
                ? (headlineStreak ?? 0) / headlineRequired
                : 0
          }
          pulse={energyPulse}
          complete={mastered || chainComplete}
          paused={paused}
        />
        <div
          className={`rep-hud-streak ${celebration ? "is-rung-complete" : ""}`}
          aria-label={
            totalAttempts
              ? `Total plays ${tries} of ${totalAttemptTarget ?? "unavailable"}`
              : chained
                ? `${stageName ?? "Variant"} ${headlineStreak} of ${headlineRequired} clean${
                    snap.next_variant_stage_name
                      ? `, next variation ${snap.next_variant_stage_name}`
                      : ", last variation in the chain"
                  }`
                : celebration
                  ? `Rung ${celebration.filledStreak} of ${celebration.filledStreak} clean at ${beatMark}${celebration.atBpm} — stepping to ${beatMark}${celebration.nextBpm}`
                  : climbingToTarget
                    ? `Clean streak at this rung ${streakValue ?? "unavailable"} of ${streakRequired ?? "unavailable"}, climbing to ${snap.target_bpm} BPM`
                    : `${tempoMastery ? "Mastery proof at target" : "Current clean streak"} ${streakValue ?? "unavailable"} of ${streakRequired ?? "unavailable"}`
          }
        >
          <span className="rep-hud-streak-value">
            <strong>{headlineStreak ?? "—"}</strong>
            <span aria-hidden="true">/</span>
            <span>{headlineRequired ?? "—"}</span>
          </span>
          {/* B3: the headline number belongs to a NAMED variant while a chain
              is running, so the name rides with it. Without this, "0/5" right
              after "5/5" reads as a reset rather than as the move to the next
              variation. */}
          {chained && stageName && (
            <span className="rep-hud-stage-name">{stageName}</span>
          )}
          {totalAttempts && (
            <span className="rep-hud-stage-name">total plays</span>
          )}
          {snap.focus === "tempo" || snap.use_metronome ? (
            headlineBpm != null && (
              <span
                className="rep-hud-tempo"
                aria-label={`${beatUnit.spokenLabel} ${headlineBpm} BPM${
                  tuningDetail ? `, ${tuningDetail}` : ""
                }`}
              >
                {beatMark} {headlineBpm}
                {celebration ? (
                  <span className="rep-hud-step-receipt">
                    {` ✓ → ${beatMark}`}
                    {celebration.nextBpm}
                  </span>
                ) : (
                  climbingToTarget && (
                    <span className="rep-hud-tempo-target">
                      {" → "}
                      {snap.target_bpm}
                    </span>
                  )
                )}
                {tuningDetail && (
                  <span className="rep-hud-tuning-detail">
                    {" · "}
                    {tuningDetail}
                  </span>
                )}
                {metroRunning &&
                  runningSubdivision != null &&
                  onSetRunningSubdivision && (
                    <span
                      className="rep-hud-subdivision"
                      aria-label={`Running subdivision ${runningSubdivision}`}
                    >
                      <button
                        type="button"
                        aria-label="Decrease running subdivision"
                        disabled={runningSubdivision <= 1}
                        onClick={() =>
                          onSetRunningSubdivision(runningSubdivision - 1)
                        }
                      >
                        −
                      </button>
                      <span>sub {runningSubdivision}</span>
                      <button
                        type="button"
                        aria-label="Increase running subdivision"
                        disabled={runningSubdivision >= 16}
                        onClick={() =>
                          onSetRunningSubdivision(runningSubdivision + 1)
                        }
                      >
                        +
                      </button>
                    </span>
                  )}
              </span>
            )
          ) : (
            <span className="rep-hud-tempo">{snap.focus}</span>
          )}
          {celebration ? (
            <span className="rep-hud-climb" role="status">
              Rung cleared — stepping to {beatMark}
              {celebration.nextBpm}
              {celebration.belowTarget && snap.target_bpm != null
                ? `, climbing to ${beatMark}${snap.target_bpm}`
                : ""}
            </span>
          ) : (
            climbingToTarget && (
              <span className="rep-hud-climb" role="status">
                Climbing to {beatMark}
                {snap.target_bpm} — then {requiredStreak ?? "—"} clean in a row
              </span>
            )
          )}
          {/* A1 "the punishment": the demotion moment. Takes precedence over
              the "approaching demotion" line below — it just happened, and it
              is the thing he needs to understand. Calm, ink-colored, no shame
              styling, no exclamation mark — a demotion is a normal part of
              deliberate practice, not a telling-off. `data-compact-visible`
              is belt-and-braces (this row already lives inside `.rep-hud-main`,
              which is itself exempt from the collapsed-HUD hiding rule), but
              the mark travels with the moment per the B82 lesson: the event
              can fire regardless of whether the HUD is compact or expanded. */}
          {demotionBpm != null && (
            <span
              className="rep-hud-demotion"
              role="status"
              data-compact-visible="true"
            >
              Tempo pulled back to {beatMark}
              {demotionBpm}
            </span>
          )}
          {/* A1: let him see a demotion coming instead of being surprised by
              it. Only while a sloppy run is actually building, and never at
              the same time as the demotion moment itself. */}
          {demotionBpm == null &&
            (snap.current_sloppy_streak ?? 0) > 0 &&
            snap.focus === "tempo" && (
              <span className="rep-hud-sloppy-run" role="status">
                {snap.current_sloppy_streak} sloppy in a row
              </span>
            )}
          {/* A2: the variant chain's current stage, as a HEADLINE element
              rather than drawer content — he practises a chain hands-free, so
              "which variant am I on and what clears it" has to be readable
              from the piano without opening anything. Lives inside
              `.rep-hud-main`, which the collapsed-HUD rule exempts, so it
              survives a compact HUD. Absent entirely when the set has no
              variants, which is exactly today's behaviour. */}
          {snap.variant_stage_index != null && snap.variant != null && (
            <span className="rep-hud-variant-stage" role="status">
              {snap.variant} · {snap.variant_stage_cleans ?? 0}/
              {snap.variant_stage_required ?? 0}
              {snap.next_variant_stage_name
                ? ` → next: ${snap.next_variant_stage_name}`
                : " · last in the chain"}
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

      {/* The hot loop comes first: after reading the current count, the next
          reachable controls are always Clean / Sloppy / Again. Listen Back,
          shortcut teaching, notes and secondary tools follow this row. */}
      <div
        className="rep-hud-entry"
        data-compact-visible
        aria-busy={busy === "check"}
      >
        <div
          className="rep-hud-actions"
          data-verdict={verdictPulse ?? undefined}
          aria-label="Record attempt verdict"
        >
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
        {snap.region_id != null && (
          <div className="rep-hud-sound-target" data-compact-visible>
            <span>Sound target</span>
            {soundEditing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSoundTarget();
                }}
              >
                <input
                  autoFocus
                  aria-label="Region sound target"
                  value={soundTarget}
                  maxLength={10000}
                  placeholder="sotto voce · grand · like bells"
                  onChange={(event) => setSoundTarget(event.target.value)}
                />
                <button type="submit" disabled={soundBusy}>
                  {soundBusy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={soundBusy}
                  onClick={() => {
                    setSoundTarget(snap.sound_target ?? "");
                    setSoundEditing(false);
                    setSoundError(null);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setSoundEditing(true)}>
                {soundTarget || "Add the sound you’re aiming for…"}
              </button>
            )}
            {soundError && (
              <small role="alert">Could not save: {soundError}</small>
            )}
          </div>
        )}
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

      {/* Count repair stays one gesture away, but follows the verdict row so
          Clean / Sloppy / Again are the first actions after current status.
          `data-compact-visible` keeps it reachable in the deliberate compact
          HUD; it never moves into the secondary More drawer. */}
      <div
        className="rep-hud-adjust"
        data-compact-visible="true"
        aria-label="Adjust the rep count"
      >
        <button
          type="button"
          className="rep-hud-adjust-add"
          disabled={mastered || busy != null}
          onClick={() => void submit("clean")}
        >
          ＋ clean
        </button>
        <button
          type="button"
          className="rep-hud-adjust-undo"
          disabled={busy != null || tries === 0}
          onClick={() => void runUndo()}
        >
          {busy === "undo" ? "Undoing…" : "↩ undo last"}
        </button>
      </div>

      <RepReplayControl
        replay={replay}
        available={replayAvailable}
        unavailableReason={replayUnavailableReason}
      />

      {/* A6 §4b: a hotkey nobody knows about is not a feature. The mapping is
          a one-line hint in the HUD itself — never drawer content — and it
          carries `data-compact-visible` WHILE IT IS STILL TEACHING, so a
          collapsed HUD cannot hide the one thing that explains the keys. Once
          a hotkey has actually recorded a rep it compacts to the bare key names
          and gives its compact-mode slot back. */}
      {hotkeys.enabled && !mastered && (
        <p
          className={`rep-hud-hotkeys ${hotkeyUsed ? "is-learned" : ""}`}
          {...(hotkeyUsed ? {} : { "data-compact-visible": "true" })}
        >
          {hotkeyUsed ? (
            <>
              Keys: {hotkeyLabel(hotkeys.clean)} · {hotkeyLabel(hotkeys.sloppy)}{" "}
              · {hotkeyLabel(hotkeys.again)}
            </>
          ) : (
            <>
              Keys: {hotkeyLabel(hotkeys.clean)} = clean ·{" "}
              {hotkeyLabel(hotkeys.sloppy)} = sloppy ·{" "}
              {hotkeyLabel(hotkeys.again)} = again
            </>
          )}
        </p>
      )}

      {/* The safety stop is never folded away — it stays at top level, above
          the drawer, and is the only element allowed to shout. */}
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

      {/* ONE affordance for everything secondary (defect D3). Undo, the focus
          contract, the metrics, the rare corrections and "Change the condition"
          all used to stack below the verdicts at card spacing, which is most of
          why a three-button decision occupied ~700px. Nothing was removed —
          every control below is still here, one click away. */}
      <details className="rep-hud-drawer">
        <summary>
          <span className="rep-hud-drawer-label">More</span>
          <span className="rep-hud-drawer-hint">
            undo · details · condition
          </span>
        </summary>
        <div className="rep-hud-tools" aria-label="Set controls">
          <button
            type="button"
            disabled={busy != null || tries === 0}
            onClick={() => void runUndo()}
          >
            {busy === "undo" ? "Undoing…" : "Undo"}
          </button>
        </div>
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
              <button
                type="submit"
                disabled={busy != null || !validNarrowRange}
              >
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
              {snap.recovery_actions!.length === 1 ? "choice" : "choices"} in
              this set.
            </small>
          )}
        </details>
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
