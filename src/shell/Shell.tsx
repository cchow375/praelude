import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceStub } from "./WorkspaceStub";
import { ASSISTANT, HISTORY } from "./terms";
import { TodayWorkspace } from "../features/today/TodayWorkspace";
import { TodaySheetProvider } from "../features/notebook/DaySheetStore";
import { todayLocal } from "../features/calendar/dates";
import {
  readTodayPlan,
  TODAY_PLAN_CHANGED_EVENT,
} from "../features/today/todayPlan";
import type { PracticePieceContext } from "../features/universe/types";
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
import { DockProvider } from "../features/dock/DockProvider";
import { RepPanel } from "../features/dock/RepPanel";
import { PausedSetsTray } from "../features/dock/PausedSetsTray";
import { ClockPanel } from "../features/dock/ClockPanel";
import { useSession } from "../features/session/useSession";
import { SessionBar } from "../features/session/SessionBar";
import { useVoice } from "../features/voice/useVoice";
import { VoiceToast } from "../features/voice/VoiceToast";
import {
  ActionDraftCard,
  type ActionDraft,
} from "../features/voice/ActionDraftCard";
import {
  parseNaturalPracticeActionDraft,
  type NaturalPracticeActionDraft,
} from "../features/voice/domain/actionDraft";
import type { TierAContext } from "../features/voice/domain/tierAIntent";
import type { ProposedAction } from "../features/voice/domain/proposedAction";
import { parseSpokenConfirmationDecision } from "../features/voice/domain/spokenConfirmation";
import { parseAssistantDirectedQuestion } from "../features/voice/domain/assistantDirected";
import { actionDraftSpeech } from "../features/voice/domain/actionDraftSpeech";
import type {
  PracticeBrainContext,
  WakeQuestion,
} from "../features/brain/types";
import type { BrainProposedActionEvent } from "../features/brain/BrainWorkspace";
import { MetronomePopover } from "../features/metronome/MetronomePopover";
import { useMetronome } from "../features/metronome/useMetronome";
import type { LedgerSurface } from "../features/ledger/LedgerCalendarWorkspace";
import "./shell.css";

/**
 * The v3 app shell: exactly FIVE workspace slots and one quiet text-button nav.
 * The active target is marked by ink weight, never a filled pill. Score/Brain/
 * Ledger/Universe are lazy-loaded (a WorkspaceStub stands in until each phase
 * rebuilds it); Today (Phase 5) is rendered directly so the shell can pass it
 * the live rep snapshot and navigation handlers.
 *
 * The shell OWNS the three app-level practice state machines — rep engine,
 * session, and voice — so the active-block HUD, the session bar, and the voice
 * surfaces (STT toast + wake-cue confirm card) persist across every workspace,
 * exactly as the pre-v3 shell mounted them. Their logic and the voice event
 * wiring are unchanged; only their chrome is restyled on the monochrome kit.
 *
 * Motion budget: one staggered entrance on load (CSS, runs once). No loops.
 */

const WORKSPACES = [
  { id: "today", label: "Today" },
  { id: "score", label: "Score" },
  { id: "brain", label: ASSISTANT },
  // The Ledger/Calendar slot (Phase 6 fills both behind this one entry).
  { id: "ledger", label: HISTORY },
  { id: "universe", label: "Universe" },
] as const;

type WorkspaceId = (typeof WORKSPACES)[number]["id"];
type View = WorkspaceId | "settings";

/**
 * Quiet monochrome rail glyphs (B4). Every icon is inline SVG on a 24-unit
 * grid, a consistent 1.5px stroke in currentColor so it dims/brightens with
 * its label and the active ink weight — no emoji, no icon-font dependency, no
 * fill except the small "today" and bullet accents. The glyph is decorative:
 * the visible text label names the target, so the SVG is aria-hidden and the
 * accessible name still comes from the label alone.
 */
function ShellGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="shell-nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const NAV_ICONS: Record<WorkspaceId, ReactNode> = {
  today: (
    <ShellGlyph>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
    </ShellGlyph>
  ),
  score: (
    <ShellGlyph>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </ShellGlyph>
  ),
  brain: (
    <ShellGlyph>
      <path d="M20.5 11.7a8 8 0 0 1-8.6 8 8 8 0 0 1-3.4-.9L3.5 20.5l1.7-5a8 8 0 0 1-.7-3.3 8 8 0 0 1 8-8h.5a8 8 0 0 1 7.5 7.5Z" />
    </ShellGlyph>
  ),
  ledger: (
    <ShellGlyph>
      <circle cx="4" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <line x1="8" y1="6.5" x2="20.5" y2="6.5" />
      <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <line x1="8" y1="12" x2="20.5" y2="12" />
      <circle cx="4" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
      <line x1="8" y1="17.5" x2="16" y2="17.5" />
    </ShellGlyph>
  ),
  universe: (
    <ShellGlyph>
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-28 12 12)" />
    </ShellGlyph>
  ),
};

