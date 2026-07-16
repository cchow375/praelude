import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "./Popover";
import { MetronomePopover } from "../features/metronome/MetronomePopover";
import { useVoice, type VoiceStatus } from "../features/voice/useVoice";
import { VoiceToast } from "../features/voice/VoiceToast";
import { ActionDraftCard } from "../features/voice/ActionDraftCard";
import {
  parseNaturalPracticeActionDraft,
  type NaturalPracticeActionDraft,
} from "../features/voice/domain/actionDraft";
import type { TierAContext } from "../features/voice/domain/tierAIntent";
import { PiecesPanel } from "../features/pieces/PiecesPanel";
import {
  repAttempts,
  repMasteryStatus,
  repMasteryVerified,
  repTries,
  useRep,
  type RepOpenArgs,
  type RepSnapshot,
  type SetFocusContextInput,
} from "../features/rep/useRep";
import { RepHud } from "../features/rep/RepHud";
import { useSession } from "../features/session/useSession";
import { SessionBar } from "../features/session/SessionBar";
import { usePanels } from "./usePanels";
import { BrainWorkspace } from "../features/brain/BrainWorkspace";
import type { PracticeBrainContext, WakeQuestion } from "../features/brain/types";
import { CalendarWorkspace } from "../features/calendar/CalendarWorkspace";
import { UniverseWorkspace } from "../features/universe/UniverseWorkspace";
import type { PracticePieceContext } from "../features/universe/types";
import { TodayWorkspace } from "../features/today/TodayWorkspace";
import { LedgerWorkspace } from "../features/ledger/LedgerWorkspace";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import type { ThemePref } from "../design/theme";
import { version as appVersion } from "../../package.json";
import "./Shell.css";

const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = {
  live: "Listening",
  muted: "Muted",
  down: "Unavailable",
};

type PanelId = "metronome" | "mic" | "settings";
type ViewId = "today" | "atlas" | "ledger" | "calendar" | "universe";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "atlas", label: "Atlas" },
  { id: "ledger", label: "Ledger" },
  { id: "calendar", label: "Calendar" },
  { id: "universe", label: "Universe" },
];

interface PendingVoiceDraft {
  readonly deliveryKey: string;
  readonly draft: NaturalPracticeActionDraft;
}

export interface VoiceDraftOpenRequest {
  readonly args: RepOpenArgs;
  readonly context: SetFocusContextInput;
}

/** Translate an explicitly confirmed Lane-B preview into the existing set API. */
export function voiceDraftOpenRequest(
  draft: NaturalPracticeActionDraft,
): VoiceDraftOpenRequest {
  if (
    draft.piece_id === null
    || draft.target.m_start === null
    || draft.target.m_end === null
    || draft.issues.length > 0
  ) throw new Error("The voice draft still needs input.");

  const tempoFocused = draft.contract.start_bpm !== null
    || draft.contract.target_bpm !== null
    || draft.contract.method === "tempo ladder";
  const focus = tempoFocused
    ? "tempo"
    : draft.contract.hands !== null
      ? "hands"
      : "notes";
  return {
    args: {
      piece_id: draft.piece_id,
      region_id: null,
      m_start: draft.target.m_start,
      m_end: draft.target.m_end,
      label: null,
      start_bpm: draft.contract.start_bpm,
      target_bpm: draft.contract.target_bpm,
      planned_reps: draft.contract.planned_attempts,
      required_clean_streak: draft.contract.required_clean_streak,
      // Preserve the configured native ladder defaults. The preview specifies
      // the contract, not a second hidden clean-count or BPM-step policy.
      increment: null,
      variants: [],
      focus,
      use_metronome: draft.contract.use_metronome,
    },
    context: {
      intention: draft.contract.intention,
      judging_axis: tempoFocused ? "pulse" : "accuracy",
      hands: draft.contract.hands,
      method: draft.contract.method,
      planned_seconds: null,
      reflection: null,
    },
  };
}

