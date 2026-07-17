import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceStub } from "./WorkspaceStub";
import { TodayWorkspace } from "../features/today/TodayWorkspace";
import type { PracticePieceContext } from "../features/universe/types";
import {
  repTries,
  useRep,
  type RepOpenArgs,
  type SetFocusContextInput,
} from "../features/rep/useRep";
import { RepHud } from "../features/rep/RepHud";
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
import { MetronomePopover } from "../features/metronome/MetronomePopover";
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
  { id: "brain", label: "Brain" },
  // The Ledger/Calendar slot (Phase 6 fills both behind this one entry).
  { id: "ledger", label: "Ledger" },
  { id: "universe", label: "Universe" },
] as const;

type WorkspaceId = (typeof WORKSPACES)[number]["id"];
type View = WorkspaceId | "settings";

// Lazy per slot. Today and Universe are rendered directly (they need live
// props), so their map entries are omitted; the others resolve to a stub or the
// phase's real workspace.
const WORKSPACE_COMPONENTS: Record<
  Exclude<WorkspaceId, "today" | "universe" | "ledger">,
  ComponentType
> = {
  score: lazy(() =>
    import("../features/score/ScoreWorkspace").then((m) => ({
      default: m.ScoreWorkspace,
    })),
  ),
  brain: lazy(() =>
    import("../features/brain/BrainWorkspace").then((m) => ({
      default: m.BrainWorkspace,
    })),
  ),
};

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

export interface ShellProps {
  /** The real Settings surface (Task 2.4). Falls back to a stub when absent. */
  settingsContent?: ReactNode;
  /** Persisted default consecutive-clean target for new spoken/composed sets. */
  defaultCleanStreak?: number;
}

const DOCK_STYLE: CSSProperties = {
  position: "fixed",
  right: "var(--s-5)",
  bottom: "var(--s-5)",
  width: "min(440px, calc(100vw - 2 * var(--s-5)))",
  maxHeight: "calc(100vh - 2 * var(--s-5))",
  overflowY: "auto",
  zIndex: 90,
};

const SESSION_DOCK_STYLE: CSSProperties = {
  position: "fixed",
  top: "var(--s-4)",
  right: "var(--s-4)",
  zIndex: 80,
};

const VOICE_DRAFT_STYLE: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "var(--s-5)",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100vw - 2 * var(--s-4)))",
  zIndex: 95,
};