function MetronomeGlyph() {
  return (
    <ShellGlyph>
      <path d="M9.3 4.5h5.4l3 15.5H6.3z" />
      <line x1="6.6" y1="15.5" x2="17.4" y2="15.5" />
      <line x1="12" y1="17.5" x2="15" y2="8" />
      <circle cx="15" cy="8" r="1" fill="currentColor" stroke="none" />
    </ShellGlyph>
  );
}

function SettingsGlyph() {
  return (
    <ShellGlyph>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="10" cy="8" r="2.4" fill="var(--bg-sunken)" />
      <circle cx="15" cy="16" r="2.4" fill="var(--bg-sunken)" />
    </ShellGlyph>
  );
}

const BrainWorkspace = lazy(() =>
  import("../features/brain/BrainWorkspace").then((m) => ({
    default: m.BrainWorkspace,
  })),
);

// The Score workspace needs the shell's rep hook: ScoreView's Practice tab
// renders nothing without onOpenBlock, so a block started on the score must
// open through the same rep.open that feeds the shell-level RepHud.
const ScoreWorkspace = lazy(() =>
  import("../features/score/ScoreWorkspace").then((m) => ({
    default: m.ScoreWorkspace,
  })),
);

// One slot hosts the two history surfaces AND the piece browser/intake/goals
// surface (the plan's "Ledger/Calendar", extended in Phase 8.1); the nav stays
// five entries labelled "Ledger", with an in-workspace switch. It is mounted
// WITH the shell's rep hook so a practice block opened from the Pieces surface
// reflects in the shell-level RepHud, exactly like the voice-draft path.
const LedgerCalendarWorkspace = lazy(() =>
  import("../features/ledger/LedgerCalendarWorkspace").then((m) => ({
    default: m.LedgerCalendarWorkspace,
  })),
);

// The Universe force graph (Phase 7). Lazy like the rest, but mounted with
// navigation props so its detail panel can jump into Score and the Ledger.
const UniverseWorkspace = lazy(() =>
  import("../features/universe/UniverseWorkspace").then((m) => ({
    default: m.UniverseWorkspace,
  })),
);

interface PendingVoiceDraft {
  readonly deliveryKey: string;
  readonly contextKey: string;
  readonly draft: NaturalPracticeActionDraft;
}

interface PendingBrainAction {
  readonly answerId: string;
  readonly targetBlockId: number | null;
  readonly action: ProposedAction;
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
    draft.piece_id === null ||
    draft.target.m_start === null ||
    draft.target.m_end === null ||
    draft.issues.length > 0
  )
    throw new Error("The voice draft still needs input.");

  const tempoFocused =
    draft.contract.start_bpm !== null ||
    draft.contract.target_bpm !== null ||
    draft.contract.method === "tempo ladder";
  const focus = tempoFocused
    ? "tempo"
    : draft.contract.hands !== null
      ? "hands"
      : "notes";
  return {
    args: {
      piece_id: draft.piece_id,
      region_id: draft.target.region_id ?? null,
      m_start: draft.target.m_start,
      m_end: draft.target.m_end,
      label: draft.target.label ?? null,
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

/** Add the authoritative active RepEngine projection to the visible UI target. */
export function groundPracticeBrainContext(
  context: PracticeBrainContext | null,
  snap: RepSnapshot | null,
): PracticeBrainContext | null {
  if (!context) return null;
  return {
    ...context,
    active_block:
      snap?.piece_id === context.piece_id
        ? {
            block_id: snap.block_id,
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
            mastery_progress_streak:
              snap.mastery_progress_streak ?? snap.current_clean_streak ?? null,
            required_clean_streak:
              snap.effective_required_clean_streak ??
              snap.required_clean_streak ??
              null,
            mastery_status: repMasteryStatus(snap),
            mastery_verified: repMasteryVerified(snap),
            set_state: snap.set_state ?? "legacy_unverified",
          }
        : null,
  };
}

function practiceContextKey(context: PracticeBrainContext | null): string {
  if (!context) return "none";
  return [
    context.piece_id,
    context.region?.id ?? "no-region",
    context.region?.m_start ?? "no-start",
    context.region?.m_end ?? "no-end",
    context.current_page ?? "no-page",
    context.edition_id ?? "no-edition",
  ].join(":");
}

export interface ShellProps {
  /** The real Settings surface (Task 2.4). Falls back to a stub when absent. */
  settingsContent?: ReactNode;
  /** Persisted default consecutive-clean target for new spoken/composed sets. */
  defaultCleanStreak?: number;
}

// D1/D4 (historical): the active-set card used to be an in-flow strip pinned
// under the fixed session overlay via a top margin + 680px max-height. The
// session strip has lived in the header band since, and the active-set card
// itself moved into a floating Practice Dock panel (Task A3) — it no longer
// occupies stage layout at all.
const VOICE_DRAFT_STYLE: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "var(--s-5)",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100vw - 2 * var(--s-4)))",
  zIndex: 95,
};