export function groundPracticeBrainContext(
  context: PracticeBrainContext | null,
  snap: RepSnapshot | null,
): PracticeBrainContext | null {
  if (!context) return null;
  return {
    ...context,
    active_block: snap?.piece_id === context.piece_id ? {
      m_start: snap.m_start,
      m_end: snap.m_end,
      bpm: snap.bpm,
      target_bpm: snap.target_bpm,
      focus: snap.focus,
      use_metronome: snap.use_metronome,
      reps_done: snap.reps_done,
      planned_reps: snap.planned_reps,
      attempts_recorded: repAttempts(snap),
      tries: repTries(snap),
      current_clean_streak: snap.current_clean_streak ?? null,
      mastery_progress_streak: snap.mastery_progress_streak
        ?? snap.current_clean_streak
        ?? null,
      required_clean_streak: snap.effective_required_clean_streak
        ?? snap.required_clean_streak
        ?? null,
      mastery_status: repMasteryStatus(snap),
      mastery_verified: repMasteryVerified(snap),
      set_state: snap.set_state ?? "legacy_unverified",
    } : null,
  };
}

/** The v2 instrument shell: one rail, one work surface, one authoritative Set Desk. */
export function Shell({
  defaultCleanStreak = 5,
  onThemeChange,
  onInterfaceScaleChange,
  onPracticeDefaultCleanStreakChange,
}: {
  defaultCleanStreak?: number;
  onThemeChange?: (theme: ThemePref) => void;
  onInterfaceScaleChange?: (scale: number) => void;
  onPracticeDefaultCleanStreakChange?: (target: number) => void;
}) {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [view, setView] = useState<ViewId>("today");
  const [practiceContext, setPracticeContext] = useState<PracticePieceContext | null>(null);
  const [wakeQuestion, setWakeQuestion] = useState<WakeQuestion | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const [setDeskOpen, setSetDeskOpen] = useState(false);
  const [brainPracticeContext, setBrainPracticeContext] = useState<PracticeBrainContext | null>(null);
  const [ending, setEnding] = useState(false);
  const [pendingVoiceDraft, setPendingVoiceDraft] = useState<PendingVoiceDraft | null>(null);
  const [voiceDraftConfirming, setVoiceDraftConfirming] = useState(false);
  const [voiceDraftError, setVoiceDraftError] = useState<string | null>(null);
  const wakeQuestionId = useRef(0);
  const lastOpenedSet = useRef<number | null>(null);
  const suppressedVoiceDrafts = useRef(new Set<string>());
  const voiceDraftInFlight = useRef<string | null>(null);
  const brainRef = useRef<HTMLButtonElement>(null);
  const brainCloseRef = useRef<HTMLButtonElement>(null);
  const setDeskRef = useRef<HTMLButtonElement>(null);
  const setDeskCloseRef = useRef<HTMLButtonElement>(null);
  const metronomeRef = useRef<HTMLButtonElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const viewTabRefs = useRef<Partial<Record<ViewId, HTMLButtonElement | null>>>({});
  const rep = useRep();
  const tierAContext = useMemo<TierAContext>(() => {
    const snap = rep.snap;
    const paused = snap?.timer_state === "paused" || snap?.set_state === "paused";
    return {
      practice_state: snap == null ? "idle" : paused ? "paused" : "active",
      metronome_running: snap?.use_metronome === true && !paused,
      last_attempt_available: snap != null
        && (snap.last_attempt_id != null || repTries(snap) > 0),
      // The installed event payload does not expose these two native queue
      // projections yet. False is fail-closed; native routing remains owner.
      pending_duplicate_attempt: false,
      retention_due: snap?.retention_check?.state === "due",
    };
  }, [rep.snap]);
  const voice = useVoice(tierAContext);
  const session = useSession();
  // Kept only as a compatibility bridge for the existing Settings recovery
  // action. The v2 Set Desk itself has no persisted floating geometry.
  const legacyLayout = usePanels();
  const groundedBrainContext = useMemo(
    () => groundPracticeBrainContext(brainPracticeContext, rep.snap),
    [brainPracticeContext, rep.snap],
  );
  const selectedDraftPiece = useMemo(() => ({
    pieceId: brainPracticeContext?.piece_id ?? practiceContext?.piece_id ?? null,
    pieceTitle: brainPracticeContext?.piece_title ?? practiceContext?.title ?? null,
  }), [brainPracticeContext?.piece_id, brainPracticeContext?.piece_title, practiceContext?.piece_id, practiceContext?.title]);

  useEffect(() => {
    if (voice.lastIntent?.kind !== "question") return;
    wakeQuestionId.current += 1;
    setWakeQuestion({ id: wakeQuestionId.current, text: voice.lastIntent.text });
    setSetDeskOpen(false);
    setBrainOpen(true);
    requestAnimationFrame(() => brainCloseRef.current?.focus());
  }, [voice.lastIntent]);

  useEffect(() => {
    const delivery = voice.acceptedFinalDelivery;
    const parsed = voice.tierAResult;
    if (!delivery || !parsed) return;
    const deliveryKey = `${delivery.delivery_id}:r${delivery.revision}`;
    if (suppressedVoiceDrafts.current.has(deliveryKey)) return;
    // The backend's routing decision owns the utterance. A final it already
    // routed and acted on (e.g. a canonical rep-open) must never also produce a
    // Lane-B draft — that was the cross-lane double-open. Lane B may only draft
    // what the backend declined to route.
    if (delivery.handled === true) return;
    if (
      parsed.evidence.delivery_id !== delivery.delivery_id
      || parsed.evidence.revision !== delivery.revision
      || parsed.classification !== "ignored"
      || parsed.reason !== "not_exact_command"
    ) return;

    // Lane B is bounded to a natural start-set preview. Ambient narration and
    // ambiguous text return null and do not open, write, or alter any control.
    const draft = parseNaturalPracticeActionDraft(delivery.text, {
      piece_id: selectedDraftPiece.pieceId,
      piece_title: selectedDraftPiece.pieceTitle,
      default_clean_streak: defaultCleanStreak,
    });
    if (!draft) return;
    setPendingVoiceDraft({ deliveryKey, draft });
    setVoiceDraftError(null);
    setOpenPanel("mic");
  }, [
    defaultCleanStreak,
    selectedDraftPiece.pieceId,
    selectedDraftPiece.pieceTitle,
    voice.acceptedFinalDelivery,
    voice.tierAResult,
  ]);

  const suppressVoiceDraft = useCallback((deliveryKey: string) => {
    suppressedVoiceDrafts.current.add(deliveryKey);
    if (suppressedVoiceDrafts.current.size > 100) {
      const oldest = suppressedVoiceDrafts.current.values().next().value;
      if (oldest) suppressedVoiceDrafts.current.delete(oldest);
    }
  }, []);

  const cancelVoiceDraft = useCallback(() => {
    if (pendingVoiceDraft) suppressVoiceDraft(pendingVoiceDraft.deliveryKey);
    setPendingVoiceDraft(null);
    setVoiceDraftError(null);
  }, [pendingVoiceDraft, suppressVoiceDraft]);

  const confirmVoiceDraft = useCallback(async (
    deliveryKey: string,
    draft: NaturalPracticeActionDraft,
  ) => {
    if (voiceDraftInFlight.current !== null) return;
    voiceDraftInFlight.current = deliveryKey;
    setVoiceDraftConfirming(true);
    setVoiceDraftError(null);
    try {
      const request = voiceDraftOpenRequest(draft);
      await rep.open(request.args, request.context);
      suppressVoiceDraft(deliveryKey);
      setPendingVoiceDraft((current) =>
        current?.deliveryKey === deliveryKey ? null : current
      );
      setOpenPanel(null);
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "The spoken set could not be opened.";
      setVoiceDraftError(message);
    } finally {
      if (voiceDraftInFlight.current === deliveryKey) {
        voiceDraftInFlight.current = null;
        setVoiceDraftConfirming(false);
      }
    }
  }, [rep.open, suppressVoiceDraft]);

  useEffect(() => {
    const blockId = rep.snap?.block_id ?? null;
    if (blockId == null || blockId === lastOpenedSet.current) return;
    lastOpenedSet.current = blockId;
    setBrainOpen(false);
    setSetDeskOpen(true);
    requestAnimationFrame(() => setDeskCloseRef.current?.focus());
  }, [rep.snap?.block_id]);

  const toggle = (id: PanelId) => setOpenPanel((current) => current === id ? null : id);
  const close = () => setOpenPanel(null);
  const closeBrain = useCallback(() => {
    setBrainOpen(false);
    requestAnimationFrame(() => brainRef.current?.focus());
  }, []);
  const openBrain = useCallback(() => {
    setSetDeskOpen(false);
    setBrainOpen(true);
    requestAnimationFrame(() => brainCloseRef.current?.focus());
  }, []);
  const openSetDesk = useCallback(() => {
    setBrainOpen(false);
    setSetDeskOpen(true);
    requestAnimationFrame(() => setDeskCloseRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!brainOpen && !setDeskOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (brainOpen) closeBrain();
      else {
        setSetDeskOpen(false);
        requestAnimationFrame(() => setDeskRef.current?.focus());
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [brainOpen, closeBrain, setDeskOpen]);

  const navigateView = (nextView: ViewId, focus = false) => {
    setView(nextView);
    if (focus) requestAnimationFrame(() => viewTabRefs.current[nextView]?.focus());
  };

  const openPiece = (piece: PracticePieceContext) => {
    setPracticeContext(piece);
    navigateView("atlas");
  };

  const onViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: ViewId) => {
    const index = VIEWS.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % VIEWS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEWS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    navigateView(VIEWS[nextIndex].id, true);
  };

  const endSession = async () => {
    setEnding(true);
    try {
      await session.endSession();
    } catch {
      // useSession preserves the live session and publishes the receipt.
    } finally {
      setEnding(false);
    }
  };

  const activeRange = rep.snap
    ? rep.snap.m_start === rep.snap.m_end
      ? `m. ${rep.snap.m_start}`
      : `mm. ${rep.snap.m_start}–${rep.snap.m_end}`
    : null;

  return (
    <div className="shell">
      <aside className="instrument-rail" aria-label="CodaKiller navigation">
        <div className="rail-identity" aria-label={`CodaKiller version ${appVersion}`}>
          <span className="rail-monogram" aria-hidden="true">CK</span>
          <span className="rail-wordmark">Coda<br />Killer</span>
        </div>

        <nav className="view-switcher" aria-label="Workspace" role="tablist" aria-orientation="vertical">
          {VIEWS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { viewTabRefs.current[item.id] = node; }}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-controls={`panel-${item.id}`}
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              className={`view-tab ${view === item.id ? "is-on" : ""}`}
              onClick={() => navigateView(item.id)}
              onKeyDown={(event) => onViewKeyDown(event, item.id)}
            >
              <NavGlyph view={item.id} />
              <span>{item.label}</span>
              <small aria-hidden="true">0{index + 1}</small>
            </button>
          ))}
        </nav>

        <span className="rail-version" aria-label={`Version ${appVersion}`}>v{appVersion}</span>
      </aside>

      <section className="shell-stage">
        <header className="contextbar">
          <div className="contextbar-path">
            <span>CodaKiller</span><b aria-hidden="true">/</b>
            <strong>{VIEWS.find((item) => item.id === view)?.label}</strong>
            {rep.snap && <><b aria-hidden="true">/</b><span className="contextbar-set">{rep.snap.piece_title} · {activeRange}</span></>}
          </div>

          <div className="contextbar-tools">
            {session.session && (
              <div className="shell-session-dock">
                <SessionBar session={session.session} onEnd={endSession} ending={ending} />
              </div>
            )}
            {rep.snap && !setDeskOpen && (
              <button
                ref={setDeskRef}
                type="button"
                className="set-desk-launch"
                aria-controls="active-set-desk"
                aria-expanded={false}
                onClick={openSetDesk}
              >
                <span>Set</span>
                <strong>{rep.snap.current_clean_streak ?? "—"}/{rep.snap.effective_required_clean_streak ?? rep.snap.required_clean_streak ?? "—"}</strong>
              </button>
            )}
            <button
              ref={brainRef}
              type="button"
              className={`brain-tool-button ${brainOpen ? "is-on" : ""}`}
              aria-controls="practice-brain-drawer"
              aria-expanded={brainOpen}
              onClick={() => brainOpen ? closeBrain() : openBrain()}
            >
              <BrainGlyph /><span>Brain</span>
            </button>
            <button ref={metronomeRef} type="button" className="icon-button" aria-label="Metronome" aria-haspopup="dialog" aria-expanded={openPanel === "metronome"} onClick={() => toggle("metronome")}>
              <MetronomeGlyph />
            </button>
            <button ref={micRef} type="button" className={`icon-button voice-mic is-${voice.status}`} aria-label="Microphone" aria-haspopup="dialog" aria-expanded={openPanel === "mic"} onClick={() => toggle("mic")}>
              <MicGlyph /><span className="voice-status-dot" data-status={voice.status} aria-hidden="true" />
            </button>
            <button ref={settingsRef} type="button" className="icon-button" aria-label="Settings" aria-haspopup="dialog" aria-expanded={openPanel === "settings"} onClick={() => toggle("settings")}>
              <SettingsGlyph />
            </button>
          </div>
        </header>

        <div className="shell-workspace">
          {view === "today" ? (
            <div id="panel-today" role="tabpanel" aria-labelledby="tab-today" className="workspace-panel-reset">
              <TodayWorkspace
                onOpenAtlas={() => navigateView("atlas")}
                onOpenCalendar={() => navigateView("calendar")}
                onOpenPiece={openPiece}
                defaultCleanStreak={defaultCleanStreak}
                activeBlock={rep.snap}
              />
            </div>
          ) : view === "atlas" ? (
            <div id="panel-atlas" role="tabpanel" aria-labelledby="tab-atlas" className="workspace-panel-reset">
              <main className="practice-main" data-testid="main-practice">
                <PiecesPanel
                  onOpenBlock={rep.open}
                  activeRep={rep.snap}
                  defaultCleanStreak={defaultCleanStreak}
                  initialPieceId={practiceContext?.piece_id ?? null}
                  onLeavePiece={() => setPracticeContext(null)}
                  onPracticeContextChange={setBrainPracticeContext}
                />
              </main>
            </div>
          ) : view === "ledger" ? (
            <div id="panel-ledger" role="tabpanel" aria-labelledby="tab-ledger" className="workspace-panel-reset"><LedgerWorkspace /></div>
          ) : view === "calendar" ? (
            <div id="panel-calendar" role="tabpanel" aria-labelledby="tab-calendar" className="workspace-panel-reset"><CalendarWorkspace /></div>
          ) : (
            <div id="panel-universe" role="tabpanel" aria-labelledby="tab-universe" className="workspace-panel-reset">
              <UniverseWorkspace onOpenPractice={(piece) => piece ? openPiece(piece) : navigateView("atlas")} />
            </div>
          )}
        </div>
      </section>

      <MetronomePopover anchorRef={metronomeRef} open={openPanel === "metronome"} onClose={close} />
      <Popover anchorRef={micRef} open={openPanel === "mic"} onClose={close} label="Microphone" size="wide">
        <div className="voice-command-surface">
          <VoiceMicPanel status={voice.status} onMute={voice.mute} />
          {pendingVoiceDraft && (
            <ActionDraftCard
              draft={pendingVoiceDraft.draft}
              confirming={voiceDraftConfirming}
              onCancel={cancelVoiceDraft}
              onConfirm={(draft) => confirmVoiceDraft(
                pendingVoiceDraft.deliveryKey,
                draft,
              )}
            />
          )}
          {voiceDraftError && <p className="voice-draft-error" role="alert">{voiceDraftError}</p>}
        </div>
      </Popover>
      <Popover anchorRef={settingsRef} open={openPanel === "settings"} onClose={close} label="Settings" size="wide">
        <SettingsPanel
          onResetLayout={legacyLayout.resetLayout}
          onThemeSaved={onThemeChange}
          onInterfaceScaleSaved={onInterfaceScaleChange}
          onPracticeDefaultCleanStreakSaved={onPracticeDefaultCleanStreakChange}
        />
      </Popover>

      <aside
        id="practice-brain-drawer"
        className={`practice-brain-drawer ${brainOpen ? "is-open" : ""}`}
        aria-label="Practice Brain"
        aria-hidden={!brainOpen}
        inert={brainOpen ? undefined : true}
      >
        <header className="practice-brain-drawer-head">
          <div><span>Practice Brain</span><small>Grounded librarian</small></div>
          <button ref={brainCloseRef} type="button" aria-label="Collapse Practice Brain" onClick={closeBrain}><span aria-hidden="true">×</span></button>
        </header>
        <div className="practice-brain-drawer-body">
          <BrainWorkspace compact wakeQuestion={wakeQuestion} practiceContext={groundedBrainContext} />
        </div>
      </aside>

      {rep.snap && (
        <aside
          id="active-set-desk"
          className={`set-desk ${setDeskOpen ? "is-open" : ""}`}
          aria-label="Set Desk"
          aria-hidden={!setDeskOpen}
          inert={setDeskOpen ? undefined : true}
        >
          <header className="set-desk-head">
            <div><span className="ck-kicker">Authoritative practice contract</span><strong>Set Desk</strong></div>
            <button
              ref={setDeskCloseRef}
              type="button"
              aria-label="Hide Set Desk"
              onClick={() => {
                setSetDeskOpen(false);
                requestAnimationFrame(() => setDeskRef.current?.focus());
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="set-desk-body">
            <RepHud
              snap={rep.snap}
              feed={rep.feed}
              error={rep.error}
              onCheck={rep.check}
              onUndo={rep.undo}
              onCorrect={rep.correct}
              onReverseAdjustment={rep.reverseAdjustment}
              onRestart={rep.restart}
              onPause={rep.pause}
              onResume={rep.resume}
              onReflect={rep.reflect}
              onSafetyStop={rep.safetyStop}
              onRecover={rep.recover}
              onClose={rep.close}
            />
          </div>
        </aside>
      )}

      <VoiceToast lastIntent={voice.lastIntent} status={voice.status} downGuidance={voice.downGuidance} deliveryDisposition={voice.deliveryDisposition} />
      {rep.error && !rep.snap && <p className="shell-rep-error" role="alert">{rep.error}</p>}
    </div>
  );
}

function VoiceMicPanel({ status, onMute }: { status: VoiceStatus; onMute: (muted: boolean) => void }) {
  const isMuted = status === "muted";
  return (
    <div className="voice-panel">
      <div className="voice-panel-status"><span className="voice-status-dot" data-status={status} aria-hidden="true" /><span className="voice-panel-label">{VOICE_STATUS_LABEL[status]}</span></div>
      <button type="button" className="voice-panel-button" onClick={() => onMute(!isMuted)}>{isMuted ? "Unmute" : "Mute"}</button>
    </div>
  );
}

function NavGlyph({ view }: { view: ViewId }) {
  if (view === "today") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16M7.5 4v7M16.5 4v7M5 5.5h14v14H5z" /></svg>;
  if (view === "atlas") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 5-2 6 2 5-2v16l-5 2-6-2-5 2zM9 3v16M15 5v16" /></svg>;
  if (view === "ledger") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>;
  if (view === "calendar") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v14H5zM8 3v6M16 3v6M5 10h14" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" /><path d="M3 12c3-4 15-4 18 0-3 4-15 4-18 0ZM12 3c4 3 4 15 0 18-4-3-4-15 0-18Z" /></svg>;
}

function BrainGlyph() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5c.8 3.8 2.7 5.7 6.5 6.5-3.8.8-5.7 2.7-6.5 6.5-.8-3.8-2.7-5.7-6.5-6.5 3.8-.8 5.7-2.7 6.5-6.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M18.5 16.5c.3 1.5 1.2 2.4 2.7 2.7-1.5.3-2.4 1.2-2.7 2.7-.3-1.5-1.2-2.4-2.7-2.7 1.5-.3 2.4-1.2 2.7-2.7Z" fill="currentColor" /></svg>;
}

function MetronomeGlyph() {
  return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M9 3.5h6l3.5 17H5.5L9 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 18 16 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="7" r="1.4" fill="currentColor" /></svg>;
}

function MicGlyph() {
  return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function SettingsGlyph() {
  return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