export function Shell({ settingsContent, defaultCleanStreak = 5 }: ShellProps) {
  const [view, setView] = useState<View>("today");
  const tabRefs = useRef<
    Partial<Record<WorkspaceId, HTMLButtonElement | null>>
  >({});

  const rep = useRep();
  const tierAContext = useMemo<TierAContext>(() => {
    const snap = rep.snap;
    const paused =
      snap?.timer_state === "paused" || snap?.set_state === "paused";
    return {
      practice_state: snap == null ? "idle" : paused ? "paused" : "active",
      metronome_running: snap?.use_metronome === true && !paused,
      last_attempt_available:
        snap != null && (snap.last_attempt_id != null || repTries(snap) > 0),
      pending_duplicate_attempt: false,
      retention_due: snap?.retention_check?.state === "due",
    };
  }, [rep.snap]);
  const voice = useVoice(tierAContext);
  const session = useSession();
  const [ending, setEnding] = useState(false);

  // The free-standing manual metronome control (BPM/boost/sound/live state +
  // metro_stop). In-set tempo lives in the RepHud; this is the standalone
  // instrument, re-homed at the shell rail as it was in the pre-v3 header.
  const metroButtonRef = useRef<HTMLButtonElement>(null);
  const [metroOpen, setMetroOpen] = useState(false);

  const [pendingVoiceDraft, setPendingVoiceDraft] =
    useState<PendingVoiceDraft | null>(null);
  const [voiceDraftConfirming, setVoiceDraftConfirming] = useState(false);
  const [voiceDraftError, setVoiceDraftError] = useState<string | null>(null);
  const suppressedVoiceDrafts = useRef(new Set<string>());
  const voiceDraftInFlight = useRef<string | null>(null);

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
    const draft = parseNaturalPracticeActionDraft(delivery.text, {
      piece_id: null,
      piece_title: null,
      default_clean_streak: defaultCleanStreak,
    });
    if (!draft) return;
    setPendingVoiceDraft((current) =>
      current?.deliveryKey === deliveryKey ? current : { deliveryKey, draft },
    );
    setVoiceDraftError(null);
  }, [defaultCleanStreak, voice.acceptedFinalDelivery, voice.tierAResult]);

  const cancelVoiceDraft = useCallback(() => {
    setPendingVoiceDraft((current) => {
      if (current) suppressVoiceDraft(current.deliveryKey);
      return null;
    });
    setVoiceDraftError(null);
  }, [suppressVoiceDraft]);

  const confirmVoiceDraft = useCallback(
    async (deliveryKey: string, draft: NaturalPracticeActionDraft) => {
      if (voiceDraftInFlight.current !== null) return;
      voiceDraftInFlight.current = deliveryKey;
      setVoiceDraftConfirming(true);
      setVoiceDraftError(null);
      try {
        const request = voiceDraftOpenRequest(draft);
        await rep.open(request.args, request.context);
        suppressVoiceDraft(deliveryKey);
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
    [rep, suppressVoiceDraft],
  );

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

  const openPiece = useCallback((piece: PracticePieceContext) => {
    // Best-effort selection so the Score workspace opens on the chosen piece;
    // a missing backend (browser dev) just navigates.
    void invoke("piece_select", { pieceId: piece.piece_id }).catch(() => {});
    setView("score");
  }, []);

  // Universe detail-panel "Open on score" jump: null piece = open Atlas plain.
  const openFromUniverse = useCallback(
    (piece: PracticePieceContext | null) => {
      if (piece) openPiece(piece);
      else setView("score");
    },
    [openPiece],
  );

  const openLedgerForPiece = useCallback((piece: PracticePieceContext) => {
    void invoke("piece_select", { pieceId: piece.piece_id }).catch(() => {});
    setView("ledger");
  }, []);

  const ActiveWorkspace =
    view === "settings" ||
    view === "today" ||
    view === "universe" ||
    view === "ledger"
      ? null
      : WORKSPACE_COMPONENTS[view];

  return (
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
                {workspace.label}
              </button>
            );
          })}
        </nav>

        {session.session && (
          <div style={SESSION_DOCK_STYLE}>
            <SessionBar
              session={session.session}
              onEnd={endSession}
              ending={ending}
            />
          </div>
        )}

        <button
          ref={metroButtonRef}
          type="button"
          className={`shell-settings-button${metroOpen ? " is-active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={metroOpen}
          onClick={() => setMetroOpen((open) => !open)}
        >
          Metronome
        </button>

        <button
          type="button"
          className={`shell-settings-button${view === "settings" ? " is-active" : ""}`}
          aria-pressed={view === "settings"}
          onClick={() =>
            setView((current) =>
              current === "settings" ? "today" : "settings",
            )
          }
        >
          Settings
        </button>
      </aside>

      <main
        id="shell-stage"
        className="shell-stage"
        role="tabpanel"
        aria-labelledby={view === "settings" ? undefined : `tab-${view}`}
      >
        <Suspense
          fallback={<div className="shell-loading" aria-hidden="true" />}
        >
          {view === "settings" ? (
            (settingsContent ?? <WorkspaceStub id="settings" name="Settings" />)
          ) : view === "today" ? (
            <div data-testid="workspace-today">
              <TodayWorkspace
                onOpenAtlas={() => setView("score")}
                onOpenCalendar={() => setView("ledger")}
                onOpenPiece={openPiece}
                defaultCleanStreak={defaultCleanStreak}
                activeBlock={rep.snap}
              />
            </div>
          ) : view === "universe" ? (
            <div data-testid="workspace-universe">
              <UniverseWorkspace
                onOpenPractice={openFromUniverse}
                onOpenLedger={openLedgerForPiece}
              />
            </div>
          ) : view === "ledger" ? (
            <LedgerCalendarWorkspace
              onOpenBlock={rep.open}
              activeRep={rep.snap}
              defaultCleanStreak={defaultCleanStreak}
            />
          ) : (
            ActiveWorkspace && <ActiveWorkspace />
          )}
        </Suspense>
      </main>

      {rep.snap && (
        <aside style={DOCK_STYLE} aria-label="Active practice set">
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
        </aside>
      )}

      {pendingVoiceDraft && (
        <div style={VOICE_DRAFT_STYLE} className="voice-command-surface">
          <ActionDraftCard
            draft={pendingVoiceDraft.draft}
            confirming={voiceDraftConfirming}
            onCancel={cancelVoiceDraft}
            onConfirm={(draft: ActionDraft) => {
              if (draft.kind === "start_practice_set") {
                void confirmVoiceDraft(pendingVoiceDraft.deliveryKey, draft);
              }
            }}
          />
          {voiceDraftError && (
            <p className="voice-draft-error" role="alert">
              {voiceDraftError}
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
}