const ACTIVE_SET_DRAFT_UNAVAILABLE =
  "A practice set is already active. Close or finish it before starting another.";

export function Shell({ settingsContent, defaultCleanStreak = 5 }: ShellProps) {
  const [view, setView] = useState<View>("today");
  const [settingsReturnView, setSettingsReturnView] =
    useState<WorkspaceId>("today");
  const [requestedScorePiece, setRequestedScorePiece] = useState({
    pieceId: null as number | null,
    tab: null as null | "plan",
    revision: 0,
  });
  const [ledgerSurface, setLedgerSurface] = useState<LedgerSurface>("ledger");
  const [requestedLedgerPiece, setRequestedLedgerPiece] = useState({
    pieceId: null as number | null,
    revision: 0,
  });
  const [repHudCollapsed, setRepHudCollapsed] = useState(
    () => window.innerWidth <= 800 || window.innerHeight <= 620,
  );
  const [scorePracticeContext, setScorePracticeContext] =
    useState<PracticeBrainContext | null>(null);
  const [ledgerPracticeContext, setLedgerPracticeContext] =
    useState<PracticeBrainContext | null>(null);
  const lastVisiblePracticeContext = useRef<PracticeBrainContext | null>(null);
  const [wakeQuestion, setWakeQuestion] = useState<WakeQuestion | null>(null);
  const wakeQuestionId = useRef(0);
  const today = todayLocal();
  const [todayPlan, setTodayPlan] = useState(() => readTodayPlan(today));
  const tabRefs = useRef<
    Partial<Record<WorkspaceId, HTMLButtonElement | null>>
  >({});

  const rep = useRep();
  const metronome = useMetronome();
  const tierAContext = useMemo<TierAContext>(() => {
    const snap = rep.snap;
    const paused =
      snap?.timer_state === "paused" || snap?.set_state === "paused";
    return {
      practice_state: snap == null ? "idle" : paused ? "paused" : "active",
      metronome_running: metronome.state.running,
      last_attempt_available:
        snap != null && (snap.last_attempt_id != null || repTries(snap) > 0),
      pending_duplicate_attempt: false,
      retention_due: snap?.retention_check?.state === "due",
    };
  }, [metronome.state.running, rep.snap]);
  const voice = useVoice(tierAContext);
  const session = useSession();
  const [ending, setEnding] = useState(false);
  const repFallbackContext = useMemo<PracticeBrainContext | null>(() => {
    if (!rep.snap) return null;
    return {
      piece_id: rep.snap.piece_id,
      piece_title: rep.snap.piece_title,
      composer: null,
      surface: "details",
      region: null,
      current_page: null,
      edition_id: null,
      edition_label: null,
      active_block: null,
    };
  }, [rep.snap]);
  const screenPracticeContext =
    view === "score"
      ? scorePracticeContext
      : view === "ledger"
        ? ledgerPracticeContext
        : null;
  if (view !== "brain") {
    // Leaving Score/Pieces for Today, Calendar, Universe, or Settings clears
    // the old visual target. Entering Brain directly preserves the context
    // captured on the immediately preceding render.
    lastVisiblePracticeContext.current = screenPracticeContext;
  }
  const visiblePracticeContext =
    screenPracticeContext ??
    (view === "brain" ? lastVisiblePracticeContext.current : null) ??
    repFallbackContext;
  const groundedBrainContext = useMemo(() => {
    const context = groundPracticeBrainContext(
      visiblePracticeContext,
      rep.snap,
    );
    return context
      ? { ...context, today_plan: todayPlan.trim() || null }
      : null;
  }, [rep.snap, todayPlan, visiblePracticeContext]);
  const visiblePracticeContextKey = practiceContextKey(visiblePracticeContext);

  // The free-standing manual metronome control (BPM/boost/sound/live state +
  // metro_stop). In-set tempo lives in the RepHud; this is the standalone
  // instrument, re-homed at the shell rail as it was in the pre-v3 header.
  const metroButtonRef = useRef<HTMLButtonElement>(null);
  const [metroOpen, setMetroOpen] = useState(false);

  const [pendingVoiceDraft, setPendingVoiceDraft] =
    useState<PendingVoiceDraft | null>(null);
  const [voiceDraftConfirming, setVoiceDraftConfirming] = useState(false);
  const [voiceDraftError, setVoiceDraftError] = useState<string | null>(null);
  const [pendingBrainAction, setPendingBrainAction] =
    useState<PendingBrainAction | null>(null);
  const [brainActionConfirming, setBrainActionConfirming] = useState(false);
  const [brainActionError, setBrainActionError] = useState<string | null>(null);
  const suppressedVoiceDrafts = useRef(new Set<string>());
  const voiceDraftInFlight = useRef<string | null>(null);
  const latestVoiceDraft = useRef<PendingVoiceDraft | null>(null);
  const suppressedBrainActions = useRef(new Set<string>());
  const brainActionInFlight = useRef<string | null>(null);
  const handledConfirmationDeliveries = useRef(new Set<string>());
  const routedNaturalQuestions = useRef(new Set<string>());
  const spokenDraftKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!rep.snap && voiceDraftError === ACTIVE_SET_DRAFT_UNAVAILABLE) {
      setVoiceDraftError(null);
    }
  }, [rep.snap, voiceDraftError]);

  useEffect(() => {
    setTodayPlan(readTodayPlan(today));
  }, [today]);

  useEffect(() => {
    const onTodayPlanChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string; value?: string }>)
        .detail;
      if (detail?.date === today && typeof detail.value === "string") {
        setTodayPlan(detail.value);
      }
    };
    window.addEventListener(TODAY_PLAN_CHANGED_EVENT, onTodayPlanChanged);
    return () =>
      window.removeEventListener(TODAY_PLAN_CHANGED_EVENT, onTodayPlanChanged);
  }, [today]);

  useEffect(() => {
    if (voice.lastIntent?.kind !== "question") return;
    wakeQuestionId.current += 1;
    setWakeQuestion({
      id: wakeQuestionId.current,
      text: voice.lastIntent.text,
    });
    setView("brain");
  }, [voice.lastIntent]);

  const suppressVoiceDraft = useCallback((deliveryKey: string) => {
    suppressedVoiceDrafts.current.add(deliveryKey);
    if (suppressedVoiceDrafts.current.size > 100) {
      const oldest = suppressedVoiceDrafts.current.values().next().value;
      if (oldest) suppressedVoiceDrafts.current.delete(oldest);
    }
  }, []);

  // Lane B: a spoken final the backend declined to route may propose a natural
  // start-set preview. Nothing opens until the user explicitly confirms. This
  // mirrors the pre-v3 shell wiring exactly; only the surface chrome changed.
  useEffect(() => {
    const delivery = voice.acceptedFinalDelivery;
    const parsed = voice.tierAResult;
    if (!delivery || !parsed) return;
    const deliveryKey = `${delivery.delivery_id}:r${delivery.revision}`;
    if (suppressedVoiceDrafts.current.has(deliveryKey)) return;
    if (delivery.handled === true) return;
    if (
      parsed.evidence.delivery_id !== delivery.delivery_id ||
      parsed.evidence.revision !== delivery.revision ||
      parsed.classification !== "ignored" ||
      parsed.reason !== "not_exact_command"
    )
      return;
    if (pendingBrainAction || pendingVoiceDraft) return;
    const draft = parseNaturalPracticeActionDraft(delivery.text, {
      piece_id: visiblePracticeContext?.piece_id ?? null,
      piece_title: visiblePracticeContext?.piece_title ?? null,
      default_clean_streak: defaultCleanStreak,
      target: visiblePracticeContext?.region
        ? {
            region_id: visiblePracticeContext.region.id,
            label: visiblePracticeContext.region.name,
            m_start: visiblePracticeContext.region.m_start,
            m_end: visiblePracticeContext.region.m_end,
          }
        : null,
      current_page: visiblePracticeContext?.current_page ?? null,
    });
    if (draft) {
      setPendingVoiceDraft((current) =>
        current?.deliveryKey === deliveryKey
          ? current
          : {
              deliveryKey,
              contextKey: visiblePracticeContextKey,
              draft,
            },
      );
      setVoiceDraftError(null);
      return;
    }

    // No-wake questions enter Brain only after the bounded set parser declines
    // them. This never sees a final the native hot loop already handled.
    const question = parseAssistantDirectedQuestion(delivery.text);
    if (!question || routedNaturalQuestions.current.has(deliveryKey)) return;
    routedNaturalQuestions.current.add(deliveryKey);
    if (routedNaturalQuestions.current.size > 100) {
      const oldest = routedNaturalQuestions.current.values().next().value;
      if (oldest) routedNaturalQuestions.current.delete(oldest);
    }
    wakeQuestionId.current += 1;
    setWakeQuestion({ id: wakeQuestionId.current, text: question });
    setView("brain");
  }, [
    defaultCleanStreak,
    pendingBrainAction,
    pendingVoiceDraft,
    visiblePracticeContext,
    visiblePracticeContextKey,
    voice.acceptedFinalDelivery,
    voice.tierAResult,
  ]);

  const cancelVoiceDraft = useCallback(() => {
    setPendingVoiceDraft((current) => {
      if (current) suppressVoiceDraft(current.deliveryKey);
      return null;
    });
    latestVoiceDraft.current = null;
    setVoiceDraftError(null);
  }, [suppressVoiceDraft]);

  const confirmVoiceDraft = useCallback(
    async (
      deliveryKey: string,
      contextKey: string,
      draft: NaturalPracticeActionDraft,
    ) => {
      if (voiceDraftInFlight.current !== null) return;
      voiceDraftInFlight.current = deliveryKey;
      setVoiceDraftConfirming(true);
      setVoiceDraftError(null);
      try {
        if (rep.snap) {
          throw new Error(ACTIVE_SET_DRAFT_UNAVAILABLE);
        }
        if (contextKey !== practiceContextKey(visiblePracticeContext)) {
          throw new Error(
            "The Score target changed. Review a new spoken draft before starting.",
          );
        }
        const request = voiceDraftOpenRequest(draft);
        await rep.open(request.args, request.context);
        suppressVoiceDraft(deliveryKey);
        latestVoiceDraft.current = null;
        setPendingVoiceDraft((current) =>
          current?.deliveryKey === deliveryKey ? null : current,
        );
      } catch (cause) {
        setVoiceDraftError(
          cause instanceof Error
            ? cause.message
            : typeof cause === "string"
              ? cause
              : "The spoken set could not be opened.",
        );
      } finally {
        if (voiceDraftInFlight.current === deliveryKey) {
          voiceDraftInFlight.current = null;
          setVoiceDraftConfirming(false);
        }
      }
    },
    [rep, suppressVoiceDraft, visiblePracticeContext],
  );

  const brainActionUnavailableReason = useCallback(
    (pending: PendingBrainAction): string | null => {
      const { action, targetBlockId } = pending;
      if (action.kind === "tempo") return null;
      if (targetBlockId === null) {
        return "This answer was not grounded in an active set. Ask again while the set is open.";
      }
      if (rep.snap && targetBlockId !== rep.snap.block_id) {
        return "The active set changed. Ask again before applying this action.";
      }
      if (rep.snap) return null;
      switch (action.kind) {
        case "verdict":
          return "A verdict needs an active set. Open a set first, then ask again.";
        case "undo":
          return "There is no active set to undo an attempt from.";
        case "restart":
          return "There is no active set to restart.";
      }
    },
    [rep.snap],
  );

  const suppressBrainAction = useCallback((answerId: string) => {
    suppressedBrainActions.current.add(answerId);
    if (suppressedBrainActions.current.size > 100) {
      const oldest = suppressedBrainActions.current.values().next().value;
      if (oldest) suppressedBrainActions.current.delete(oldest);
    }
  }, []);

  const onBrainProposedAction = useCallback(
    (event: BrainProposedActionEvent) => {
      if (suppressedBrainActions.current.has(event.answerId)) return;
      // There is one confirmation owner. Replacing a natural draft suppresses
      // its delivery so it cannot reappear after this Brain action closes.
      setPendingVoiceDraft((current) => {
        if (current) suppressVoiceDraft(current.deliveryKey);
        return null;
      });
      setPendingBrainAction({
        answerId: event.answerId,
        targetBlockId: event.targetBlockId,
        action: event.action,
      });
      setBrainActionError(null);
    },
    [suppressVoiceDraft],
  );

  const cancelBrainAction = useCallback(() => {
    setPendingBrainAction((current) => {
      if (current) suppressBrainAction(current.answerId);
      return null;
    });
    setBrainActionError(null);
  }, [suppressBrainAction]);

  const confirmBrainAction = useCallback(
    async (pending: PendingBrainAction) => {
      const { answerId, action, targetBlockId } = pending;
      if (brainActionInFlight.current !== null) return;
      const unavailable = brainActionUnavailableReason(pending);
      if (unavailable) {
        setBrainActionError(unavailable);
        return;
      }
      if (
        action.kind !== "tempo" &&
        targetBlockId !== (rep.snap?.block_id ?? null)
      ) {
        setBrainActionError(
          "The active set changed. Ask again before applying this action.",
        );
        return;
      }
      brainActionInFlight.current = answerId;
      setBrainActionConfirming(true);
      setBrainActionError(null);
      try {
        switch (action.kind) {
          case "verdict":
            await rep.check(action.verdict, action.note);
            break;
          case "tempo":
            await invoke("metro_set", { bpm: action.bpm });
            break;
          case "undo":
            await rep.undo();
            break;
          case "restart":
            await rep.restart(action.required_clean_streak);
            break;
        }
        suppressBrainAction(answerId);
        setPendingBrainAction((current) =>
          current?.answerId === answerId ? null : current,
        );
      } catch (cause) {
        setBrainActionError(
          cause instanceof Error
            ? cause.message
            : typeof cause === "string"
              ? cause
              : "The spoken action could not be applied.",
        );
      } finally {
        if (brainActionInFlight.current === answerId) {
          brainActionInFlight.current = null;
          setBrainActionConfirming(false);
        }
      }
    },
    [brainActionUnavailableReason, rep, suppressBrainAction],
  );

  // Read every consequential draft back through the same half-duplex TTS owner
  // as Brain. Identity guards keep React rerenders from repeating the prompt.
  useEffect(() => {
    const key = pendingBrainAction
      ? `brain:${pendingBrainAction.answerId}`
      : pendingVoiceDraft
        ? `set:${pendingVoiceDraft.deliveryKey}`
        : null;
    const draft =
      pendingBrainAction?.action ?? pendingVoiceDraft?.draft ?? null;
    if (!key || !draft || spokenDraftKeys.current.has(key)) return;
    spokenDraftKeys.current.add(key);
    if (spokenDraftKeys.current.size > 100) {
      const oldest = spokenDraftKeys.current.values().next().value;
      if (oldest) spokenDraftKeys.current.delete(oldest);
    }
    const text =
      pendingVoiceDraft && rep.snap
        ? "A practice set is already active. Close or finish it before starting another, or say cancel."
        : actionDraftSpeech(draft);
    void invoke("voice_speak", { text }).catch(() => {
      // The visual confirmation remains authoritative if TTS is unavailable.
    });
  }, [pendingBrainAction, pendingVoiceDraft, rep.snap]);

  // While a card is pending, collision-free whole utterances can confirm or
  // cancel it. The backend-routed flag is fail-closed: React never treats an
  // utterance the native hot loop already handled as a confirmation.
  useEffect(() => {
    const delivery = voice.acceptedFinalDelivery;
    if (!delivery || delivery.handled) return;
    const decision = parseSpokenConfirmationDecision(delivery.text);
    if (!decision) return;
    const deliveryKey = `${delivery.delivery_id}:r${delivery.revision}`;
    if (handledConfirmationDeliveries.current.has(deliveryKey)) return;
    const pending = pendingBrainAction ?? pendingVoiceDraft;
    if (!pending) return;
    handledConfirmationDeliveries.current.add(deliveryKey);
    if (handledConfirmationDeliveries.current.size > 100) {
      const oldest = handledConfirmationDeliveries.current
        .values()
        .next().value;
      if (oldest) handledConfirmationDeliveries.current.delete(oldest);
    }
    if (decision === "cancel") {
      if (pendingBrainAction) cancelBrainAction();
      else cancelVoiceDraft();
      return;
    }
    if (pendingBrainAction) {
      void confirmBrainAction(pendingBrainAction);
    } else if (pendingVoiceDraft) {
      const latest = latestVoiceDraft.current;
      const draft =
        latest?.deliveryKey === pendingVoiceDraft.deliveryKey &&
        latest.contextKey === pendingVoiceDraft.contextKey
          ? latest.draft
          : pendingVoiceDraft.draft;
      void confirmVoiceDraft(
        pendingVoiceDraft.deliveryKey,
        pendingVoiceDraft.contextKey,
        draft,
      );
    }
  }, [
    cancelBrainAction,
    cancelVoiceDraft,
    confirmBrainAction,
    confirmVoiceDraft,
    pendingBrainAction,
    pendingVoiceDraft,
    voice.acceptedFinalDelivery,
  ]);

  const endSession = useCallback(async () => {
    setEnding(true);
    try {
      await session.endSession();
    } catch {
      // useSession preserves the live session and publishes the receipt.
    } finally {
      setEnding(false);
    }
  }, [session]);

  const focusTab = (id: WorkspaceId) => {
    setView(id);
    requestAnimationFrame(() => tabRefs.current[id]?.focus());
  };

  const openSettings = () => {
    if (view === "settings") {
      setView(settingsReturnView);
      return;
    }
    setSettingsReturnView(view);
    setView("settings");
  };

  const openCalendar = useCallback(() => {
    setLedgerSurface("calendar");
    setRequestedLedgerPiece((current) => ({
      pieceId: null,
      revision: current.revision + 1,
    }));
    setView("ledger");
  }, []);

  // The main menu's "Ledger" entry opens the history surface (not the calendar
  // one openCalendar forces), resetting any prior piece selection.
  const openLedgerHistory = useCallback(() => {
    setLedgerSurface("ledger");
    setRequestedLedgerPiece((current) => ({
      pieceId: null,
      revision: current.revision + 1,
    }));
    setView("ledger");
  }, []);

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: WorkspaceId,
  ) => {
    const index = WORKSPACES.findIndex((w) => w.id === id);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % WORKSPACES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + WORKSPACES.length) % WORKSPACES.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = WORKSPACES.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    focusTab(WORKSPACES[next].id);
  };

  const openPiece = useCallback(
    (piece: PracticePieceContext, opts?: { tab?: "plan" }) => {
      setRequestedScorePiece((current) => ({
        pieceId: piece.piece_id,
        tab: opts?.tab ?? null,
        revision: current.revision + 1,
      }));
      setView("score");
    },
    [],
  );

  // Deep link (spec C3): a day-sheet piece heading opens Score on that piece with
  // the Plan tab active, reusing the same requested-piece navigation idiom.
  const openPiecePlan = useCallback(
    (pieceId: number) => {
      openPiece({ piece_id: pieceId, title: "" }, { tab: "plan" });
    },
    [openPiece],
  );

  // Universe detail-panel "Open on score" jump: null piece = open Atlas plain.
  const openFromUniverse = useCallback(
    (piece: PracticePieceContext | null) => {
      if (piece) openPiece(piece);
      else setView("score");
    },
    [openPiece],
  );

  const openLedgerForPiece = useCallback((piece: PracticePieceContext) => {
    setLedgerSurface("ledger");
    setRequestedLedgerPiece((current) => ({
      pieceId: piece.piece_id,
      revision: current.revision + 1,
    }));
    setView("ledger");
  }, []);

  const shellTree = (
    <div className="shell">
      <aside className="shell-rail" aria-label="CodaKiller">
        <div className="shell-wordmark">CodaKiller</div>

        <nav
          className="shell-nav shell-enter"
          role="tablist"
          aria-label="Workspace"
          aria-orientation="vertical"
        >
          {WORKSPACES.map((workspace, index) => {
            const selected = view === workspace.id;
            return (
              <button
                key={workspace.id}
                ref={(node) => {
                  tabRefs.current[workspace.id] = node;
                }}
                type="button"
                role="tab"
                id={`tab-${workspace.id}`}
                aria-controls="shell-stage"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`shell-nav-item${selected ? " is-active" : ""}`}
                style={{ ["--enter-index" as string]: index }}
                onClick={() => setView(workspace.id)}
                onKeyDown={(event) => onTabKeyDown(event, workspace.id)}
              >
                {NAV_ICONS[workspace.id]}
                <span className="shell-nav-label">{workspace.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          ref={metroButtonRef}
          type="button"
          className={`shell-settings-button is-foot-lead${metroOpen ? " is-active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={metroOpen}
          onClick={() => setMetroOpen((open) => !open)}
        >
          <MetronomeGlyph />
          <span className="shell-nav-label">Metronome</span>
        </button>

        <button
          type="button"
          className={`shell-settings-button${view === "settings" ? " is-active" : ""}`}
          aria-pressed={view === "settings"}
          onClick={openSettings}
        >
          <SettingsGlyph />
          <span className="shell-nav-label">Settings</span>
        </button>
      </aside>

      {/* The header band. It is a real grid row: it reserves its own height and
          can never sit on top of the workspace beneath it (defect D1). */}
      {session.session && (
        <header className="shell-topbar">
          <SessionBar
            session={session.session}
            onEnd={endSession}
            ending={ending}
            blockedReason={
              rep.snap
                ? "Close the active set before ending the session."
                : null
            }
          />
        </header>
      )}

      <main
        id="shell-stage"
        className="shell-stage"
        role="tabpanel"
        aria-labelledby={view === "settings" ? undefined : `tab-${view}`}
      >
        <Suspense
          fallback={<div className="shell-loading" aria-hidden="true" />}
        >
          {view === "settings" &&
            (settingsContent ?? (
              <WorkspaceStub id="settings" name="Settings" />
            ))}
          {view !== "settings" && (
            <>
              {view === "today" && (
                <div data-testid="workspace-today">
                  <TodayWorkspace
                    onOpenAtlas={() => {
                      setRequestedScorePiece((current) => ({
                        pieceId: null,
                        tab: null,
                        revision: current.revision + 1,
                      }));
                      setView("score");
                    }}
                    onOpenCalendar={openCalendar}
                    onOpenPiecePlan={openPiecePlan}
                    onOpenBrain={() => setView("brain")}
                    onOpenLedger={openLedgerHistory}
                    onOpenUniverse={() => setView("universe")}
                    onOpenSettings={openSettings}
                  />
                </div>
              )}
              {view === "universe" && (
                <div data-testid="workspace-universe">
                  <UniverseWorkspace
                    onOpenPractice={openFromUniverse}
                    onOpenLedger={openLedgerForPiece}
                  />
                </div>
              )}
              {view === "ledger" && (
                <LedgerCalendarWorkspace
                  onOpenBlock={rep.open}
                  activeRep={rep.snap}
                  defaultCleanStreak={defaultCleanStreak}
                  requestedSurface={ledgerSurface}
                  requestedPieceId={requestedLedgerPiece.pieceId}
                  requestRevision={requestedLedgerPiece.revision}
                  onSurfaceChange={setLedgerSurface}
                  onPracticeContextChange={setLedgerPracticeContext}
                />
              )}
              {view === "brain" && (
                <BrainWorkspace
                  wakeQuestion={wakeQuestion}
                  practiceContext={groundedBrainContext ?? undefined}
                  todayPlan={todayPlan}
                  onProposedAction={onBrainProposedAction}
                />
              )}
            </>
          )}
          {(view === "score" || scorePracticeContext != null) && (
            <div hidden={view !== "score"} data-testid="score-shell-cache">
              <ScoreWorkspace
                onOpenBlock={rep.open}
                defaultCleanStreak={defaultCleanStreak}
                onPracticeContextChange={setScorePracticeContext}
                requestedPieceId={requestedScorePiece.pieceId}
                requestRevision={requestedScorePiece.revision}
                requestedTab={requestedScorePiece.tab}
                isActive={view === "score"}
                activeRep={rep.snap}
              />
            </div>
          )}
        </Suspense>
      </main>

      {(pendingBrainAction || pendingVoiceDraft) && (
        <div style={VOICE_DRAFT_STYLE} className="voice-command-surface">
          {pendingBrainAction ? (
            <ActionDraftCard
              draft={pendingBrainAction.action}
              confirming={brainActionConfirming}
              unavailableReason={brainActionUnavailableReason(
                pendingBrainAction,
              )}
              onCancel={cancelBrainAction}
              onConfirm={() => void confirmBrainAction(pendingBrainAction)}
            />
          ) : pendingVoiceDraft ? (
            <ActionDraftCard
              draft={pendingVoiceDraft.draft}
              confirming={voiceDraftConfirming}
              unavailableReason={rep.snap ? ACTIVE_SET_DRAFT_UNAVAILABLE : null}
              onDraftChange={(draft) => {
                latestVoiceDraft.current = {
                  ...pendingVoiceDraft,
                  draft,
                };
              }}
              onCancel={cancelVoiceDraft}
              onConfirm={(draft: ActionDraft) => {
                if (draft.kind === "start_practice_set") {
                  void confirmVoiceDraft(
                    pendingVoiceDraft.deliveryKey,
                    pendingVoiceDraft.contextKey,
                    draft,
                  );
                }
              }}
            />
          ) : null}
          {voiceDraftError && (
            <p className="voice-draft-error" role="alert">
              {voiceDraftError}
            </p>
          )}
          {brainActionError && (
            <p className="voice-draft-error" role="alert">
              {brainActionError}
            </p>
          )}
        </div>
      )}

      <MetronomePopover
        anchorRef={metroButtonRef}
        open={metroOpen}
        onClose={() => setMetroOpen(false)}
      />

      <VoiceToast
        lastIntent={voice.lastIntent}
        status={voice.status}
        downGuidance={voice.downGuidance}
        deliveryDisposition={voice.deliveryDisposition}
      />
      {rep.error && !rep.snap && (
        <p
          className="shell-rep-error"
          role="alert"
          style={{
            position: "fixed",
            left: "var(--s-4)",
            bottom: "var(--s-4)",
            color: "var(--signal-error)",
            zIndex: 90,
          }}
        >
          {rep.error}
        </p>
      )}
    </div>
  );
  // Shell-level dock, same promotion pattern the session event bar used in v3
  // Phase 5: mounted once here so its panels persist across every workspace
  // tab rather than being re-created per view. Task A4 added PausedSetsTray
  // ("paused") and Task A6 added ClockPanel ("clock") as one more line
  // alongside RepPanel each.
  return (
    <DockProvider>
      <TodaySheetProvider>{shellTree}</TodaySheetProvider>
      <RepPanel
        snap={rep.snap}
        feed={rep.feed}
        error={rep.error}
        collapsed={repHudCollapsed}
        onToggleCollapsed={() => setRepHudCollapsed((collapsed) => !collapsed)}
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
      <PausedSetsTray repSetState={rep.snap?.set_state} />
      <ClockPanel />
    </DockProvider>
  );
}
